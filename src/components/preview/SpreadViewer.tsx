import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Chapter, Page, PAGE_TYPE_LABELS, PAGE_TYPE_COLORS } from '../../types';
import { queueThumbnail } from '../../hooks';
import { CloseIcon, NoPageIcon } from '../../icons';

// 閉じるボタン自動非表示の遅延時間（ミリ秒）
const CLOSE_BUTTON_HIDE_DELAY = 3000;
// ナビゲーションヒント表示時間（ミリ秒）
const NAV_HINT_SHOW_DURATION = 3000;

export function SpreadViewer({
  pages,
  selectedPageId,
  onPageSelect,
  isViewerMode = false,
  onExitViewerMode,
  isPageBarVisible = true,
  zoom = 100,
  onZoomChange,
  bindingDirection = 'rtl',
}: {
  pages: { page: Page; chapter: Chapter; globalIndex: number }[];
  selectedPageId?: string | null;
  onPageSelect?: (chapterId: string, pageId: string) => void;
  isViewerMode?: boolean;
  onExitViewerMode?: () => void;
  isPageBarVisible?: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  bindingDirection?: 'rtl' | 'ltr';
}) {
  const isRTL = bindingDirection === 'rtl';
  const trackRef = useRef<HTMLDivElement>(null);
  const spreadPairRef = useRef<HTMLDivElement>(null);
  const [currentSpreadIndex, setCurrentSpreadIndex] = useState(0);
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

  // 見開きのペアを計算
  const spreads = useMemo(() => {
    const result: { left?: typeof pages[0]; right?: typeof pages[0]; spreadIndex: number }[] = [];
    for (let i = 0; i < pages.length; i += 2) {
      if (isRTL) {
        // 右綴じ：先のページが右、次のページが左
        result.push({
          right: pages[i],
          left: pages[i + 1],
          spreadIndex: Math.floor(i / 2),
        });
      } else {
        // 左綴じ：先のページが左、次のページが右
        result.push({
          left: pages[i],
          right: pages[i + 1],
          spreadIndex: Math.floor(i / 2),
        });
      }
    }
    return result;
  }, [pages, isRTL]);

  const totalSpreads = spreads.length;

  // currentSpreadIndexが範囲外にならないように補正
  useEffect(() => {
    if (currentSpreadIndex >= totalSpreads && totalSpreads > 0) {
      setCurrentSpreadIndex(totalSpreads - 1);
    }
  }, [totalSpreads, currentSpreadIndex]);

  const currentSpread = spreads[currentSpreadIndex];

  // スプレッド変更時にパンオフセットをリセット
  useEffect(() => {
    setPanOffset({ x: 0, y: 0 });
  }, [currentSpreadIndex]);

  // Alt+ホイールでポインター位置に向かってズーム
  useEffect(() => {
    const container = spreadPairRef.current?.parentElement;
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

      // ポインター位置をコンテナ中心からの相対座標に変換
      const rect = container.getBoundingClientRect();
      const pointerX = e.clientX - rect.left - rect.width / 2;
      const pointerY = e.clientY - rect.top - rect.height / 2;

      // ズーム比率
      const ratio = newZoom / oldZoom;

      // パンオフセットを調整してポインター位置を固定
      setPanOffset(prev => ({
        x: pointerX - ratio * (pointerX - prev.x),
        y: pointerY - ratio * (pointerY - prev.y),
      }));

      onZoomChange?.(newZoom);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoom, onZoomChange]);

  // 現在のスプレッド周辺のサムネイルをキュー
  useEffect(() => {
    const indices = [currentSpreadIndex - 1, currentSpreadIndex, currentSpreadIndex + 1];
    indices.forEach(idx => {
      const spread = spreads[idx];
      if (!spread) return;
      [spread.right, spread.left].forEach(item => {
        if (item) {
          const { page } = item;
          const hasFile = page.filePath && page.modifiedTime;
          if (hasFile && page.thumbnailStatus === 'pending') {
            queueThumbnail(page.id, page.filePath!, page.modifiedTime!);
          }
        }
      });
    });
  }, [currentSpreadIndex, spreads]);

  // ナビゲーション
  const navigateToSpread = useCallback((targetIndex: number) => {
    const clamped = Math.max(0, Math.min(targetIndex, totalSpreads - 1));
    setCurrentSpreadIndex(clamped);
  }, [totalSpreads]);

  // ハンドル位置
  const scrollHandlePosition = useMemo(() => {
    if (totalSpreads <= 1) return 0;
    if (isRTL) {
      // 右綴じ：index 0 → 右端
      return 1 - currentSpreadIndex / (totalSpreads - 1);
    } else {
      // 左綴じ：index 0 → 左端
      return currentSpreadIndex / (totalSpreads - 1);
    }
  }, [currentSpreadIndex, totalSpreads, isRTL]);

  const displayHandlePosition = isDragging ? dragHandlePosition : scrollHandlePosition;

  const displaySpreadIndex = isDragging
    ? Math.round((isRTL ? 1 - dragHandlePosition : dragHandlePosition) * (totalSpreads - 1))
    : currentSpreadIndex;

  // キーボードナビゲーション
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      // 右綴じ：←で進む(+1)、→で戻る(-1) / 左綴じ：→で進む(+1)、←で戻る(-1)
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          navigateToSpread(isRTL ? totalSpreads - 1 : 0);
        } else {
          navigateToSpread(currentSpreadIndex + (isRTL ? 1 : -1));
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          navigateToSpread(isRTL ? 0 : totalSpreads - 1);
        } else {
          navigateToSpread(currentSpreadIndex + (isRTL ? -1 : 1));
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        navigateToSpread(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        navigateToSpread(totalSpreads - 1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentSpreadIndex, totalSpreads, navigateToSpread, isViewerMode, onExitViewerMode, isRTL]);

  // ジャンプダイアログ
  useEffect(() => {
    if (showJumpDialog) {
      setTimeout(() => jumpInputRef.current?.focus(), 0);
    }
  }, [showJumpDialog]);

  const handleJumpToPage = useCallback(() => {
    const pageNum = parseInt(jumpPageInput, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > pages.length) {
      setShowJumpDialog(false);
      return;
    }
    const spreadIndex = Math.floor((pageNum - 1) / 2);
    navigateToSpread(spreadIndex);
    setShowJumpDialog(false);
  }, [jumpPageInput, pages.length, navigateToSpread]);

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

  // トラッククリック/ドラッグ（右始まり）
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
    navigateToSpread(targetIndex);
  }, [totalSpreads, navigateToSpread, isRTL]);

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

  const renderPage = (item: typeof pages[0] | undefined, side: 'left' | 'right') => {
    if (!item) {
      return <div className={`spread-page spread-page-empty ${side}`} />;
    }

    const { page, globalIndex } = item;
    const isSpecialPage = page.pageType !== 'file';
    const hasFile = page.filePath && page.modifiedTime;
    const typeColor = PAGE_TYPE_COLORS[page.pageType] || '#888';
    const isSelected = !isViewerMode && selectedPageId === page.id;

    return (
      <div
        className={`spread-page ${side}${isSelected ? ' selected' : ''}`}
        onClick={() => !isViewerMode && onPageSelect?.(item.chapter.id, page.id)}
      >
        <div className="spread-page-content">
          {isSpecialPage && !hasFile ? (
            <div
              className="spread-special-page"
              style={{ backgroundColor: typeColor + '20', borderColor: typeColor }}
            >
              <span className="spread-special-label" style={{ color: typeColor }}>
                {page.label || PAGE_TYPE_LABELS[page.pageType]}
              </span>
            </div>
          ) : page.thumbnailStatus === 'ready' && page.thumbnailCachePath ? (
            <img
              src={convertFileSrc(page.thumbnailCachePath)}
              alt={page.fileName || ''}
              className="spread-thumbnail"
              draggable={false}
            />
          ) : page.thumbnailStatus === 'error' ? (
            <div className="spread-error">
              <span>読込エラー</span>
            </div>
          ) : (
            <div className="spread-loading">
              <div className="spread-spinner" />
            </div>
          )}
        </div>
        <div className="spread-page-info">
          <span className="spread-page-number">{globalIndex + 1}</span>
          {page.fileName && (
            <span className="spread-page-name">{page.fileName}</span>
          )}
        </div>
      </div>
    );
  };

  if (pages.length === 0) {
    return (
      <div className="spread-viewer-empty">
        <NoPageIcon size={48} />
        <p>ページがありません。チャプターを追加してください</p>
      </div>
    );
  }

  return (
    <div className="spread-viewer-container">
      {/* 現在のスプレッドのみ表示 */}
      <div className="spread-viewer-current">
        {currentSpread && (
          <div className="spread-item">
            {/* ページ情報バー */}
            <div className={`spread-info-bar ${isRTL ? 'rtl' : 'ltr'}`}>
              {isRTL ? (
                <>
                  {currentSpread.right && (
                    <span className="spread-page-label right">
                      P.{currentSpread.right.globalIndex + 1}
                      {currentSpread.right.page.fileName && ` - ${currentSpread.right.page.fileName}`}
                    </span>
                  )}
                  <div className="spread-number-label">
                    {currentSpread.right && currentSpread.left
                      ? `見開き ${currentSpread.right.globalIndex + 1}～${currentSpread.left.globalIndex + 1}P`
                      : currentSpread.right
                        ? `見開き ${currentSpread.right.globalIndex + 1}P`
                        : currentSpread.left
                          ? `見開き ${currentSpread.left.globalIndex + 1}P`
                          : `見開き ${currentSpreadIndex + 1} / ${totalSpreads}`}
                  </div>
                  {currentSpread.left && (
                    <span className="spread-page-label left">
                      P.{currentSpread.left.globalIndex + 1}
                      {currentSpread.left.page.fileName && ` - ${currentSpread.left.page.fileName}`}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {currentSpread.left && (
                    <span className="spread-page-label left">
                      P.{currentSpread.left.globalIndex + 1}
                      {currentSpread.left.page.fileName && ` - ${currentSpread.left.page.fileName}`}
                    </span>
                  )}
                  <div className="spread-number-label">
                    {currentSpread.left && currentSpread.right
                      ? `見開き ${currentSpread.left.globalIndex + 1}～${currentSpread.right.globalIndex + 1}P`
                      : currentSpread.left
                        ? `見開き ${currentSpread.left.globalIndex + 1}P`
                        : currentSpread.right
                          ? `見開き ${currentSpread.right.globalIndex + 1}P`
                          : `見開き ${currentSpreadIndex + 1} / ${totalSpreads}`}
                  </div>
                  {currentSpread.right && (
                    <span className="spread-page-label right">
                      P.{currentSpread.right.globalIndex + 1}
                      {currentSpread.right.page.fileName && ` - ${currentSpread.right.page.fileName}`}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* 見開きコンテナ */}
            <div className={`spread-pair ${isRTL ? 'rtl' : 'ltr'}`} ref={spreadPairRef} style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom / 100})`, transformOrigin: 'center center' }}>
              {isRTL ? (
                <>
                  {renderPage(currentSpread.right, 'right')}
                  <div className="spread-gutter" />
                  {renderPage(currentSpread.left, 'left')}
                </>
              ) : (
                <>
                  {renderPage(currentSpread.left, 'left')}
                  <div className="spread-gutter" />
                  {renderPage(currentSpread.right, 'right')}
                </>
              )}
            </div>
          </div>
        )}
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
                {(() => {
                  const displaySpread = spreads[displaySpreadIndex];
                  if (!displaySpread) return '';
                  const rightPage = displaySpread.right?.globalIndex;
                  const leftPage = displaySpread.left?.globalIndex;
                  if (rightPage !== undefined && leftPage !== undefined) {
                    return `${rightPage + 1}-${leftPage + 1}p`;
                  } else if (rightPage !== undefined) {
                    return `${rightPage + 1}p`;
                  } else if (leftPage !== undefined) {
                    return `${leftPage + 1}p`;
                  }
                  return '';
                })()}
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
