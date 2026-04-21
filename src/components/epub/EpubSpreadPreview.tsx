import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { EpubPageInfo } from '../../types';
import { CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS } from '../../types';
import { CloseIcon, AlertTriangleIcon, ReplaceIcon } from '../../icons';
import { useStore } from '../../store';
import { getValidationMessage } from '../../utils/validationMessage';

const CLOSE_BUTTON_HIDE_DELAY = 3000;
const NAV_HINT_SHOW_DURATION = 3000;

interface EpubSpreadPreviewProps {
  pages: EpubPageInfo[];
  currentSpread: number;
  selectedPageId: string | null;
  onSpreadChange: (index: number) => void;
  onSelectPage: (pageId: string) => void;
  onReplaceFile?: (originalPageId: string) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  isViewerMode?: boolean;
  onExitViewerMode?: () => void;
  isPageBarVisible?: boolean;
  bindingDirection?: 'rtl' | 'ltr';
}

export function EpubSpreadPreview({
  pages,
  currentSpread,
  selectedPageId,
  onSpreadChange,
  onSelectPage,
  onReplaceFile,
  zoom = 100,
  onZoomChange,
  isViewerMode = false,
  onExitViewerMode,
  isPageBarVisible = true,
  bindingDirection = 'rtl',
}: EpubSpreadPreviewProps) {
  const isRTL = bindingDirection === 'rtl';
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const validationContext = useStore((s) => s.validationContext);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandlePosition, setDragHandlePosition] = useState(0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // ページジャンプダイアログ
  const [showJumpDialog, setShowJumpDialog] = useState(false);
  const [jumpPageInput, setJumpPageInput] = useState('');
  const jumpInputRef = useRef<HTMLInputElement>(null);

  // 閲覧モード時の閉じるボタン表示制御
  const [closeButtonVisible, setCloseButtonVisible] = useState(true);
  const closeButtonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 閲覧モード時のナビゲーションヒント表示制御
  const [navHintVisible, setNavHintVisible] = useState(false);

  // スプレッドを計算（表紙ページのみ単独スプレッド）
  const spreads: EpubPageInfo[][] = useMemo(() => {
    const result: EpubPageInfo[][] = [];
    let i = 0;
    while (i < pages.length) {
      const current = pages[i];
      if (current.isCover) {
        result.push([current]);
        i += 1;
      } else {
        const next = pages[i + 1];
        if (next) {
          result.push([current, next]);
          i += 2;
        } else {
          result.push([current]);
          i += 1;
        }
      }
    }
    return result;
  }, [pages]);

  const currentPages = spreads[currentSpread] || [];
  const totalSpreads = spreads.length;

  // スプレッド変更時にパンオフセットをリセット
  useEffect(() => {
    setPanOffset({ x: 0, y: 0 });
  }, [currentSpread]);

  // Alt+ホイールでポインター位置に向かってズーム
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      e.stopPropagation();

      const direction = e.deltaY < 0 ? 1 : -1;
      const step = 5;
      const oldZoom = zoom;
      const newZoom = Math.min(200, Math.max(50, oldZoom + direction * step));
      if (oldZoom === newZoom) return;

      const rect = container.getBoundingClientRect();
      const pointerX = e.clientX - rect.left - rect.width / 2;
      const pointerY = e.clientY - rect.top - rect.height / 2;

      const ratio = newZoom / oldZoom;

      setPanOffset(prev => ({
        x: pointerX - ratio * (pointerX - prev.x),
        y: pointerY - ratio * (pointerY - prev.y),
      }));

      onZoomChange?.(newZoom);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoom, onZoomChange]);

  // ハンドル位置
  const scrollHandlePosition = useMemo(() => {
    if (totalSpreads <= 1) return 0;
    if (isRTL) {
      return 1 - currentSpread / (totalSpreads - 1);
    } else {
      return currentSpread / (totalSpreads - 1);
    }
  }, [currentSpread, totalSpreads, isRTL]);

  const displayHandlePosition = isDragging ? dragHandlePosition : scrollHandlePosition;

  const displaySpreadIndex = isDragging
    ? Math.round((isRTL ? 1 - dragHandlePosition : dragHandlePosition) * (totalSpreads - 1))
    : currentSpread;

  // キーボードナビゲーション
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && isViewerMode) {
      e.preventDefault();
      onExitViewerMode?.();
      return;
    }

    if (e.key === 'j' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setJumpPageInput('');
      setShowJumpDialog(true);
      return;
    }

    if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setPanOffset({ x: 0, y: 0 });
      onZoomChange?.(100);
      return;
    }

    // 右綴じ：←で進む、→で戻る / 左綴じ：→で進む、←で戻る
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        onSpreadChange(isRTL ? totalSpreads - 1 : 0);
      } else if (isRTL && currentSpread < totalSpreads - 1) {
        onSpreadChange(currentSpread + 1);
      } else if (!isRTL && currentSpread > 0) {
        onSpreadChange(currentSpread - 1);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        onSpreadChange(isRTL ? 0 : totalSpreads - 1);
      } else if (isRTL && currentSpread > 0) {
        onSpreadChange(currentSpread - 1);
      } else if (!isRTL && currentSpread < totalSpreads - 1) {
        onSpreadChange(currentSpread + 1);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSpreadChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSpreadChange(totalSpreads - 1);
    }
  }, [currentSpread, totalSpreads, onSpreadChange, isViewerMode, onExitViewerMode, isRTL]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // 閲覧モード時の閉じるボタン自動非表示
  useEffect(() => {
    if (!isViewerMode) {
      setCloseButtonVisible(true);
      return;
    }

    const hideCloseButton = () => {
      closeButtonTimeoutRef.current = setTimeout(() => {
        setCloseButtonVisible(false);
      }, CLOSE_BUTTON_HIDE_DELAY);
    };

    const showCloseButton = () => {
      if (closeButtonTimeoutRef.current) {
        clearTimeout(closeButtonTimeoutRef.current);
      }
      setCloseButtonVisible(true);
      hideCloseButton();
    };

    hideCloseButton();
    document.addEventListener('mousemove', showCloseButton);

    return () => {
      if (closeButtonTimeoutRef.current) {
        clearTimeout(closeButtonTimeoutRef.current);
      }
      document.removeEventListener('mousemove', showCloseButton);
    };
  }, [isViewerMode]);

  // 閲覧モード開始時にナビゲーションヒントを表示
  useEffect(() => {
    if (!isViewerMode) {
      setNavHintVisible(false);
      return;
    }
    setNavHintVisible(true);
    const timer = setTimeout(() => {
      setNavHintVisible(false);
    }, NAV_HINT_SHOW_DURATION);
    return () => clearTimeout(timer);
  }, [isViewerMode]);

  // ジャンプダイアログが開いたらフォーカス
  useEffect(() => {
    if (showJumpDialog) {
      setTimeout(() => jumpInputRef.current?.focus(), 0);
    }
  }, [showJumpDialog]);

  // ページジャンプ実行
  const handleJumpToPage = useCallback(() => {
    const pageNum = parseInt(jumpPageInput, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > pages.length) {
      setShowJumpDialog(false);
      return;
    }
    const spreadIndex = Math.floor((pageNum - 1) / 2);
    const clamped = Math.min(spreadIndex, totalSpreads - 1);
    onSpreadChange(clamped);
    setShowJumpDialog(false);
  }, [jumpPageInput, pages.length, totalSpreads, onSpreadChange]);

  // トラッククリック/ドラッグでページ移動
  const handleTrackInteraction = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || totalSpreads <= 1) return;

    const rect = track.getBoundingClientRect();
    const handleWidth = 30;
    const trackWidth = rect.width - handleWidth;
    const relativeX = Math.max(0, Math.min(clientX - rect.left - handleWidth / 2, trackWidth));
    const ratio = relativeX / trackWidth;

    setDragHandlePosition(ratio);

    const targetIndex = Math.round((isRTL ? 1 - ratio : ratio) * (totalSpreads - 1));
    onSpreadChange(targetIndex);
  }, [totalSpreads, onSpreadChange, isRTL]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    handleTrackInteraction(e.clientX);
  }, [handleTrackInteraction]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleTrackInteraction(e.clientX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleTrackInteraction]);

  // 画像ソースを取得
  const getImageSrc = (page: EpubPageInfo): string => {
    if (page.thumbnailPath) {
      return page.thumbnailPath.startsWith('data:')
        ? page.thumbnailPath
        : convertFileSrc(page.thumbnailPath);
    }
    return convertFileSrc(page.sourcePath);
  };

  // 単一ページ（または空スロット）をレンダリング
  const renderEpubPage = (
    page: EpubPageInfo | undefined,
    side: 'left' | 'right',
    sibling?: EpubPageInfo
  ) => {
    // 空スロット：兄弟画像で同サイズを保持
    if (!page) {
      if (!sibling || sibling.isBlank) return null;
      const isCoverSibling = sibling.isCover;
      const slotClass = isCoverSibling ? 'epub-spread-page-hidden' : 'epub-spread-page-blank';
      return (
        <div className={`epub-spread-page ${side}-page ${slotClass}`}>
          <img
            src={getImageSrc(sibling)}
            alt=""
            className="epub-spread-sizer"
            draggable={false}
            aria-hidden="true"
          />
        </div>
      );
    }

    // 白紙ページ
    if (page.isBlank) {
      const sizerSrc = sibling && !sibling.isBlank ? getImageSrc(sibling) : null;
      return (
        <div
          className={`epub-spread-page ${side}-page epub-spread-page-blankcontent ${selectedPageId === page.id ? 'selected' : ''}`}
          onClick={() => !isViewerMode && onSelectPage(page.id)}
        >
          {sizerSrc && (
            <img
              src={sizerSrc}
              alt=""
              className="epub-spread-sizer"
              draggable={false}
              aria-hidden="true"
            />
          )}
          <div className="epub-spread-blank-inner">
            <span className="epub-spread-blank-label">白紙</span>
          </div>
          {!isViewerMode && (
            <div className="epub-page-label">
              {page.originalChapterType && (
                <span
                  className="page-badge"
                  style={{ backgroundColor: CHAPTER_TYPE_COLORS[page.originalChapterType], color: 'white' }}
                >
                  {CHAPTER_TYPE_LABELS[page.originalChapterType]}
                </span>
              )}
              <span className="page-number">{getPageIndex(page)}p</span>
            </div>
          )}
        </div>
      );
    }

    // 通常の画像ページ
    return (
      <div
        className={`epub-spread-page ${side}-page ${selectedPageId === page.id ? 'selected' : ''}`}
        onClick={() => !isViewerMode && onSelectPage(page.id)}
      >
        <img src={getImageSrc(page)} alt={`Page ${getPageIndex(page)}`} />
        {!isViewerMode && page.fileValidationStatus && page.fileValidationStatus !== 'ok' && (
          <div className="spread-alert-group">
            <span
              className="spread-file-alert"
              title={getValidationMessage(page, validationContext, page.originalChapterType)}
            >
              <AlertTriangleIcon size={18} />
            </span>
            {onReplaceFile && page.originalPageId && page.fileValidationStatus === 'modified' && (
              <button
                className="spread-file-replace-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onReplaceFile(page.originalPageId!);
                }}
                title="リンクを更新"
              >
                <ReplaceIcon size={16} />
              </button>
            )}
          </div>
        )}
        {!isViewerMode && (
          <div className="epub-page-label">
            {page.originalChapterType && (
              <span
                className="page-badge"
                style={{ backgroundColor: CHAPTER_TYPE_COLORS[page.originalChapterType], color: 'white' }}
              >
                {CHAPTER_TYPE_LABELS[page.originalChapterType]}
              </span>
            )}
            <span className="page-number">{getPageIndex(page)}p</span>
          </div>
        )}
      </div>
    );
  };

  // ページインデックスを取得
  const getPageIndex = (page: EpubPageInfo): number => {
    return pages.findIndex(p => p.id === page.id) + 1;
  };

  // ページ番号ラベルを生成
  const getHandleLabel = (): string => {
    const spread = spreads[displaySpreadIndex];
    if (!spread) return '';
    const rightIdx = spread[0] ? getPageIndex(spread[0]) : undefined;
    const leftIdx = spread[1] ? getPageIndex(spread[1]) : undefined;
    if (rightIdx !== undefined && leftIdx !== undefined) {
      return `${rightIdx}-${leftIdx}p`;
    } else if (rightIdx !== undefined) {
      return `${rightIdx}p`;
    }
    return '';
  };

  return (
    <div
      className="epub-spread-preview"
      ref={containerRef}
      tabIndex={0}
    >
      {/* 見開き表示エリア */}
      <div className="epub-spread-container" style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom / 100})`, transformOrigin: 'center center' }}>
        {currentPages.length === 0 ? (
          <div className="epub-spread-empty">
            <p>ページがありません。チャプターを追加してください</p>
          </div>
        ) : (() => {
          // 表紙単独スプレッドの場合、スロットを入れ替えて視覚的左側（RTL）に配置
          const isCoverAlone = currentPages.length === 1 && currentPages[0].isCover;
          let slot0: EpubPageInfo | undefined = currentPages[0];
          let slot1: EpubPageInfo | undefined = currentPages[1];
          if (isCoverAlone) {
            if (isRTL) {
              slot0 = undefined;
              slot1 = currentPages[0];
            } else {
              slot1 = undefined;
            }
          }
          const hasBothReal = currentPages.length === 2;
          return (
            <div className={`epub-spread-pages ${isRTL ? 'rtl' : 'ltr'}`}>
              {isRTL ? (
                <>
                  {/* 右綴じ：DOM [slot0(視覚右), gutter, slot1(視覚左)] row-reverseで反転 */}
                  {renderEpubPage(slot0, 'right', slot1)}
                  {hasBothReal && <div className="epub-spread-gutter" />}
                  {renderEpubPage(slot1, 'left', slot0)}
                </>
              ) : (
                <>
                  {/* 左綴じ：DOM [slot0(視覚左), gutter, slot1(視覚右)] */}
                  {renderEpubPage(slot0, 'left', slot1)}
                  {hasBothReal && <div className="epub-spread-gutter" />}
                  {renderEpubPage(slot1, 'right', slot0)}
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* フローティングスクロールバー */}
      {totalSpreads > 1 && isPageBarVisible && (
        <div className="spread-nav-bar">
          <div
            className="spread-nav-track"
            ref={trackRef}
            onMouseDown={handleMouseDown}
          >
            <div
              className={`spread-nav-handle ${isDragging ? 'dragging' : ''}`}
              style={{ left: `calc(${displayHandlePosition * 100}% - ${displayHandlePosition * 30}px)` }}
            >
              <div className="spread-nav-handle-grip" />
              <span className="spread-nav-handle-label">
                {getHandleLabel()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 閲覧モード時の閉じるボタン */}
      {isViewerMode && (
        <button
          className={`viewer-mode-close-btn ${closeButtonVisible ? 'visible' : 'auto-hidden'}`}
          onClick={onExitViewerMode}
          title="閲覧モードを終了 (ESC)"
        >
          <CloseIcon size={24} />
        </button>
      )}

      {/* 閲覧モード時のナビゲーションヒント */}
      {isViewerMode && (
        <div className={`viewer-nav-hint ${navHintVisible ? 'show' : ''}`}>
          escまたは×ボタンで閲覧モード解除
        </div>
      )}

      {/* ページジャンプダイアログ */}
      {showJumpDialog && (
        <div className="jump-dialog-overlay" onClick={() => setShowJumpDialog(false)}>
          <div className="jump-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="jump-dialog-title">ページジャンプ</div>
            <div className="jump-dialog-body">
              <input
                ref={jumpInputRef}
                type="number"
                className="jump-dialog-input"
                min={1}
                max={pages.length}
                value={jumpPageInput}
                onChange={(e) => setJumpPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleJumpToPage();
                  } else if (e.key === 'Escape') {
                    setShowJumpDialog(false);
                  }
                }}
                placeholder={`1〜${pages.length}`}
              />
              <span className="jump-dialog-suffix">ページ</span>
            </div>
            <div className="jump-dialog-footer">
              <button className="btn-secondary btn-small" onClick={() => setShowJumpDialog(false)}>
                キャンセル
              </button>
              <button className="btn-primary btn-small" onClick={handleJumpToPage}>
                ジャンプ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
