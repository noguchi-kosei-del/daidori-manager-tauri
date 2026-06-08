import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { BleedRegion, TachikiriType, BleedColor, BLEED_COLOR_MAP } from './ExportModal';
import { LockIcon, UnlockIcon, ResetIcon, AlertTriangleIcon } from '../../icons';
import { useModalAnimation } from '../../hooks';

// 6モードカード定義（Tachimi準拠）
const TACHIKIRI_CARDS: { value: TachikiriType; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'crop_only', label: '切抜' },
  { value: 'crop_and_stroke', label: '切+線' },
  { value: 'stroke_only', label: '線のみ' },
  { value: 'fill_white', label: '塗る' },
  { value: 'fill_and_stroke', label: '塗+線' },
];
const STROKE_TYPES: TachikiriType[] = ['crop_and_stroke', 'stroke_only', 'fill_and_stroke'];
const FILL_TYPES: TachikiriType[] = ['fill_white', 'fill_and_stroke'];
const COLOR_OPTIONS: { value: BleedColor; label: string }[] = [
  { value: 'black', label: '黒' },
  { value: 'white', label: '白' },
  { value: 'cyan', label: '水色' },
];

interface Guide {
  type: 'h' | 'v';
  position: number; // 元画像のピクセル座標
}

interface BleedEditorModalProps {
  isOpen: boolean;
  label: string;
  thumbnailPath: string;
  originalFilePath: string;
  onApply: (region: BleedRegion) => void;
  onSkip: () => void;
  onCancel: () => void;
  // 断ち切りタブからの再利用時にボタン文言と初期値を差し替える（既定は従来のエクスポート用途）
  applyLabel?: string;
  skipLabel?: string;
  initialRegion?: BleedRegion | null;
  // 断ち切りタブ内で中央＋右パネルとしてインライン表示する（全画面モーダルにしない）
  embedded?: boolean;
  // 同一対象の別ページへのページ送り（黒ベタ等でトンボが見えない時用）。1件のみなら未指定
  pageNav?: {
    index: number;
    total: number;
    label?: string;
    onPrev: () => void;
    onNext: () => void;
  };
}

export function BleedEditorModal({
  isOpen,
  label,
  thumbnailPath,
  originalFilePath,
  onApply,
  onSkip,
  onCancel,
  applyLabel = 'エクスポート',
  skipLabel = 'スキップしてエクスポート',
  initialRegion = null,
  embedded = false,
  pageNav,
}: BleedEditorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null);
  const [imageBounds, setImageBounds] = useState<{
    displayWidth: number; displayHeight: number; offsetX: number; offsetY: number;
  } | null>(null);

  const [guides, setGuides] = useState<Guide[]>([]);
  const [guidesLocked, setGuidesLocked] = useState(false);
  const [rulerDrag, setRulerDrag] = useState<{ type: 'h' | 'v'; displayPos: number } | null>(null);
  const [guideDrag, setGuideDrag] = useState<{ index: number; type: 'h' | 'v' } | null>(null);

  // 選択範囲（元画像ピクセル座標）
  const [selection, setSelection] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const isDragging = useRef(false);
  const dragStartImg = useRef({ x: 0, y: 0 }); // 元画像ピクセル座標

  const [hint, setHint] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  // 断ち切りモード設定（Tachimi準拠）
  const [tachikiriType, setTachikiriType] = useState<TachikiriType>('crop_only');
  const [strokeColor, setStrokeColor] = useState<BleedColor>('black');
  const [fillColor, setFillColor] = useState<BleedColor>('white');
  const [fillOpacity, setFillOpacity] = useState(50);

  // リセット
  useEffect(() => {
    if (isOpen) {
      setGuides([]);
      setRulerDrag(null);
      setGuideDrag(null);
      isDragging.current = false;
      setShowCancelConfirm(false);
      if (initialRegion) {
        // 既存設定の復元（断ち切りタブで再編集する場合）
        setTachikiriType(initialRegion.tachikiriType);
        setStrokeColor(initialRegion.strokeColor);
        setFillColor(initialRegion.fillColor);
        setFillOpacity(initialRegion.fillOpacity);
        if (initialRegion.tachikiriType !== 'none' && initialRegion.right > initialRegion.left && initialRegion.bottom > initialRegion.top) {
          setSelection({
            left: initialRegion.left,
            top: initialRegion.top,
            right: initialRegion.right,
            bottom: initialRegion.bottom,
          });
          setGuidesLocked(true);
        } else {
          setSelection(null);
          setGuidesLocked(false);
        }
        setAutoDetected(false);
      } else {
        setGuidesLocked(false);
        setSelection(null);
        setAutoDetected(false);
        setTachikiriType('crop_only');
        setStrokeColor('black');
        setFillColor('white');
        setFillOpacity(50);
      }
    }
    // originalFilePath は依存に入れない（ページ送りで選択・設定がリセットされないように）
  }, [isOpen, initialRegion]);

  // 元画像サイズ取得
  useEffect(() => {
    if (!isOpen || !originalFilePath) return;
    invoke<[number, number]>('get_image_dimensions', { path: originalFilePath })
      .then(([w, h]) => setOriginalSize({ width: w, height: h }))
      .catch(() => setOriginalSize(null));
  }, [isOpen, originalFilePath]);

  // PSDファイル内のガイド線を読み込み
  useEffect(() => {
    if (!isOpen || !originalFilePath) return;
    if (!originalFilePath.toLowerCase().endsWith('.psd')) return;
    invoke<Guide[]>('read_psd_guides', { path: originalFilePath })
      .then((psdGuides) => {
        if (psdGuides && psdGuides.length > 0) {
          setGuides(psdGuides);
        }
      })
      .catch(() => {
        // ガイドが読めなくても無視（手動で引ける）
      });
  }, [isOpen, originalFilePath]);

  // 画像バウンド計算
  const calculateBounds = useCallback(() => {
    const img = imgRef.current;
    if (!img || !originalSize) return;
    const cw = img.offsetWidth;
    const ch = img.offsetHeight;
    const aspect = originalSize.width / originalSize.height;
    const cAspect = cw / ch;
    let dw: number, dh: number, ox: number, oy: number;
    if (aspect > cAspect) {
      dw = cw; dh = cw / aspect; ox = 0; oy = (ch - dh) / 2;
    } else {
      dh = ch; dw = ch * aspect; ox = (cw - dw) / 2; oy = 0;
    }
    setImageBounds({ displayWidth: dw, displayHeight: dh, offsetX: ox, offsetY: oy });
  }, [originalSize]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(calculateBounds, 100);
      window.addEventListener('resize', calculateBounds);
      return () => { clearTimeout(timer); window.removeEventListener('resize', calculateBounds); };
    }
  }, [isOpen, calculateBounds]);

  // ヒント更新
  useEffect(() => {
    if (!isOpen) return;
    if (tachikiriType === 'none') {
      setHint('断ち切りなし — 原寸（またはリサイズのみ）でJPEG出力します');
    } else if (selection && autoDetected) {
      setHint('ガイドから自動検出しました — 画像上をドラッグして調整も可能です');
    } else if (selection) {
      setHint('範囲OK — エクスポート可能です');
    } else if (guidesLocked) {
      setHint('画像上をドラッグして断ち切り範囲を選択（ガイドにスナップします）');
    } else if (guides.length === 0) {
      setHint('上・左のルーラーからドラッグしてガイド線を作成してください（不要な場合はスキップしてエクスポートを選択）');
    } else {
      setHint('ガイドを配置したら「ガイドを確定」ボタンを押してください');
    }
  }, [isOpen, guides.length, guidesLocked, selection, autoDetected, tachikiriType]);

  // マウス座標 → 元画像ピクセル座標
  const clientToImageCoord = useCallback((clientX: number, clientY: number): { ix: number; iy: number } | null => {
    const container = containerRef.current;
    if (!container || !imageBounds || !originalSize) return null;
    const rect = container.getBoundingClientRect();
    const dx = clientX - rect.left - imageBounds.offsetX;
    const dy = clientY - rect.top - imageBounds.offsetY;
    const ix = Math.max(0, Math.min(Math.round((dx / imageBounds.displayWidth) * originalSize.width), originalSize.width));
    const iy = Math.max(0, Math.min(Math.round((dy / imageBounds.displayHeight) * originalSize.height), originalSize.height));
    return { ix, iy };
  }, [imageBounds, originalSize]);

  // マウス座標 → 表示座標（ルーラードラッグ用）
  const clientToDisplayCoord = useCallback((clientX: number, clientY: number): { dx: number; dy: number } | null => {
    const container = containerRef.current;
    if (!container || !imageBounds) return null;
    const rect = container.getBoundingClientRect();
    return {
      dx: Math.max(0, Math.min(clientX - rect.left - imageBounds.offsetX, imageBounds.displayWidth)),
      dy: Math.max(0, Math.min(clientY - rect.top - imageBounds.offsetY, imageBounds.displayHeight)),
    };
  }, [imageBounds]);

  // 元画像ピクセル座標 → 表示座標
  const imageToDisplay = useCallback((imgPos: number, type: 'h' | 'v'): number => {
    if (!imageBounds || !originalSize) return 0;
    return type === 'h'
      ? (imgPos / originalSize.height) * imageBounds.displayHeight
      : (imgPos / originalSize.width) * imageBounds.displayWidth;
  }, [imageBounds, originalSize]);

  // ガイドへのスナップ（元画像ピクセル座標で実行、閾値は表示座標12pxから逆算）
  const SNAP_DISPLAY_PX = 12;
  const snapToGuides = useCallback((ix: number, iy: number): { ix: number; iy: number } => {
    if (!imageBounds || !originalSize) return { ix, iy };
    const threshX = (SNAP_DISPLAY_PX / imageBounds.displayWidth) * originalSize.width;
    const threshY = (SNAP_DISPLAY_PX / imageBounds.displayHeight) * originalSize.height;
    let sx = ix, sy = iy;
    let bestDx = threshX, bestDy = threshY;
    for (const g of guides) {
      if (g.type === 'v') {
        const d = Math.abs(ix - g.position);
        if (d < bestDx) { bestDx = d; sx = g.position; }
      } else {
        const d = Math.abs(iy - g.position);
        if (d < bestDy) { bestDy = d; sy = g.position; }
      }
    }
    return { ix: sx, iy: sy };
  }, [guides, imageBounds, originalSize]);

  // ルーラードラッグ開始
  const handleRulerMouseDown = useCallback((type: 'h' | 'v', e: React.MouseEvent) => {
    e.preventDefault();
    if (guidesLocked) return;
    setRulerDrag({ type, displayPos: 0 });
  }, [guidesLocked]);

  // グローバルマウスイベント
  useEffect(() => {
    if (!isOpen) return;

    const handleMove = (e: MouseEvent) => {
      // ルーラードラッグ中
      if (rulerDrag) {
        const dc = clientToDisplayCoord(e.clientX, e.clientY);
        if (dc) {
          setRulerDrag(prev => prev ? { ...prev, displayPos: prev.type === 'h' ? dc.dy : dc.dx } : null);
        }
      }

      // ガイドドラッグ中
      if (guideDrag) {
        const ic = clientToImageCoord(e.clientX, e.clientY);
        if (ic) {
          const pos = guideDrag.type === 'h' ? ic.iy : ic.ix;
          setGuides(prev => prev.map((g, i) => i === guideDrag.index ? { ...g, position: pos } : g));
        }
      }

      // 選択範囲ドラッグ中（すべて元画像ピクセル座標で計算）
      if (isDragging.current && guidesLocked) {
        const ic = clientToImageCoord(e.clientX, e.clientY);
        if (ic) {
          const snapped = snapToGuides(ic.ix, ic.iy);
          setSelection({
            left: Math.min(dragStartImg.current.x, snapped.ix),
            top: Math.min(dragStartImg.current.y, snapped.iy),
            right: Math.max(dragStartImg.current.x, snapped.ix),
            bottom: Math.max(dragStartImg.current.y, snapped.iy),
          });
        }
      }
    };

    const handleUp = (e: MouseEvent) => {
      if (rulerDrag && originalSize) {
        const ic = clientToImageCoord(e.clientX, e.clientY);
        if (ic) {
          const pos = rulerDrag.type === 'h' ? ic.iy : ic.ix;
          const max = rulerDrag.type === 'h' ? originalSize.height : originalSize.width;
          if (pos > 5 && pos < max - 5) {
            setGuides(prev => [...prev, { type: rulerDrag.type, position: pos }]);
          }
        }
        setRulerDrag(null);
      }
      if (guideDrag) setGuideDrag(null);
      if (isDragging.current) isDragging.current = false;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isOpen, rulerDrag, guideDrag, guidesLocked, clientToImageCoord, clientToDisplayCoord, snapToGuides, originalSize]);

  // ガイドドラッグ開始
  const handleGuideMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    if (guidesLocked) return;
    e.preventDefault();
    e.stopPropagation();
    setGuideDrag({ index, type: guides[index].type });
  }, [guides, guidesLocked]);

  // ガイド削除（ダブルクリック）
  const handleGuideDoubleClick = useCallback((index: number, e: React.MouseEvent) => {
    if (guidesLocked) return;
    e.preventDefault();
    e.stopPropagation();
    setGuides(prev => prev.filter((_, i) => i !== index));
  }, [guidesLocked]);

  // 画像上でのマウスダウン: ロック後は選択ドラッグ開始
  const handlePreviewMouseDown = useCallback((e: React.MouseEvent) => {
    if (!guidesLocked) return;
    const ic = clientToImageCoord(e.clientX, e.clientY);
    if (!ic) return;
    e.preventDefault();
    const snapped = snapToGuides(ic.ix, ic.iy);
    dragStartImg.current = { x: snapped.ix, y: snapped.iy };
    isDragging.current = true;
    setSelection(null);
    setAutoDetected(false);
  }, [guidesLocked, clientToImageCoord, snapToGuides]);

  // ロック切替
  const toggleLock = useCallback(() => {
    setGuidesLocked(prev => !prev);
    setGuideDrag(null);
    if (!guidesLocked) {
      // ロック開始時: ガイドが十分あれば自動で選択範囲を検出
      const hGuides = guides.filter(g => g.type === 'h').sort((a, b) => a.position - b.position);
      const vGuides = guides.filter(g => g.type === 'v').sort((a, b) => a.position - b.position);
      if (hGuides.length >= 2 && vGuides.length >= 2) {
        setSelection({
          left: vGuides[0].position,
          top: hGuides[0].position,
          right: vGuides[vGuides.length - 1].position,
          bottom: hGuides[hGuides.length - 1].position,
        });
        setAutoDetected(true);
      } else {
        setSelection(null);
        setAutoDetected(false);
      }
    } else {
      setAutoDetected(false);
    }
  }, [guidesLocked, guides]);

  const hasValidSelection = selection != null && selection.right > selection.left && selection.bottom > selection.top;

  // BleedRegion 計算（選択範囲は元画像ピクセル絶対座標）
  const region: BleedRegion | null = (() => {
    if (!originalSize) return null;
    const base = {
      refWidth: originalSize.width,
      refHeight: originalSize.height,
      tachikiriType,
      strokeColor,
      fillColor,
      fillOpacity,
    };
    if (tachikiriType === 'none') {
      return { left: 0, top: 0, right: 0, bottom: 0, ...base };
    }
    if (!hasValidSelection || !selection) return null;
    return {
      left: Math.max(0, selection.left),
      top: Math.max(0, selection.top),
      right: selection.right,
      bottom: selection.bottom,
      ...base,
    };
  })();

  // エクスポート可否: 'none' は選択不要、それ以外は有効な選択が必要
  const canApply = tachikiriType === 'none' || hasValidSelection;

  // 選択範囲の表示座標
  const selectionDisplay = (() => {
    if (!selection || !imageBounds || !originalSize) return null;
    const l = imageToDisplay(selection.left, 'v');
    const t = imageToDisplay(selection.top, 'h');
    const r = imageToDisplay(selection.right, 'v');
    const b = imageToDisplay(selection.bottom, 'h');
    return { left: l, top: t, width: r - l, height: b - t };
  })();

  const { shouldRender, isClosing } = useModalAnimation(isOpen);
  if (!shouldRender) return null;

  const editorBody = (
    <>
        <div className="bleed-editor-header">
          <h2>{label}の断ち切り範囲設定</h2>
          <div className="bleed-editor-hint">{hint}</div>
        </div>

        <div className="bleed-editor-body">
          <div className="bleed-editor-ruler-wrapper">
            <div className="bleed-editor-ruler-corner" />
            <div
              className={`bleed-editor-ruler bleed-editor-ruler-h ${guidesLocked ? 'locked' : ''}`}
              onMouseDown={(e) => handleRulerMouseDown('h', e)}
            >
              <span className="bleed-ruler-label">水平ルーラー</span>
            </div>
            <div
              className={`bleed-editor-ruler bleed-editor-ruler-v ${guidesLocked ? 'locked' : ''}`}
              onMouseDown={(e) => handleRulerMouseDown('v', e)}
            >
              <span className="bleed-ruler-label">垂直ルーラー</span>
            </div>
            <div
              className={`bleed-editor-preview ${guidesLocked ? 'crosshair' : ''}`}
              ref={containerRef}
              onMouseDown={handlePreviewMouseDown}
            >
              <img
                ref={imgRef}
                src={convertFileSrc(thumbnailPath)}
                alt="プレビュー"
                className="bleed-editor-image"
                draggable={false}
                onLoad={calculateBounds}
              />

              {/* 選択範囲 */}
              {imageBounds && selectionDisplay && hasValidSelection && (
                <>
                  <div className="bleed-editor-dim" style={{
                    left: imageBounds.offsetX, top: imageBounds.offsetY,
                    width: imageBounds.displayWidth, height: selectionDisplay.top,
                  }} />
                  <div className="bleed-editor-dim" style={{
                    left: imageBounds.offsetX,
                    top: imageBounds.offsetY + selectionDisplay.top + selectionDisplay.height,
                    width: imageBounds.displayWidth,
                    height: imageBounds.displayHeight - selectionDisplay.top - selectionDisplay.height,
                  }} />
                  <div className="bleed-editor-dim" style={{
                    left: imageBounds.offsetX,
                    top: imageBounds.offsetY + selectionDisplay.top,
                    width: selectionDisplay.left, height: selectionDisplay.height,
                  }} />
                  <div className="bleed-editor-dim" style={{
                    left: imageBounds.offsetX + selectionDisplay.left + selectionDisplay.width,
                    top: imageBounds.offsetY + selectionDisplay.top,
                    width: imageBounds.displayWidth - selectionDisplay.left - selectionDisplay.width,
                    height: selectionDisplay.height,
                  }} />
                  <div className="bleed-editor-selection" style={{
                    left: imageBounds.offsetX + selectionDisplay.left,
                    top: imageBounds.offsetY + selectionDisplay.top,
                    width: selectionDisplay.width, height: selectionDisplay.height,
                  }} />
                </>
              )}

              {/* ガイドライン */}
              {imageBounds && guides.map((guide, i) => {
                const dPos = imageToDisplay(guide.position, guide.type);
                return guide.type === 'h' ? (
                  <div key={i}
                    className={`bleed-editor-guide bleed-editor-guide-h ${guidesLocked ? 'locked' : ''}`}
                    style={{ top: imageBounds.offsetY + dPos, left: imageBounds.offsetX, width: imageBounds.displayWidth }}
                    onMouseDown={(e) => handleGuideMouseDown(i, e)}
                    onDoubleClick={(e) => handleGuideDoubleClick(i, e)}
                  >
                  </div>
                ) : (
                  <div key={i}
                    className={`bleed-editor-guide bleed-editor-guide-v ${guidesLocked ? 'locked' : ''}`}
                    style={{ left: imageBounds.offsetX + dPos, top: imageBounds.offsetY, height: imageBounds.displayHeight }}
                    onMouseDown={(e) => handleGuideMouseDown(i, e)}
                    onDoubleClick={(e) => handleGuideDoubleClick(i, e)}
                  >
                  </div>
                );
              })}

              {/* ルーラードラッグ中のプレビューガイド */}
              {rulerDrag && imageBounds && (
                rulerDrag.type === 'h' ? (
                  <div className="bleed-editor-guide bleed-editor-guide-h preview"
                    style={{ top: imageBounds.offsetY + rulerDrag.displayPos, left: imageBounds.offsetX, width: imageBounds.displayWidth }}
                  />
                ) : (
                  <div className="bleed-editor-guide bleed-editor-guide-v preview"
                    style={{ left: imageBounds.offsetX + rulerDrag.displayPos, top: imageBounds.offsetY, height: imageBounds.displayHeight }}
                  />
                )
              )}
            </div>
          </div>

          {/* サイドパネル */}
          <div className="bleed-editor-panel">
            <div className="bleed-editor-panel-title">断ち切り範囲</div>
            {originalSize && (
              <div className="bleed-editor-image-size">元画像: {originalSize.width} x {originalSize.height}</div>
            )}

            {pageNav && pageNav.total > 1 && (
              <div className="bleed-page-nav">
                <div className="bleed-page-nav-head">プレビューするページ</div>
                <div className="bleed-page-nav-row">
                  <button
                    type="button"
                    className="bleed-page-nav-btn"
                    onClick={pageNav.onPrev}
                    disabled={pageNav.index <= 0}
                    title="前のページ"
                  >‹</button>
                  <span className="bleed-page-nav-count">{pageNav.index + 1} / {pageNav.total}</span>
                  <button
                    type="button"
                    className="bleed-page-nav-btn"
                    onClick={pageNav.onNext}
                    disabled={pageNav.index >= pageNav.total - 1}
                    title="次のページ"
                  >›</button>
                </div>
                {pageNav.label && (
                  <div className="bleed-page-nav-name" title={pageNav.label}>{pageNav.label}</div>
                )}
                <div className="bleed-page-nav-hint">トンボが見えるページで設定できます</div>
              </div>
            )}

            <button
              className={`btn-small bleed-lock-btn ${guidesLocked ? 'active' : ''}`}
              onClick={toggleLock}
              disabled={guides.length === 0}
              title={guidesLocked ? 'ガイドの確定を解除' : 'ガイドを確定'}
            >
              {guidesLocked ? <UnlockIcon size={14} /> : <LockIcon size={14} />}
              {guidesLocked ? '確定解除' : 'ガイドを確定'}
            </button>
            {guides.length > 0 && !guidesLocked && (
              <button className="btn-secondary btn-small bleed-reset-btn" style={{ marginTop: 8 }}
                onClick={() => { setGuides([]); setSelection(null); }}>
                <ResetIcon size={14} />
                ガイドをリセット
              </button>
            )}

            <div className="bleed-mode-section">
              <div className="bleed-mode-title">処理タイプ</div>
              <div className="bleed-mode-grid">
                {TACHIKIRI_CARDS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`bleed-mode-card ${tachikiriType === c.value ? 'selected' : ''}`}
                    onClick={() => setTachikiriType(c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {STROKE_TYPES.includes(tachikiriType) && (
                <div className="bleed-color-row">
                  <label>線の色</label>
                  <select value={strokeColor} onChange={(e) => setStrokeColor(e.target.value as BleedColor)}>
                    {COLOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <span className="bleed-color-swatch" style={{ background: BLEED_COLOR_MAP[strokeColor] }} />
                </div>
              )}

              {FILL_TYPES.includes(tachikiriType) && (
                <>
                  <div className="bleed-color-row">
                    <label>塗りの色</label>
                    <select value={fillColor} onChange={(e) => setFillColor(e.target.value as BleedColor)}>
                      {COLOR_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <span className="bleed-color-swatch" style={{ background: BLEED_COLOR_MAP[fillColor] }} />
                  </div>
                  <div className="bleed-opacity-row">
                    <label>不透明度: {fillOpacity}%</label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={fillOpacity}
                      onChange={(e) => setFillOpacity(parseInt(e.target.value, 10))}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="bleed-editor-footer">
          <div style={{ flex: 1 }} />
          <button className="btn-secondary btn-small" onClick={() => setShowCancelConfirm(true)}>キャンセル</button>
          <button className="btn-primary btn-small" onClick={onSkip} disabled={!!hasValidSelection}>
            {skipLabel}
          </button>
          <button className="btn-primary btn-small" onClick={() => region && onApply(region)} disabled={!canApply}>
            {applyLabel}
          </button>
        </div>
    </>
  );

  const cancelConfirm = showCancelConfirm ? (
    <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setShowCancelConfirm(false)}>
      <div className="modal-content delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-icon warning"><AlertTriangleIcon size={26} /></div>
        <h2>編集をキャンセルしますか？</h2>
        <p>断ち切り設定の変更を破棄します。</p>
        <div className="modal-footer">
          <button className="btn-secondary btn-small" onClick={() => setShowCancelConfirm(false)}>戻る</button>
          <button className="btn-danger btn-small" onClick={() => { setShowCancelConfirm(false); onCancel(); }}>キャンセルする</button>
        </div>
      </div>
    </div>
  ) : null;

  // 断ち切りタブ内インライン表示（中央＝プレビュー / 右＝操作パネル を1ブロックで占有）
  if (embedded) {
    return (
      <div className="bleed-editor-inline">
        {editorBody}
        {cancelConfirm}
      </div>
    );
  }

  return createPortal(
    <div className={`modal-overlay bleed-editor-overlay ${isClosing ? 'closing' : ''}`}>
      <div className={`bleed-editor-modal ${isClosing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        {editorBody}
      </div>
      {cancelConfirm}
    </div>,
    document.body
  );
}
