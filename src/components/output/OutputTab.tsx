import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import { useBleedStore } from '../../bleedStore';
import { ExportModal } from '../modals/ExportModal';
import { EpubMakerView, EpubWizard } from '../epub';
import { ViewerControls } from '../preview/ViewerControls';
import { computeSlideDirection } from '../../utils/slideDirection';
import type { ExportOptions } from '../modals/ExportModal';
import type { Chapter, EpubMetadata, EpubSplitSettings } from '../../types';
import { CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS, PAGE_TYPE_LABELS } from '../../types';
import { ExportIcon, BookIcon, PdfIcon, NoPageIcon, ScissorsIcon } from '../../icons';

const TACHIKIRI_LABELS: Record<string, string> = {
  none: 'なし',
  crop_only: '切り抜き',
  crop_and_stroke: '切り抜き＋線',
  stroke_only: '線のみ',
  fill_white: '塗り',
  fill_and_stroke: '塗り＋線',
};

export type OutputTarget = 'image' | 'epub' | 'pdf';

interface OutputTabProps {
  chapters: Chapter[];
  projectName: string;
  // 画像出力（JPEG / TIFF / コピー&リネーム）。断ち切りは呼び出し側で bleedStore から注入する。
  onExportImages: (options: ExportOptions) => void | Promise<void>;
  // EPUB 生成（CMYK ガードは呼び出し側で適用）。outputJpeg=true で JPEG も同時書き出し。workFolderName で作品フォルダ名を上書き。
  onGenerateEpub: (metadata: EpubMetadata, outputPath: string, splitSettings?: EpubSplitSettings, outputJpeg?: boolean, workFolderName?: string) => void | Promise<void>;
  // PDF 生成（断ち切りは bleedStore から注入）
  onGeneratePdf: () => void | Promise<void>;
  // EPUB プレビュー操作
  zoom: number;
  onZoomChange: (zoom: number) => void;
  isViewerMode: boolean;
  onExitViewerMode: () => void;
  isPageBarVisible: boolean;
  bindingDirection: 'rtl' | 'ltr';
  onReplaceFile: (originalPageId: string) => void;
  onBindingChange: (d: 'rtl' | 'ltr') => void;
  onEnterViewerMode: () => void;
  onTogglePageBar: () => void;
  topBar?: ReactNode;
}

export function OutputTab({
  chapters,
  projectName,
  onExportImages,
  onGenerateEpub,
  onGeneratePdf,
  zoom,
  onZoomChange,
  isViewerMode,
  onExitViewerMode,
  isPageBarVisible,
  bindingDirection,
  onReplaceFile,
  onBindingChange,
  onEnterViewerMode,
  onTogglePageBar,
  topBar,
}: OutputTabProps) {
  const [target, setTarget] = useState<OutputTarget>('image');
  // 行き先切替時のスライド方向（チップが右へ移動したら右から、左なら左からフェードイン）
  const [stageSlideFrom, setStageSlideFrom] = useState('0px');
  const [wizardOpen, setWizardOpen] = useState(false);
  const pdfPreviewRef = useRef<HTMLDivElement | null>(null);
  const pdfNavTrackRef = useRef<HTMLDivElement>(null);
  const pdfScrollProgressRef = useRef(1);
  const hasPdfScrollProgressRef = useRef(false);
  const suppressPdfScrollProgressRef = useRef(false);
  const [pdfScrollProgress, setPdfScrollProgress] = useState(1);
  const [isPdfPreviewPositioned, setIsPdfPreviewPositioned] = useState(true);
  const [isPdfNavDragging, setIsPdfNavDragging] = useState(false);
  const loadEpubFromDaidori = useStore((s) => s.loadEpubFromDaidori);
  const bleed = useBleedStore();

  const totalPages = chapters.reduce((sum, c) => sum + c.pages.length, 0);
  const pdfPreviewChapters = (() => {
    let pageNo = 0;
    return chapters
      .filter((chapter) => chapter.pages.length > 0)
      .map((chapter) => ({
        chapter,
        pages: chapter.pages.map((page) => {
          pageNo += 1;
          return { page, pageNo };
        }),
      }));
  })();

  // 断ち切りタブで設定済みの内容を要約（出力前の確認用）
  const bleedSummary = (() => {
    const coverSet = bleed.coverRegion && bleed.coverRegion.tachikiriType !== 'none';
    if (bleed.mode === 'per-chapter') {
      const n = Object.values(bleed.perChapterRegions).filter((r) => r.tachikiriType !== 'none').length;
      const parts: string[] = [];
      if (coverSet) parts.push(`表紙=${TACHIKIRI_LABELS[bleed.coverRegion!.tachikiriType]}`);
      parts.push(n > 0 ? `本文 ${n}章を個別設定` : '本文 未設定');
      return { configured: coverSet || n > 0, scope: '本文ごと', text: parts.join(' / ') };
    }
    const bodySet = bleed.bodyRegion && bleed.bodyRegion.tachikiriType !== 'none';
    const parts: string[] = [];
    parts.push(`表紙=${coverSet ? TACHIKIRI_LABELS[bleed.coverRegion!.tachikiriType] : 'なし'}`);
    parts.push(`本文=${bodySet ? TACHIKIRI_LABELS[bleed.bodyRegion!.tachikiriType] : 'なし'}`);
    return { configured: !!(coverSet || bodySet), scope: '一括', text: parts.join(' / ') };
  })();

  // EPUB 行き先選択中は台割の変更に追従して再同期
  useEffect(() => {
    if (target === 'epub') {
      loadEpubFromDaidori();
    }
  }, [target, chapters, loadEpubFromDaidori]);

  const selectTarget = (t: OutputTarget) => {
    if (t !== target) {
      setStageSlideFrom(computeSlideDirection(t, target, ['image', 'epub', 'pdf']));
    }
    if (t === 'pdf') {
      suppressPdfScrollProgressRef.current = true;
      hasPdfScrollProgressRef.current = false;
      pdfScrollProgressRef.current = 1;
      setPdfScrollProgress(1);
      setIsPdfPreviewPositioned(false);
    }
    setTarget(t);
  };

  const getPdfScrollDistance = useCallback((el: HTMLDivElement) => {
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    return Math.max(0, Math.min(maxScroll, el.scrollLeft));
  }, []);

  const setPdfScrollDistance = useCallback((el: HTMLDivElement, distance: number, behavior: ScrollBehavior = 'auto') => {
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const nextDistance = Math.max(0, Math.min(maxScroll, distance));
    // 初期配置（auto）は即時に右端へ。ユーザー操作（smooth）のみアニメーションさせる。
    if (behavior === 'smooth') {
      el.scrollTo({ left: nextDistance, behavior: 'smooth' });
    } else {
      el.scrollLeft = nextDistance;
    }
    const progress = maxScroll > 0 ? nextDistance / maxScroll : 1;
    hasPdfScrollProgressRef.current = true;
    pdfScrollProgressRef.current = progress;
    setPdfScrollProgress(progress);
  }, []);

  const restorePdfScrollPosition = useCallback((el: HTMLDivElement) => {
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const restoredProgress = 1;
    setPdfScrollDistance(el, maxScroll * restoredProgress);
    const progress = maxScroll > 0 ? getPdfScrollDistance(el) / maxScroll : 1;
    pdfScrollProgressRef.current = progress;
    setPdfScrollProgress(progress);
    if (maxScroll > 0 || totalPages <= 1) {
      suppressPdfScrollProgressRef.current = false;
      setIsPdfPreviewPositioned(true);
    }
  }, [getPdfScrollDistance, setPdfScrollDistance, totalPages]);

  const setPdfPreviewElement = useCallback((node: HTMLDivElement | null) => {
    pdfPreviewRef.current = node;
    if (node) restorePdfScrollPosition(node);
  }, [restorePdfScrollPosition]);

  const updatePdfScrollProgress = useCallback(() => {
    if (target === 'pdf' && suppressPdfScrollProgressRef.current) return;
    const el = pdfPreviewRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const progress = maxScroll > 0 ? getPdfScrollDistance(el) / maxScroll : 1;
    hasPdfScrollProgressRef.current = true;
    pdfScrollProgressRef.current = progress;
    setPdfScrollProgress(progress);
  }, [getPdfScrollDistance, isPdfPreviewPositioned, target]);

  const getPdfPageStep = useCallback(() => {
    const el = pdfPreviewRef.current;
    if (!el) return 260;

    const thumbs = Array.from(el.querySelectorAll<HTMLElement>('.output-pdf-thumb'));
    if (thumbs.length >= 2) {
      const first = thumbs[0].getBoundingClientRect();
      const second = thumbs[1].getBoundingClientRect();
      const measuredStep = Math.abs(second.left - first.left);
      if (measuredStep > 0) return measuredStep;
    }

    return thumbs[0]?.getBoundingClientRect().width ?? 260;
  }, []);

  const scrollPdfPreviewByPages = useCallback((pageDelta: number) => {
    const el = pdfPreviewRef.current;
    if (!el) return;

    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const step = getPdfPageStep();
    const currentDistance = getPdfScrollDistance(el);
    const nextDistance = Math.max(0, Math.min(maxScroll, currentDistance - pageDelta * step));
    setPdfScrollDistance(el, nextDistance, 'smooth');
  }, [getPdfPageStep, getPdfScrollDistance, setPdfScrollDistance]);

  const handlePdfPreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (dominantDelta === 0) return;
    scrollPdfPreviewByPages(dominantDelta > 0 ? 1 : -1);
    event.preventDefault();
  };

  const handlePdfNavigationKey = useCallback((key: string, jumpToEdge: boolean, scrollTarget?: HTMLDivElement | null) => {
    const el = scrollTarget ?? pdfPreviewRef.current;
    if (!el) return false;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);

    // Ctrl/Cmd + 横方向キー: 先頭/末尾のページへジャンプ（RTL: ←=進む→末尾, →=戻る→先頭）。
    // 横方向キー以外の修飾は対象外（他のショートカットを潰さない）。
    if (jumpToEdge) {
      if (key === 'ArrowLeft') {
        setPdfScrollDistance(el, 0, 'smooth'); // 末尾（最後のページ）
        return true;
      } else if (key === 'ArrowRight') {
        setPdfScrollDistance(el, maxScroll, 'smooth'); // 先頭（最初のページ）
        return true;
      }
      return false;
    }

    if (key === 'ArrowLeft' || key === 'ArrowDown') {
      scrollPdfPreviewByPages(1);
      return true;
    } else if (key === 'ArrowRight' || key === 'ArrowUp') {
      scrollPdfPreviewByPages(-1);
      return true;
    } else if (key === 'PageDown') {
      scrollPdfPreviewByPages(4);
      return true;
    } else if (key === 'PageUp') {
      scrollPdfPreviewByPages(-4);
      return true;
    } else if (key === 'Home') {
      setPdfScrollDistance(el, Math.max(0, el.scrollWidth - el.clientWidth), 'smooth');
      return true;
    } else if (key === 'End') {
      setPdfScrollDistance(el, 0, 'smooth');
      return true;
    }

    return false;
  }, [scrollPdfPreviewByPages, setPdfScrollDistance]);

  const handlePdfPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (handlePdfNavigationKey(event.key, event.ctrlKey || event.metaKey, event.currentTarget)) {
      event.preventDefault();
    }
  };

  const scrollPdfPreviewToProgress = useCallback((progress: number) => {
    const el = pdfPreviewRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    setPdfScrollDistance(el, Math.max(0, Math.min(1, progress)) * maxScroll, isPdfNavDragging ? 'auto' : 'smooth');
  }, [isPdfNavDragging, setPdfScrollDistance]);

  const getPdfTrackProgress = useCallback((clientX: number) => {
    const track = pdfNavTrackRef.current;
    if (!track) return pdfScrollProgress;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return pdfScrollProgress;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [pdfScrollProgress]);

  const handlePdfNavMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsPdfNavDragging(true);
    scrollPdfPreviewToProgress(getPdfTrackProgress(event.clientX));
  };

  useEffect(() => {
    if (!isPdfNavDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      scrollPdfPreviewToProgress(getPdfTrackProgress(event.clientX));
    };
    const handleMouseUp = () => setIsPdfNavDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [getPdfTrackProgress, isPdfNavDragging, scrollPdfPreviewToProgress]);

  useLayoutEffect(() => {
    if (target !== 'pdf') return;

    const el = pdfPreviewRef.current;
    if (el) restorePdfScrollPosition(el);
    const frame = window.requestAnimationFrame(() => {
      const nextEl = pdfPreviewRef.current;
      if (nextEl) restorePdfScrollPosition(nextEl);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [restorePdfScrollPosition, target, totalPages]);

  useEffect(() => {
    if (target !== 'pdf') return;

    suppressPdfScrollProgressRef.current = true;
    setIsPdfPreviewPositioned(false);

    let attempts = 0;
    const interval = window.setInterval(() => {
      const el = pdfPreviewRef.current;
      attempts += 1;
      if (!el) {
        if (attempts > 12) {
          suppressPdfScrollProgressRef.current = false;
          setIsPdfPreviewPositioned(true);
          window.clearInterval(interval);
        }
        return;
      }

      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      if (maxScroll > 0 || totalPages <= 1 || attempts > 12) {
        const progress = 1;
        el.scrollLeft = maxScroll * progress;
        pdfScrollProgressRef.current = maxScroll > 0 ? el.scrollLeft / maxScroll : 1;
        suppressPdfScrollProgressRef.current = false;
        setPdfScrollProgress(pdfScrollProgressRef.current);
        setIsPdfPreviewPositioned(true);
        window.clearInterval(interval);
      }
    }, 16);

    return () => window.clearInterval(interval);
  }, [target, totalPages]);

  useEffect(() => {
    if (target !== 'pdf' || totalPages === 0) return;

    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.shiftKey) return;
      const jumpToEdge = event.ctrlKey || event.metaKey;
      // 修飾キーは Ctrl/Cmd + 横方向キー（先頭/末尾ジャンプ）だけ許可。それ以外の修飾付きは他ショートカット優先。
      if (jumpToEdge && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      const active = document.activeElement as HTMLElement | null;
      const isTyping =
        !!active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable);
      if (isTyping) return;

      if (handlePdfNavigationKey(event.key, jumpToEdge)) {
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [handlePdfNavigationKey, target, totalPages]);

  const targetCards: { value: OutputTarget; label: string; desc: string; icon: ReactNode }[] = [
    { value: 'image', label: 'JPG／TIFF', desc: 'JPEG / TIFF / コピー&リネーム', icon: <ExportIcon size={20} /> },
    { value: 'epub', label: 'EPUB', desc: '電子書籍（電書協／Hybrid 他）', icon: <BookIcon size={20} /> },
    { value: 'pdf', label: 'PDF', desc: 'まとめPDF（Tachimi連携）', icon: <PdfIcon size={20} /> },
  ];

  const targetBar = (
    <div className="output-target-bar">
      {targetCards.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`output-target-chip ${target === c.value ? 'active' : ''}`}
          onClick={() => selectTarget(c.value)}
        >
          {c.icon}
          <span>{c.label}</span>
        </button>
      ))}
      {/* ビューア操作（綴じ方向・ズーム・閲覧モード）。EPUB以外はグレーアウト＝操作不可。 */}
      <div className={`output-target-controls ${target === 'epub' && !isViewerMode ? '' : 'disabled'}`}>
        <ViewerControls
          bindingDirection={bindingDirection}
          onBindingChange={onBindingChange}
          zoom={zoom}
          onZoomChange={onZoomChange}
          onEnterViewerMode={onEnterViewerMode}
          canEnterViewerMode={target === 'epub' && totalPages > 0}
        />
      </div>
    </div>
  );

  // 出力内容の要約バナー（中央上部）。ページ数・色構成・断ち切り適用を一目で確認できる。
  const summaryBanner = (
    <div className="output-summary-banner">
      <div className="output-summary-banner-row">
        <span className="output-summary-chip">
          {chapters.length} チャプター / {totalPages} ページ
        </span>
        <span className={`output-summary-chip output-summary-bleed ${bleedSummary.configured ? 'on' : ''}`}>
          <ScissorsIcon size={13} />
          断ち切り（{bleedSummary.scope}）: {bleedSummary.text}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {/* 中央: 行き先選択（固定行）＋ 行き先別の本体 */}
      <div className="output-center">
        {targetBar}
        {/* 行き先（JPG/TIFF・EPUB・PDF）切替時に、チップの移動方向へスライドフェード（keyで再マウント） */}
        <div className="output-stage" key={target} style={{ '--stage-slide-from': stageSlideFrom } as CSSProperties}>
        {target === 'epub' ? (
          <>
            <EpubMakerView
              zoom={zoom}
              onZoomChange={onZoomChange}
              isViewerMode={isViewerMode}
              onExitViewerMode={onExitViewerMode}
              isPageBarVisible={isPageBarVisible}
              bindingDirection={bindingDirection}
              onReplaceFile={onReplaceFile}
              onTogglePageBar={onTogglePageBar}
              topBar={topBar}
            />
            <div className="output-epub-cta">
              <span className="output-epub-cta-text">
                プレビューで内容を確認したら、ガイドに沿って5ステップでEPUBを作成できます。
              </span>
              <button
                type="button"
                className="btn-primary output-epub-create"
                disabled={totalPages === 0}
                onClick={() => setWizardOpen(true)}
              >
                <BookIcon size={16} />
                EPUBを作成
              </button>
            </div>
          </>
        ) : (
          <>
          <div className={`preview-area output-settings-center ${target === 'pdf' ? 'output-pdf-mode' : ''}`}>
            <div className="output-topbar-row">
              <div className="output-topbar-summary">{topBar}</div>
            </div>
            {totalPages > 0 && summaryBanner}
            {totalPages === 0 ? (
              <div className="spread-viewer-empty">
                <NoPageIcon size={48} />
                <p>出力できるページがありません</p>
              </div>
            ) : target === 'image' ? (
              <div className="output-settings-body">
                <ExportModal
                  isOpen={true}
                  embedded
                  onClose={() => {}}
                  onExport={onExportImages}
                  chapters={chapters}
                />
              </div>
            ) : (
              // PDF: 全ページを単ページカードとして横一列に並べる（チャプター種別色を背景に反映）
              <div className={`output-pdf-preview-shell ${isPdfPreviewPositioned ? '' : 'positioning'}`}>
                <div
                  ref={setPdfPreviewElement}
                  className="output-pdf-preview"
                  tabIndex={0}
                  role="region"
                  aria-label="PDF生成前の単ページプレビュー"
                  onScroll={updatePdfScrollProgress}
                  onWheel={handlePdfPreviewWheel}
                  onKeyDown={handlePdfPreviewKeyDown}
                  onMouseDown={(event) => event.currentTarget.focus()}
                >
                  <div className="output-pdf-strip" role="list">
                    {[...pdfPreviewChapters].reverse().map(({ chapter, pages }) => {
                      const chapterStyle = {
                        '--chapter-color': CHAPTER_TYPE_COLORS[chapter.type],
                      } as CSSProperties;
                      const firstPageNo = pages[0]?.pageNo;

                      return (
                        <section
                          key={chapter.id}
                          className="output-pdf-chapter"
                          style={chapterStyle}
                          title={`${chapter.name} / ${pages.length}P`}
                        >
                          <div className="output-pdf-thumbs">
                            {[...pages].reverse().map(({ page, pageNo }) => {
                              const src = page.thumbnailStatus === 'ready' && page.thumbnailCachePath
                                ? convertFileSrc(page.thumbnailCachePath)
                                : null;
                              const placeholderLabel = page.pageType === 'file'
                                ? (page.thumbnailStatus === 'error' ? '読込エラー' : '読込中')
                                : (page.label || PAGE_TYPE_LABELS[page.pageType]);

                              return (
                                <article
                                  key={page.id}
                                  className={`output-pdf-thumb ${pageNo === firstPageNo ? 'chapter-start' : ''}`}
                                  data-page-type={page.pageType}
                                  role="listitem"
                                >
                                  {pageNo === firstPageNo && (
                                    <span className="output-pdf-thumb-badge">
                                      {CHAPTER_TYPE_LABELS[chapter.type]}
                                    </span>
                                  )}
                                  <div className="output-pdf-thumb-img">
                                    {src ? (
                                      <img src={src} alt={page.fileName || placeholderLabel} loading="lazy" />
                                    ) : (
                                      <span className="ph">{placeholderLabel}</span>
                                    )}
                                  </div>
                                  <span className="output-pdf-thumb-no">{pageNo}</span>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
                {totalPages > 1 && (
                  <div className="output-pdf-nav-bar">
                    <div
                      ref={pdfNavTrackRef}
                      className="spread-nav-track output-pdf-nav-track"
                      onMouseDown={handlePdfNavMouseDown}
                    >
                      <div
                        className={`spread-nav-handle output-pdf-nav-handle ${isPdfNavDragging ? 'dragging' : ''}`}
                        style={{ left: `calc(${pdfScrollProgress * 100}% - ${pdfScrollProgress * 30}px)` }}
                      >
                        <div className="spread-nav-handle-grip" />
                        <span className="spread-nav-handle-label">
                          {Math.max(1, Math.min(totalPages, Math.round((1 - pdfScrollProgress) * (totalPages - 1)) + 1))}p
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* 青いPDF生成バー（プレビューとは別ブロックで区切る） */}
          {target === 'pdf' && totalPages > 0 && (
            <div className="output-pdf-bar">
              <span className="output-pdf-bar-note">
                全{totalPages}ページを1つのPDFに結合します（JPEG化 → サイズ統一 → 断ち切り → PDF化）。
              </span>
              <button
                type="button"
                className="btn-primary output-pdf-generate-lg"
                onClick={() => void onGeneratePdf()}
              >
                <PdfIcon size={18} />
                PDFを生成
              </button>
            </div>
          )}
          </>
        )}
        </div>
      </div>

      {/* EPUB作成ウィザード（モーダル） */}
      <EpubWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onGenerate={onGenerateEpub}
        chapters={chapters}
        projectName={projectName}
      />
    </>
  );
}
