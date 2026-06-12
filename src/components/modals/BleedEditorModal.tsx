import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { BleedRegion, TachikiriType, BleedColor, BLEED_COLOR_MAP } from './ExportModal';
import { LockIcon, UnlockIcon, ResetIcon, AlertTriangleIcon } from '../../icons';
import { useModalAnimation } from '../../hooks';
import { useBleedStore } from '../../bleedStore';

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
  // ページ送り（方向キー / マウスホイール）用に最新の pageNav を保持
  const pageNavRef = useRef(pageNav);
  pageNavRef.current = pageNav;
  const lastWheelTime = useRef(0);

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
  // アクション/JSON から取り込んだぼかし半径(px)。編集可能（テキスト保持で自由入力）。
  const [blurRadiusText, setBlurRadiusText] = useState('0');
  const blurRadius = Math.max(0, parseFloat(blurRadiusText) || 0);
  // 既存の setBlurRadius(n) 呼び出し（.atn/JSON/初期値からの取り込み）を温存するラッパー
  const setBlurRadius = (n: number) => setBlurRadiusText(n > 0 ? String(n) : '0');

  // 断ち切り方式（断ち切りタブに一本化。グローバル設定をこの編集画面で選ぶ）
  const method = useBleedStore((s) => s.method);
  const setMethod = useBleedStore((s) => s.setMethod);
  const actionSetPath = useBleedStore((s) => s.actionSetPath);
  const setActionSetPath = useBleedStore((s) => s.setActionSetPath);
  const actionName = useBleedStore((s) => s.actionName);
  const setActionName = useBleedStore((s) => s.setActionName);
  const [atnActions, setAtnActions] = useState<string[]>([]);
  const [atnSetName, setAtnSetName] = useState('');
  const [atnError, setAtnError] = useState('');
  const [atnCrops, setAtnCrops] = useState<{ name: string; left: number; top: number; right: number; bottom: number; blurRadius?: number }[]>([]);

  // 選択した .atn からアクション名・切り抜き矩形を取得
  useEffect(() => {
    if (!actionSetPath) {
      setAtnActions([]); setAtnSetName(''); setAtnError(''); setAtnCrops([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await invoke<{ setName: string | null; actions: string[]; actionCrops?: { name: string; left: number; top: number; right: number; bottom: number; blurRadius?: number }[] }>('read_atn_actions', { path: actionSetPath });
        if (cancelled) return;
        const actions = info.actions ?? [];
        setAtnActions(actions);
        setAtnSetName(info.setName ?? '');
        setAtnCrops(info.actionCrops ?? []);
        setAtnError('');
        if (actionName && !actions.includes(actionName)) setActionName(actions.length === 1 ? actions[0] : '');
      } catch (e) {
        if (cancelled) return;
        setAtnActions([]); setAtnSetName(''); setAtnCrops([]); setAtnError(String(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionSetPath]);

  const selectedActionCrop = useMemo(
    () => atnCrops.find((c) => c.name === actionName) ?? null,
    [atnCrops, actionName],
  );

  const handleSelectActionSet = useCallback(async () => {
    const selected = await openDialog({
      title: 'Photoshopアクションセット(.atn)を選択',
      multiple: false,
      directory: false,
      filters: [{ name: 'Photoshopアクション', extensions: ['atn'] }],
    });
    if (typeof selected === 'string') setActionSetPath(selected);
  }, [setActionSetPath]);

  // --- JSONの縮尺（CLLENN共有JSON）方式 ---
  type CllennRange = { label: string; bounds: { left: number; top: number; right: number; bottom: number }; docWidth: number; docHeight: number; blurRadius: number };
  const [cllennDir, setCllennDir] = useState('');
  const [jsonLabels, setJsonLabels] = useState<string[]>([]);
  const [jsonLabel, setJsonLabel] = useState('');
  const [jsonWorks, setJsonWorks] = useState<{ name: string; path: string }[]>([]);
  const [jsonWorkPath, setJsonWorkPath] = useState('');
  const [jsonRanges, setJsonRanges] = useState<CllennRange[]>([]);
  const [jsonRangeIdx, setJsonRangeIdx] = useState(0);
  const [jsonError, setJsonError] = useState('');

  // json 方式選択時: 固定フォルダのパスとレーベル一覧を取得
  useEffect(() => {
    if (method !== 'json') return;
    let cancelled = false;
    (async () => {
      try {
        const dir = await invoke<string>('get_cllenn_json_dir');
        if (!cancelled) setCllennDir(dir);
        const labels = await invoke<string[]>('list_cllenn_labels');
        if (!cancelled) { setJsonLabels(labels); setJsonError(''); }
      } catch (e) {
        if (!cancelled) { setJsonLabels([]); setJsonError(String(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [method]);

  // レーベル選択 → 作品一覧
  useEffect(() => {
    if (method !== 'json' || !jsonLabel) { setJsonWorks([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const works = await invoke<{ name: string; path: string }[]>('list_cllenn_works', { label: jsonLabel });
        if (!cancelled) { setJsonWorks(works); setJsonError(''); }
      } catch (e) {
        if (!cancelled) { setJsonWorks([]); setJsonError(String(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [method, jsonLabel]);

  // 作品選択 → 範囲(selectionRanges)一覧
  useEffect(() => {
    if (method !== 'json' || !jsonWorkPath) { setJsonRanges([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const ranges = await invoke<CllennRange[]>('read_cllenn_ranges', { path: jsonWorkPath });
        if (!cancelled) { setJsonRanges(ranges); setJsonRangeIdx(ranges.length > 0 ? ranges.length - 1 : 0); setJsonError(''); }
      } catch (e) {
        if (!cancelled) { setJsonRanges([]); setJsonError(String(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [method, jsonWorkPath]);

  const selectedJsonRange = useMemo(
    () => (jsonRanges.length > 0 ? jsonRanges[Math.min(jsonRangeIdx, jsonRanges.length - 1)] ?? null : null),
    [jsonRanges, jsonRangeIdx],
  );

  // 選択中の JSON 範囲を、この画像サイズに合わせた選択範囲(元画像px)へ変換
  const computeJsonSelection = useCallback(() => {
    if (!selectedJsonRange || !originalSize) return null;
    const { bounds, docWidth, docHeight } = selectedJsonRange;
    if (!(docWidth > 0) || !(docHeight > 0)) return null;
    const sx = originalSize.width / docWidth;
    const sy = originalSize.height / docHeight;
    const left = Math.round(bounds.left * sx);
    const top = Math.round(bounds.top * sy);
    const right = Math.round(bounds.right * sx);
    const bottom = Math.round(bounds.bottom * sy);
    if (!(right > left) || !(bottom > top)) return null;
    return { left: Math.max(0, left), top: Math.max(0, top), right, bottom };
  }, [selectedJsonRange, originalSize]);

  // JSON範囲を読み込む（範囲＋ぼかし半径をビューアに反映）
  const loadJsonSelection = useCallback(() => {
    const sel = computeJsonSelection();
    if (sel) {
      setSelection(sel);
      setGuidesLocked(true);
      setTachikiriType((t) => (t === 'none' ? 'crop_only' : t));
      setBlurRadius(selectedJsonRange?.blurRadius ?? 0);
    }
  }, [computeJsonSelection, selectedJsonRange]);

  // json 方式: 範囲が未設定なら自動でビューアに表示
  useEffect(() => {
    if (method !== 'json' || selection) return;
    const sel = computeJsonSelection();
    if (sel) {
      setSelection(sel);
      setGuidesLocked(true);
      setTachikiriType((t) => (t === 'none' ? 'crop_only' : t));
      setBlurRadius(selectedJsonRange?.blurRadius ?? 0);
    }
  }, [method, computeJsonSelection, selection, selectedJsonRange]);

  const isActionMethod = method === 'action-ratio';

  // アクションの切り抜き比率を、この画像の中央に当てはめた選択範囲（元画像px）
  const computeActionSelection = useCallback(() => {
    if (!selectedActionCrop || !originalSize) return null;
    const { left, top, right, bottom } = selectedActionCrop;
    if (!(right > 0) || !(bottom > 0)) return null;
    const cw = ((right - left) / right) * originalSize.width;
    const ch = ((bottom - top) / bottom) * originalSize.height;
    const selLeft = Math.round((originalSize.width - cw) / 2);
    const selTop = Math.round((originalSize.height - ch) / 2);
    return { left: selLeft, top: selTop, right: Math.round(selLeft + cw), bottom: Math.round(selTop + ch) };
  }, [selectedActionCrop, originalSize]);

  // 比率方式: 範囲が未設定なら .atn の比率から中央配置の範囲を自動で入れてビューアに表示
  useEffect(() => {
    if (method !== 'action-ratio' || selection) return;
    const sel = computeActionSelection();
    if (sel) {
      setSelection(sel);
      setGuidesLocked(true);
      setTachikiriType((t) => (t === 'none' ? 'crop_only' : t));
      setBlurRadius(selectedActionCrop?.blurRadius ?? 0);
    }
  }, [method, computeActionSelection, selection, selectedActionCrop]);

  // アクションの比率から範囲を読み込む（手動再適用ボタン用）
  const loadActionSelection = useCallback(() => {
    const sel = computeActionSelection();
    if (sel) {
      setSelection(sel);
      setGuidesLocked(true);
      setTachikiriType((t) => (t === 'none' ? 'crop_only' : t));
      setBlurRadius(selectedActionCrop?.blurRadius ?? 0);
    }
  }, [computeActionSelection, selectedActionCrop]);

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
        setBlurRadius(initialRegion.blurRadius ?? 0);
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
        setBlurRadius(0);
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

  // 方向キーでプレビューページを送る（capture フェーズでグローバルの矢印キー処理＝選択移動を抑止）
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const n = pageNavRef.current;
      if (!n || n.total <= 1) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (n.index > 0) n.onPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (n.index < n.total - 1) n.onNext();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [isOpen]);

  // マウスホイールでプレビューページを送る（プレビュー領域上のスクロール。ページのスクロールは抑止）
  useEffect(() => {
    if (!isOpen) return;
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const n = pageNavRef.current;
      if (!n || n.total <= 1) return;
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelTime.current < 150) return; // 1ノッチ=1ページ送りになるようスロットル
      lastWheelTime.current = now;
      if (e.deltaY > 0) {
        if (n.index < n.total - 1) n.onNext();
      } else {
        if (n.index > 0) n.onPrev();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isOpen]);

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
      // 確定解除: 選択範囲をクリアしてガイド編集状態に戻す（確定時の薄暗いマスク＋選択枠を消す）
      setSelection(null);
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
      blurRadius: blurRadius > 0 ? blurRadius : undefined,
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
            <div className="bleed-editor-panel-title">断ち切り設定</div>
            {/* 断ち切り方式（全出力共通・断ち切りタブに一本化） */}
            <div className="bleed-editor-method">
              <label>方式</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="none">断ち切らない</option>
                <option value="region">範囲を描いて断ち切る</option>
                <option value="action-ratio">アクションの比率で断ち切る（中央揃え）</option>
                <option value="json">JSONの縮尺を利用する</option>
              </select>
            </div>

            {isActionMethod && (
              <div className="bleed-editor-action">
                <div className="form-group">
                  <label>アクションセット（.atnファイル）</label>
                  <div className="input-with-button">
                    <input type="text" value={actionSetPath} placeholder="エクスプローラーで .atn を選択..." readOnly />
                    <button type="button" className="btn-secondary btn-small" onClick={() => void handleSelectActionSet()}>参照</button>
                  </div>
                </div>
                {atnSetName && <div className="bleed-editor-hint">セット名: {atnSetName}</div>}
                <div className="form-group">
                  <label>アクション名</label>
                  {atnActions.length > 0 ? (
                    <select value={atnActions.includes(actionName) ? actionName : ''} onChange={(e) => setActionName(e.target.value)}>
                      <option value="">（アクションを選択してください）</option>
                      {atnActions.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={actionName} onChange={(e) => setActionName(e.target.value)} placeholder="例: 断ち切り" />
                  )}
                </div>
                {atnError && <div className="bleed-editor-hint" style={{ color: 'var(--color-error, #dc2626)' }}>.atnの解析に失敗しました（手入力してください）: {atnError}</div>}
                {selectedActionCrop && selectedActionCrop.right > 0 && (
                  <>
                    <div className="bleed-editor-hint">
                      抽出した切り抜き比率: 横 {((selectedActionCrop.right - selectedActionCrop.left) / selectedActionCrop.right * 100).toFixed(1)}% / 縦 {((selectedActionCrop.bottom - selectedActionCrop.top) / selectedActionCrop.bottom * 100).toFixed(1)}%（想定原稿 {Math.round(selectedActionCrop.right)}×{Math.round(selectedActionCrop.bottom)}px 基準）
                    </div>
                    <div className="bleed-editor-hint">
                      アクションのぼかし半径: {(selectedActionCrop.blurRadius ?? 0) > 0 ? `${selectedActionCrop.blurRadius}px` : 'なし'}（カラー原稿は自動で0）
                    </div>
                    <button type="button" className="btn-secondary btn-small" onClick={loadActionSelection} disabled={!originalSize}>
                      アクションの比率で範囲を入れ直す
                    </button>
                  </>
                )}
                <div className="bleed-editor-hint">
                  ※ アクションからは数値（切り抜き比率とぼかし半径）だけを取り出し、アプリのネイティブ処理で断ち切り・ぼかしを行います（Photoshopアクションは実行しません）。各画像の中央に当てはめた範囲をビューアに表示するので、ガイドや処理タイプで調整して「{applyLabel}」で確定してください（サイズ違いに自動追従）。
                </div>
              </div>
            )}

            {method === 'json' && (
              <div className="bleed-editor-action">
                <div className="bleed-editor-hint">
                  参照元（固定）: <span style={{ wordBreak: 'break-all' }}>{cllennDir || '取得中...'}</span>
                </div>
                <div className="form-group">
                  <label>レーベル</label>
                  <select value={jsonLabel} onChange={(e) => { setJsonLabel(e.target.value); setJsonWorkPath(''); setJsonRanges([]); }}>
                    <option value="">（レーベルを選択）</option>
                    {jsonLabels.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>作品</label>
                  <select value={jsonWorkPath} onChange={(e) => setJsonWorkPath(e.target.value)} disabled={!jsonLabel || jsonWorks.length === 0}>
                    <option value="">（作品を選択）</option>
                    {jsonWorks.map((w) => <option key={w.path} value={w.path}>{w.name}</option>)}
                  </select>
                </div>
                {jsonRanges.length > 0 && (
                  <div className="form-group">
                    <label>範囲（ラベル）</label>
                    <select value={String(jsonRangeIdx)} onChange={(e) => { setJsonRangeIdx(Number(e.target.value)); setSelection(null); }}>
                      {jsonRanges.map((r, i) => <option key={i} value={String(i)}>{r.label}</option>)}
                    </select>
                  </div>
                )}
                {selectedJsonRange && (
                  <>
                    <div className="bleed-editor-hint">
                      断ち切り範囲: {Math.round(selectedJsonRange.bounds.left)},{Math.round(selectedJsonRange.bounds.top)} – {Math.round(selectedJsonRange.bounds.right)},{Math.round(selectedJsonRange.bounds.bottom)}（基準 {Math.round(selectedJsonRange.docWidth)}×{Math.round(selectedJsonRange.docHeight)}px）
                    </div>
                    <div className="bleed-editor-hint">
                      JSONのぼかし半径: {(selectedJsonRange.blurRadius ?? 0) > 0 ? `${selectedJsonRange.blurRadius}px` : 'なし'}（カラー原稿は自動で0）
                    </div>
                    <button type="button" className="btn-secondary btn-small" onClick={loadJsonSelection} disabled={!originalSize}>
                      JSONの範囲を入れ直す
                    </button>
                  </>
                )}
                {jsonError && <div className="bleed-editor-hint" style={{ color: 'var(--color-error, #dc2626)' }}>{jsonError}</div>}
                <div className="bleed-editor-hint">
                  ※ CLLENNの共有JSON（縮尺）から断ち切り範囲とぼかし半径を取り出し、アプリのネイティブ処理で断ち切り・ぼかしを行います。ガイドや処理タイプで調整して「{applyLabel}」で確定してください（サイズ違いに自動追従）。
                </div>
              </div>
            )}

            {method === 'none' && (
              <div className="bleed-editor-hint">断ち切りを行いません。下の「{applyLabel}」で閉じてください。</div>
            )}

            {(method === 'region' || method === 'action-ratio' || method === 'json') && (<>
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

            <div className="bleed-mode-section">
              <div className="bleed-mode-title">ぼかし（ガウス）</div>
              <div className="bleed-color-row">
                <label>半径(px)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={blurRadiusText}
                  onChange={(e) => setBlurRadiusText(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="例: 2.5"
                  style={{ width: 80 }}
                />
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => setBlurRadiusText('0')}
                  disabled={blurRadius <= 0}
                >なし(0)</button>
              </div>
              <div className="bleed-editor-hint">
                {blurRadius > 0
                  ? `半径 ${blurRadius}px でぼかします（文字は保護＝背景のみ・カラー原稿は出力時に自動で0）。アクション/JSONから取り込んだ値をここで変更できます。`
                  : 'ぼかしなし（0）。値を入れるとモノクロ原稿にガウスぼかしを適用します（アクション/JSON選択時はその値が自動で入ります）。'}
              </div>
            </div>
            </>)}
          </div>
        </div>

        <div className="bleed-editor-footer">
          <div style={{ flex: 1 }} />
          <button className="btn-secondary btn-small" onClick={() => setShowCancelConfirm(true)}>キャンセル</button>
          {method === 'region' || method === 'action-ratio' || method === 'json' ? (
            <>
              <button className="btn-primary btn-small" onClick={onSkip} disabled={!!hasValidSelection}>
                {skipLabel}
              </button>
              <button className="btn-primary btn-small" onClick={() => region && onApply(region)} disabled={!canApply}>
                {applyLabel}
              </button>
            </>
          ) : (
            // 「断ち切らない」は全出力共通設定。ここでは閉じるだけ（即時 bleedStore 反映済み）
            <button className="btn-primary btn-small" onClick={onCancel}>
              {applyLabel}
            </button>
          )}
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
      <div className={`bleed-editor-inline ${isClosing ? 'closing' : ''}`}>
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
