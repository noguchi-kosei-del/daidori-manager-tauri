import { useState, useMemo, useCallback, useEffect, useRef, type ReactNode, type CSSProperties } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import { useBleedStore } from '../../bleedStore';
import { useSlidingIndicator } from '../../hooks';
import { SlidingIndicator } from '../SlidingIndicator';
import { BleedEditorModal } from '../modals/BleedEditorModal';
import type { BleedRegion } from '../modals/ExportModal';
import type { Chapter, Page, ThumbnailResult } from '../../types';
import { NoPageIcon, ScissorsIcon } from '../../icons';

// 断ち切り方式 → 日本語ラベル（サマリ表示用）
const BLEED_METHOD_LABELS: Record<string, string> = {
  none: '断ち切らない',
  region: '範囲を描いて断ち切る',
  'action-ratio': 'アクションの比率（中央揃え）',
  json: 'JSONの縮尺を利用する',
};

// 断ち切りモードの処理タイプ → 日本語ラベル
const TACHIKIRI_LABELS: Record<string, string> = {
  none: '断ち切りなし',
  crop_only: '切り抜き',
  crop_and_stroke: '切り抜き＋線',
  stroke_only: '線のみ',
  fill_white: '塗り',
  fill_and_stroke: '塗り＋線',
};

interface BleedTarget {
  kind: 'cover' | 'body' | 'chapter';
  chapterId?: string;
  label: string;
  page: Page; // 代表ページ（断ち切り編集の初期プレビュー対象）
  pages: Page[]; // 同一対象の全ファイルページ（ページ送り用）
}

// チャプター内の画像ファイルページを順序どおり収集
function collectFilePages(chapter: Chapter): Page[] {
  return chapter.pages.filter((p) => p.filePath && p.fileType);
}

// 代表ページ＝PSD優先（ガイド自動読込が効く）。無ければ先頭
function pickRepresentative(pages: Page[]): Page | null {
  if (pages.length === 0) return null;
  return pages.find((p) => p.fileType === 'psd') ?? pages[0];
}

// 区切り（対象）の全ページのカラー情報から、ぼかしの初期ON/OFFを決める。
// カラー(RGB/CMYK)主体＝なし(false) / モノクロ(Grayscale/Bitmap)主体＝あり(true)。
// カラー情報が無い場合は従来どおり あり(true)。
function sectionDefaultBlurEnabled(pages: Page[]): boolean {
  let color = 0;
  let mono = 0;
  for (const p of pages) {
    const m = p.imageColorMode;
    if (m === 'RGB' || m === 'CMYK') color++;
    else if (m === 'Grayscale' || m === 'Bitmap') mono++;
  }
  return color > mono ? false : true;
}

interface BleedTabProps {
  isInfoSidebarCollapsed: boolean;
  setIsInfoSidebarCollapsed: (collapsed: boolean) => void;
  // 範囲設定（BleedEditorModal）の開閉を親へ通知（左の台割ツリー表示制御用）
  onEditingChange: (editing: boolean) => void;
  // 色/サイズサマリ（台割の preview-area と同じ color-mode-summary-container）
  topBar?: ReactNode;
}

export function BleedTab({ isInfoSidebarCollapsed, setIsInfoSidebarCollapsed, onEditingChange, topBar }: BleedTabProps) {
  const chapters = useStore((s) => s.chapters);
  const {
    mode,
    coverRegion,
    bodyRegion,
    perChapterRegions,
    method,
    setMode,
    setCoverRegion,
    setBodyRegion,
    setChapterRegion,
    reset,
  } = useBleedStore();

  // 一括/本文ごとトグルのスライドインジケーター
  const { containerRef: modeToggleRef, rect: modeIndicator } = useSlidingIndicator<HTMLDivElement>(mode);

  const [editing, setEditing] = useState<{
    target: BleedTarget;
    pageIndex: number;
    thumbnailPath: string;
    initialRegion: BleedRegion | null;
  } | null>(null);
  // 範囲設定エディタの開閉（閉じる時は退場アニメ→約300ms後に editing をクリア）
  const [editorOpen, setEditorOpen] = useState(false);
  // 一括処理の選択モード（本文カードを直接クリックして最初→最後を選ぶ）。
  // 「最後」を押すと範囲を“仮適用”して続けて次の一括設定が始まる（連続）。最後に「適用」で全範囲を確定。
  // 最初=設定済みのみ／最後=任意カード可。
  const [bulkSelecting, setBulkSelecting] = useState(false);
  const [bulkRanges, setBulkRanges] = useState<{ startId: string; endId: string }[]>([]);
  const [bulkPendingStartId, setBulkPendingStartId] = useState('');

  // 設定→上へスライドして開く / キャンセル等→下へスライドして閉じる。
  // editing を即 null にせず、退場アニメーション後にクリアする。
  const requestCloseEditor = useCallback(() => {
    setEditorOpen(false);
    window.setTimeout(() => setEditing(null), 300);
  }, []);

  // 範囲設定の開閉を親へ通知（開いている間は左の台割ツリーを隠す）。
  // アンマウント時は false に戻して、タブ復帰時の一瞬の非表示を防ぐ。
  useEffect(() => {
    onEditingChange(!!editing);
    return () => onEditingChange(false);
  }, [editing, onEditingChange]);

  // 対象一覧を構築（mode により本文=代表1件 or 本文ごと）
  const targets = useMemo<BleedTarget[]>(() => {
    const list: BleedTarget[] = [];
    // 表紙
    for (const chapter of chapters) {
      if (chapter.type !== 'cover') continue;
      const pages = collectFilePages(chapter);
      const rep = pickRepresentative(pages);
      if (rep) {
        list.push({ kind: 'cover', label: '表紙', page: rep, pages });
        break;
      }
    }
    if (mode === 'per-chapter') {
      for (const chapter of chapters) {
        if (chapter.type !== 'chapter') continue;
        const pages = collectFilePages(chapter);
        const rep = pickRepresentative(pages);
        if (rep) {
          list.push({ kind: 'chapter', chapterId: chapter.id, label: chapter.name, page: rep, pages });
        }
      }
    } else {
      // 一括: 本文側の全ファイルページをページ送り対象にする
      const bodyPages: Page[] = [];
      for (const chapter of chapters) {
        if (chapter.type === 'cover') continue;
        bodyPages.push(...collectFilePages(chapter));
      }
      const rep = pickRepresentative(bodyPages);
      if (rep) {
        list.push({ kind: 'body', label: '本文（一括）', page: rep, pages: bodyPages });
      }
    }
    return list;
  }, [chapters, mode]);

  const getTargetRegion = useCallback((target: BleedTarget): BleedRegion | null => {
    if (target.kind === 'cover') return coverRegion;
    if (target.kind === 'body') return bodyRegion;
    if (target.kind === 'chapter' && target.chapterId) return perChapterRegions[target.chapterId] ?? null;
    return null;
  }, [coverRegion, bodyRegion, perChapterRegions]);

  const ensureThumbnail = useCallback(async (page: Page): Promise<string | null> => {
    if (page.thumbnailCachePath) return page.thumbnailCachePath;
    if (!page.filePath) return null;
    try {
      const result = await invoke<ThumbnailResult>('generate_thumbnail', {
        filePath: page.filePath,
        modifiedTime: page.modifiedTime ?? 0,
      });
      return result.cache_path;
    } catch (e) {
      console.error('断ち切りプレビューのサムネイル生成に失敗:', e);
      return null;
    }
  }, []);

  const openEditor = useCallback(async (target: BleedTarget) => {
    const startIndex = Math.max(0, target.pages.indexOf(target.page));
    const thumb = await ensureThumbnail(target.pages[startIndex] ?? target.page);
    if (!thumb) return;
    setEditing({ target, pageIndex: startIndex, thumbnailPath: thumb, initialRegion: getTargetRegion(target) });
    setEditorOpen(true);
  }, [ensureThumbnail, getTargetRegion]);

  // ページ送り（黒ベタ等でトンボが見えない時に同一対象の別ページを表示）
  const goToEditorPage = useCallback(async (index: number) => {
    if (!editing) return;
    const pages = editing.target.pages;
    if (index < 0 || index >= pages.length) return;
    const thumb = await ensureThumbnail(pages[index]);
    if (!thumb) return;
    setEditing((prev) => (prev ? { ...prev, pageIndex: index, thumbnailPath: thumb } : prev));
  }, [editing, ensureThumbnail]);

  const saveRegion = useCallback((target: BleedTarget, region: BleedRegion | null) => {
    if (target.kind === 'cover') setCoverRegion(region);
    else if (target.kind === 'body') setBodyRegion(region);
    else if (target.kind === 'chapter' && target.chapterId) setChapterRegion(target.chapterId, region);
  }, [setCoverRegion, setBodyRegion, setChapterRegion]);

  // null=未設定 / 非null（'none'含む）=設定済み
  const configuredCount = targets.filter((t) => getTargetRegion(t) != null).length;

  // 「一括処理」: 編集済みの本文カードから「最初（基準）」をクリック→「最後」を任意カードでクリック、を
  // 繰り返して複数の範囲を作り、各範囲へ「最初」の設定をコピーする（本文ごとモード用）。
  const chapterTargets = useMemo(() => targets.filter((t) => t.kind === 'chapter' && t.chapterId), [targets]);
  const canOpenBulk = mode === 'per-chapter' && chapterTargets.length >= 2;
  const bulkApplyTitle = mode !== 'per-chapter'
    ? '「本文ごと」モードで使えます（最初を基準に範囲へコピー）'
    : chapterTargets.length < 2
      ? '本文が2つ以上あるときに使えます'
      : '編集済みの「最初」→「最後」を選び（複数可）、最初の設定を各範囲へコピーします';
  // 各範囲の chapterTargets 内インデックス境界（ハイライト用）
  const bulkRangeBounds = useMemo(() => bulkRanges.map((r) => {
    const sIdx = chapterTargets.findIndex((t) => t.chapterId === r.startId);
    const eIdx = chapterTargets.findIndex((t) => t.chapterId === r.endId);
    return { startId: r.startId, endId: r.endId, lo: Math.min(sIdx, eIdx), hi: Math.max(sIdx, eIdx) };
  }), [bulkRanges, chapterTargets]);
  const bulkPendingLabel = bulkPendingStartId
    ? (chapterTargets.find((t) => t.chapterId === bulkPendingStartId)?.label ?? '')
    : '';

  const toggleBulkSelecting = useCallback(() => {
    setBulkSelecting((v) => {
      if (!v) { setBulkRanges([]); setBulkPendingStartId(''); }
      return !v;
    });
  }, []);
  const exitBulkSelecting = useCallback(() => {
    setBulkSelecting(false);
    setBulkRanges([]);
    setBulkPendingStartId('');
  }, []);
  // 最新の pending を常に参照できるよう ref に同期（連続クリックでの取り残しを防ぐ）
  const bulkPendingRef = useRef('');
  bulkPendingRef.current = bulkPendingStartId;
  const setPending = useCallback((v: string) => { bulkPendingRef.current = v; setBulkPendingStartId(v); }, []);
  // カードクリック（複数の仮選択を連続で積める。範囲の取消はバナー一覧の×／全消去は選択クリア）:
  //  - 最後待ち（最初を選択済み）:
  //      ・同じ「最初」をもう一度 → この回の仮選択を取消（最初待ちへ・モードは維持）
  //      ・別カード → 「最後」として範囲を仮追加し、続けて次の一括設定が始まる（pending は必ずクリア）
  //  - 最初待ち: 設定済みカード → 新しい「最初」に（既存範囲に含まれる基準でも再利用OK）
  const handleBulkSelect = useCallback((target: BleedTarget, isSet: boolean) => {
    if (!target.chapterId) return;
    const id = target.chapterId;
    const pending = bulkPendingRef.current; // state ではなく ref で最新値を読む
    if (pending) {
      if (id === pending) {
        setPending(''); // この回の仮選択を取消
        return;
      }
      // 「最後」を確定 → 範囲を仮追加し、pending をクリアして次の「最初」を待つ
      setBulkRanges((prev) => [...prev, { startId: pending, endId: id }]);
      setPending('');
      return;
    }
    // 最初待ち: 設定済みカードを新しい「最初」に（基準の再利用も可）
    if (!isSet) return;
    setPending(id);
  }, [setPending]);
  const removeBulkRange = useCallback((ri: number) => {
    setBulkRanges((prev) => prev.filter((_, i) => i !== ri));
  }, []);
  // 各範囲の「最初」の region を、その範囲の本文すべてへコピー
  const applyBulkRanges = useCallback(() => {
    if (bulkRanges.length === 0) return;
    for (const r of bulkRanges) {
      const sIdx = chapterTargets.findIndex((t) => t.chapterId === r.startId);
      const eIdx = chapterTargets.findIndex((t) => t.chapterId === r.endId);
      if (sIdx < 0 || eIdx < 0) continue;
      const refRegion = getTargetRegion(chapterTargets[sIdx]); // 「最初」を基準にコピペ
      if (refRegion == null) continue;
      const lo = Math.min(sIdx, eIdx);
      const hi = Math.max(sIdx, eIdx);
      for (let i = lo; i <= hi; i++) {
        const t = chapterTargets[i];
        if (t.chapterId) setChapterRegion(t.chapterId, refRegion);
      }
    }
    exitBulkSelecting();
  }, [bulkRanges, chapterTargets, getTargetRegion, setChapterRegion, exitBulkSelecting]);

  return (
    <>
      {!editing && (
      <>
      <div className="preview-area bleed-tab-area">
        {topBar}
        <div className="bleed-tab-header">
          <div className="bleed-tab-title">
            <ScissorsIcon size={18} />
            <span>断ち切り設定</span>
            <div className="bleed-tab-mode" ref={modeToggleRef}>
              <SlidingIndicator rect={modeIndicator} className="bleed-tab-mode-indicator" />
              <button
                type="button"
                className={`bleed-tab-mode-btn ${mode === 'bulk' ? 'active' : ''}`}
                onClick={() => setMode('bulk')}
              >
                一括（表紙＋本文）
              </button>
              <button
                type="button"
                className={`bleed-tab-mode-btn ${mode === 'per-chapter' ? 'active' : ''}`}
                onClick={() => setMode('per-chapter')}
              >
                本文ごと
              </button>
            </div>
          </div>
          <div className="bleed-tab-header-actions">
            <button
              type="button"
              className={`btn-secondary btn-small bleed-bulk-apply-btn ${bulkSelecting ? 'active' : ''}`}
              onClick={toggleBulkSelecting}
              disabled={!canOpenBulk}
              title={bulkApplyTitle}
            >
              一括処理
            </button>
          </div>
        </div>

        {bulkSelecting && canOpenBulk && (
          <div className="bleed-bulk-banner">
            <div className="bleed-bulk-banner-main">
              <span className="bleed-bulk-banner-text">
                一括処理（仮選択）: <b>最初（基準）</b> → <b>最後</b> をクリックで1範囲を仮選択。続けて次の範囲を選べます。<b>適用</b> で全範囲を確定。
              </span>
              <span className="bleed-bulk-banner-status">
                {bulkPendingStartId
                  ? <>最初: <b>{bulkPendingLabel}</b> → 最後をクリック</>
                  : <>仮選択 <b>{bulkRanges.length}</b> 組</>}
              </span>
              <span className="bleed-bulk-banner-actions">
                <button
                  type="button"
                  className="btn-primary btn-small"
                  onClick={applyBulkRanges}
                  disabled={bulkRanges.length === 0}
                  title={bulkRanges.length === 0 ? '範囲を1つ以上作ってください' : '各範囲へ最初の設定をコピーします'}
                >
                  適用（{bulkRanges.length}）
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => { setBulkRanges([]); setBulkPendingStartId(''); }}
                  disabled={bulkRanges.length === 0 && !bulkPendingStartId}
                >
                  選択クリア
                </button>
                <button type="button" className="btn-secondary btn-small" onClick={exitBulkSelecting}>
                  キャンセル
                </button>
              </span>
            </div>
            {bulkRanges.length > 0 && (
              <ol className="bleed-bulk-range-list">
                {bulkRangeBounds
                  .map((b, ri) => ({ b, ri }))
                  .sort((a, c) => (a.b.lo - c.b.lo) || (a.b.hi - c.b.hi))
                  .map(({ b, ri }) => {
                    const sLabel = chapterTargets.find((t) => t.chapterId === b.startId)?.label ?? '?';
                    const eLabel = chapterTargets.find((t) => t.chapterId === b.endId)?.label ?? '?';
                    const count = b.lo >= 0 && b.hi >= 0 ? b.hi - b.lo + 1 : 0;
                    return (
                      <li
                        key={`${b.startId}-${b.endId}-${ri}`}
                        className="bleed-bulk-range-chip"
                        style={{ ['--bulk-color' as string]: `var(--split-color-${ri % 8})` } as CSSProperties}
                      >
                        <span className="bleed-bulk-range-chip-label"><b>{sLabel}</b> → <b>{eLabel}</b>{count > 0 && <small>（{count}話）</small>}</span>
                        <button type="button" className="bleed-bulk-range-x" onClick={() => removeBulkRange(ri)} title="この範囲を取消">×</button>
                      </li>
                    );
                  })}
              </ol>
            )}
          </div>
        )}

        {targets.length === 0 ? (
          <div className="spread-viewer-empty">
            <NoPageIcon size={48} />
            <p>断ち切りを設定できる画像ページがありません</p>
          </div>
        ) : (
          <div className="bleed-target-grid">
            {targets.map((target) => {
              const region = getTargetRegion(target);
              const isSet = region != null;
              const key = target.kind === 'chapter' ? `chapter-${target.chapterId}` : target.kind;
              const thumbSrc = target.page.thumbnailCachePath
                ? convertFileSrc(target.page.thumbnailCachePath)
                : null;
              // 一括処理の選択モード。最初=設定済みのみ／最後=（最初確定後は）任意カード可。複数範囲を色分け。
              const chapterIdx = target.kind === 'chapter' ? chapterTargets.findIndex((ct) => ct.chapterId === target.chapterId) : -1;
              const isChapter = target.kind === 'chapter';
              let bulkCls = '';
              let bulkColorIdx = -1;
              if (bulkSelecting && isChapter) {
                if (target.chapterId === bulkPendingStartId) {
                  bulkCls = 'bulk-pending';
                } else {
                  const ri = bulkRangeBounds.findIndex((b) =>
                    target.chapterId === b.startId || target.chapterId === b.endId ||
                    (b.lo >= 0 && chapterIdx >= b.lo && chapterIdx <= b.hi));
                  if (ri >= 0) {
                    const b = bulkRangeBounds[ri];
                    bulkColorIdx = ri;
                    bulkCls = target.chapterId === b.startId ? 'bulk-start'
                      : target.chapterId === b.endId ? 'bulk-end'
                      : 'bulk-in-range';
                  } else if (!isSet && !bulkPendingStartId) {
                    bulkCls = 'bulk-disabled';
                  } else {
                    bulkCls = 'bulk-selectable';
                  }
                }
              }
              const bulkStyle = bulkColorIdx >= 0
                ? ({ ['--bulk-color' as string]: `var(--split-color-${bulkColorIdx % 8})` } as CSSProperties)
                : undefined;
              // 選択可: 最後待ち(pending)=任意の本文 / 最初待ち=設定済みのみ（基準＝最初は設定済みが必須）
              const bulkSelectable = bulkSelecting && isChapter && (bulkPendingStartId ? true : isSet);
              return (
                <div
                  key={key}
                  className={`bleed-target-card ${isSet ? 'configured' : ''} ${bulkCls}`}
                  style={bulkStyle}
                  onClick={bulkSelectable ? () => handleBulkSelect(target, isSet) : undefined}
                  role={bulkSelectable ? 'button' : undefined}
                >
                  <div className="bleed-target-thumb">
                    {thumbSrc ? (
                      <img src={thumbSrc} alt={target.label} draggable={false} />
                    ) : (
                      <div className="bleed-target-thumb-empty"><NoPageIcon size={32} /></div>
                    )}
                    <span className={`bleed-target-status ${isSet ? 'on' : 'off'}`}>
                      {isSet ? '設定済み' : '未設定'}
                    </span>
                  </div>
                  <div className="bleed-target-info">
                    <div className="bleed-target-label" title={target.label}>{target.label}</div>
                    <div className="bleed-target-detail">
                      {isSet ? (TACHIKIRI_LABELS[region!.tachikiriType] ?? region!.tachikiriType) : '—'}
                    </div>
                  </div>
                  <div className="bleed-target-actions">
                    <button
                      type="button"
                      className="btn-primary btn-small"
                      onClick={(e) => { e.stopPropagation(); void openEditor(target); }}
                    >
                      {isSet ? '編集' : '設定'}
                    </button>
                    {isSet && (
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        onClick={(e) => { e.stopPropagation(); saveRegion(target, null); }}
                      >
                        解除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <aside className={`sidebar sidebar-right bleed-tab-sidebar ${isInfoSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <button
            className="sidebar-toggle-btn"
            onClick={() => setIsInfoSidebarCollapsed(!isInfoSidebarCollapsed)}
            title={isInfoSidebarCollapsed ? 'サマリを展開' : 'サマリを折り畳む'}
          >
            {isInfoSidebarCollapsed ? '«' : '»'}
          </button>
        </div>
        <div className="sidebar-content">
          <div className="bleed-summary-panel">
            <div className="bleed-summary-head">
              <h3 className="bleed-summary-title">断ち切りサマリ</h3>
              <span className="bleed-summary-count">{configuredCount}/{targets.length}</span>
            </div>
            <div className="bleed-summary-stats">
              <div className="bleed-summary-stat">
                <span>方式</span>
                <span>{BLEED_METHOD_LABELS[method] ?? method}</span>
              </div>
              <div className="bleed-summary-stat">
                <span>適用範囲</span>
                <span>{mode === 'bulk' ? '一括（表紙＋本文）' : '本文ごと'}</span>
              </div>
              <div className="bleed-summary-stat">
                <span>設定済み</span>
                <span>{configuredCount} / {targets.length}</span>
              </div>
              {(() => {
                const blurs = [coverRegion?.blurRadius, bodyRegion?.blurRadius, ...Object.values(perChapterRegions).map((r) => r.blurRadius)]
                  .filter((b): b is number => typeof b === 'number' && b > 0);
                if (blurs.length === 0) return null;
                const uniq = Array.from(new Set(blurs)).sort((a, b) => a - b);
                return (
                  <div className="bleed-summary-stat">
                    <span>ぼかし</span>
                    <span>{uniq.map((b) => `${b}px`).join(' / ')}（カラーは0）</span>
                  </div>
                );
              })()}
            </div>
            {configuredCount > 0 && (
              <button type="button" className="btn-secondary btn-small bleed-summary-clear" onClick={reset}>
                すべて解除
              </button>
            )}
          </div>
        </div>
      </aside>
      </>
      )}

      {editing && (() => {
        const curPage = editing.target.pages[editing.pageIndex] ?? editing.target.page;
        return (
          <BleedEditorModal
            embedded
            key={editing.target.kind === 'chapter' ? `chapter-${editing.target.chapterId}` : editing.target.kind}
            isOpen={editorOpen}
            label={editing.target.label}
            thumbnailPath={editing.thumbnailPath}
            originalFilePath={curPage.filePath ?? ''}
            originalColorMode={curPage.imageColorMode}
            initialRegion={editing.initialRegion}
            // 方式デフォルト: 本文（一括/各話）=手動 / 表紙など それ以外=なし
            defaultMethod={editing.target.kind === 'cover' ? 'none' : 'region'}
            // ぼかしの初期ON/OFFは区切りのカラー情報で決定（カラー=なし / モノクロ=あり）
            defaultBlurEnabled={sectionDefaultBlurEnabled(editing.target.pages)}
            applyLabel="この設定を保存"
            pageNav={editing.target.pages.length > 1 ? {
              index: editing.pageIndex,
              total: editing.target.pages.length,
              label: curPage.fileName,
              onPrev: () => { void goToEditorPage(editing.pageIndex - 1); },
              onNext: () => { void goToEditorPage(editing.pageIndex + 1); },
            } : undefined}
            onApply={(region) => { saveRegion(editing.target, region); requestCloseEditor(); }}
            onCancel={() => requestCloseEditor()}
          />
        );
      })()}
    </>
  );
}
