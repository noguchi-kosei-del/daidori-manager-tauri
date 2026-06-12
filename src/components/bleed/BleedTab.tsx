import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
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

// 「断ち切りなし」を明示設定したことを表す region（null=未設定 と区別するため）
const NONE_REGION: BleedRegion = {
  left: 0, top: 0, right: 0, bottom: 0,
  refWidth: 0, refHeight: 0,
  tachikiriType: 'none',
  strokeColor: 'black',
  fillColor: 'white',
  fillOpacity: 100,
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
          </div>
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
              return (
                <div key={key} className={`bleed-target-card ${isSet ? 'configured' : ''}`}>
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
                      onClick={() => void openEditor(target)}
                    >
                      {isSet ? '編集' : '設定'}
                    </button>
                    {isSet && (
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        onClick={() => saveRegion(target, null)}
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
            <h3 className="bleed-summary-title">断ち切りサマリ</h3>
            <p className="bleed-summary-note">
              各ページの「設定/編集」を開いて、方式（範囲 / アクションの比率 / JSONの縮尺）と断ち切りを設定します。
              アクション・JSONからは数値（断ち切り範囲＋ぼかし半径）だけを取り込み、アプリのネイティブ処理で断ち切り・ぼかしを行います。
              ここで設定した断ち切りは「出力」タブのすべての出力（JPEG / TIFF / PDF）に適用されます。
              プロジェクトファイルには保存されません。
            </p>
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
            initialRegion={editing.initialRegion}
            applyLabel="この設定を保存"
            skipLabel="断ち切りなしにする"
            pageNav={editing.target.pages.length > 1 ? {
              index: editing.pageIndex,
              total: editing.target.pages.length,
              label: curPage.fileName,
              onPrev: () => { void goToEditorPage(editing.pageIndex - 1); },
              onNext: () => { void goToEditorPage(editing.pageIndex + 1); },
            } : undefined}
            onApply={(region) => { saveRegion(editing.target, region); requestCloseEditor(); }}
            onSkip={() => { saveRegion(editing.target, NONE_REGION); requestCloseEditor(); }}
            onCancel={() => requestCloseEditor()}
          />
        );
      })()}
    </>
  );
}
