import { useState, useRef, useCallback, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { BleedMargins } from './ExportModal';
import { LockIcon, UnlockIcon, ResetIcon } from '../../icons';

interface Guide {
  type: 'h' | 'v';
  position: number; // 元画像のピクセル座標
}

interface BleedEditorModalProps {
  isOpen: boolean;
  label: string;
  thumbnailPath: string;
  originalFilePath: string;
  onApply: (margins: BleedMargins) => void;
  onSkip: () => void;
  onCancel: () => void;
}

export function BleedEditorModal({
  isOpen,
  label,
  thumbnailPath,
  originalFilePath,
  onApply,
  onSkip,
  onCancel,
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

  // リセット
  useEffect(() => {
    if (isOpen) {
      setGuides([]);
      setGuidesLocked(false);
      setRulerDrag(null);
      setGuideDrag(null);
      setSelection(null);
      isDragging.current = false;
      setShowCancelConfirm(false);
    }
  }, [isOpen, originalFilePath]);

  // 元画像サイズ取得
  useEffect(() => {
    if (!isOpen || !originalFilePath) return;
    invoke<[number, number]>('get_image_dimensions', { path: originalFilePath })
      .then(([w, h]) => setOriginalSize({ width: w, height: h }))
      .catch(() => setOriginalSize(null));
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
    if (selection) {
      setHint('範囲OK — エクスポート可能です');
    } else if (guidesLocked) {
      setHint('画像上をドラッグして断ち切り範囲を選択（ガイドにスナップします）');
    } else if (guides.length === 0) {
      setHint('上・左のルーラーからドラッグしてガイド線を作成してください（不要な場合はスキップしてエクスポートを選択）');
    } else {
      setHint('ガイドを配置したら「ロック」ボタンを押してください');
    }
  }, [isOpen, guides.length, guidesLocked, selection]);

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
  }, [guidesLocked, clientToImageCoord, snapToGuides]);

  // ロック切替
  const toggleLock = useCallback(() => {
    setGuidesLocked(prev => !prev);
    setGuideDrag(null);
    if (!guidesLocked) setSelection(null);
  }, [guidesLocked]);

  // マージン計算
  const margins: BleedMargins | null = (() => {
    if (!originalSize || !selection) return null;
    return {
      left: Math.max(0, selection.left),
      top: Math.max(0, selection.top),
      right: Math.max(0, originalSize.width - selection.right),
      bottom: Math.max(0, originalSize.height - selection.bottom),
    };
  })();

  const hasValidSelection = selection != null && selection.right > selection.left && selection.bottom > selection.top;

  // 選択範囲の表示座標
  const selectionDisplay = (() => {
    if (!selection || !imageBounds || !originalSize) return null;
    const l = imageToDisplay(selection.left, 'v');
    const t = imageToDisplay(selection.top, 'h');
    const r = imageToDisplay(selection.right, 'v');
    const b = imageToDisplay(selection.bottom, 'h');
    return { left: l, top: t, width: r - l, height: b - t };
  })();

  if (!isOpen) return null;

  return (
    <div className="modal-overlay bleed-editor-overlay">
      <div className="bleed-editor-modal" onClick={(e) => e.stopPropagation()}>
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
            <button
              className={`btn-small bleed-lock-btn ${guidesLocked ? 'active' : ''}`}
              onClick={toggleLock}
              disabled={guides.length === 0}
              title={guidesLocked ? 'ガイドのロックを解除' : 'ガイドをロック'}
            >
              {guidesLocked ? <UnlockIcon size={14} /> : <LockIcon size={14} />}
              {guidesLocked ? 'ロック解除' : 'ガイドをロック'}
            </button>
            {guides.length > 0 && !guidesLocked && (
              <button className="btn-secondary btn-small bleed-reset-btn" style={{ marginTop: 8 }}
                onClick={() => { setGuides([]); setSelection(null); }}>
                <ResetIcon size={14} />
                ガイドをリセット
              </button>
            )}
          </div>
        </div>

        <div className="bleed-editor-footer">
          <div style={{ flex: 1 }} />
          <button className="btn-secondary btn-small" onClick={() => setShowCancelConfirm(true)}>キャンセル</button>
          <button className="btn-primary btn-small" onClick={onSkip} disabled={!!hasValidSelection}>
            スキップしてエクスポート
          </button>
          <button className="btn-primary btn-small" onClick={() => margins && onApply(margins)} disabled={!hasValidSelection}>
            エクスポート
          </button>
        </div>
      </div>

      {/* キャンセル確認ダイアログ */}
      {showCancelConfirm && (
        <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setShowCancelConfirm(false)}>
          <div className="modal-content delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>エクスポートをキャンセルしますか？</h2>
            <p>断ち切り設定を破棄してエクスポートを中止します。</p>
            <div className="modal-footer">
              <button className="btn-secondary btn-small" onClick={() => setShowCancelConfirm(false)}>戻る</button>
              <button className="btn-danger btn-small" onClick={() => { setShowCancelConfirm(false); onCancel(); }}>キャンセルする</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
