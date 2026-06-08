import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Chapter, Page, PAGE_TYPE_LABELS, PAGE_TYPE_COLORS } from '../../types';
import { queueThumbnail } from '../../hooks';
import { CloseIcon, NoPageIcon, AlertTriangleIcon, ReplaceIcon } from '../../icons';
import { useStore } from '../../store';
import { getValidationMessage } from '../../utils/validationMessage';
import { ViewerOverlay } from './ViewerOverlay';

// 閉じるボタン自動非表示の遅延時間（ミリ秒）
const CLOSE_BUTTON_HIDE_DELAY = 3000;
// ナビゲーションヒント表示時間（ミリ秒）
const NAV_HINT_SHOW_DURATION = 3000;
const WHEEL_NAVIGATION_INTERVAL = 180;
const WHEEL_NAVIGATION_THRESHOLD = 12;

export function SpreadViewer({
  pages,
  selectedPageId,
  selectedPageIds,
  onPageSelect,
  onReplaceFile,
  isViewerMode = false,
  onExitViewerMode,
  isPageBarVisible = true,
  zoom = 100,
  onZoomChange,
  bindingDirection = 'rtl',
  onBindingChange,
  onEnterViewerMode,
  onTogglePageBar,
}: {
  pages: { page: Page; chapter: Chapter; globalIndex: number }[];
  selectedPageId?: string | null;
  selectedPageIds?: string[];
  onPageSelect?: (chapterId: string, pageId: string, e: React.MouseEvent) => void;
  onReplaceFile?: (pageId: string) => void;
  isViewerMode?: boolean;
  onExitViewerMode?: () => void;
  isPageBarVisible?: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  bindingDirection?: 'rtl' | 'ltr';
  onBindingChange?: (d: 'rtl' | 'ltr') => void;
  onEnterViewerMode?: () => void;
  onTogglePageBar?: () => void;
}) {
  const isRTL = bindingDirection === 'rtl';
  const trackRef = useRef<HTMLDivElement>(null);
  const spreadPairRef = useRef<HTMLDivElement>(null);
  const validationContext = useStore((s) => s.validationContext);
  const [currentSpreadIndex, setCurrentSpreadIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandlePosition, setDragHandlePosition] = useState(0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const lastWheelNavigationAtRef = useRef(0);

  // ページジャンプダイアログ
  const [showJumpDialog, setShowJumpDialog] = useState(false);
  const [jumpPageInput, setJumpPageInput] = useState('');
  const jumpInputRef = useRef<HTMLInputElement>(null);

  // 閲覧モード時の閉じるボタン表示制御
  const [closeButtonVisible, setCloseButtonVisible] = useState(true);
  const closeButtonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 閲覧モード時のナビゲーションヒント表示制御
  const [navHintVisible, setNavHintVisible] = useState(false);

  // 見開きのペアを計算（表紙チャプターのみ単独ページで表示）
  const spreads = useMemo(() => {
    const result: { left?: typeof pages[0]; right?: typeof pages[0]; spreadIndex: number }[] = [];
    let i = 0;
    while (i < pages.length) {
      const current = pages[i];
      if (current.chapter.type === 'cover') {
        // 表紙は単独スプレッド（右綴じ: 視覚的に左側 / 左綴じ: 視覚的に右側）
        // spread-pair は RTL で row-reverse なので、視覚的左 = left スロット
        if (isRTL) {
          result.push({ left: current, spreadIndex: result.length });
        } else {
          result.push({ right: current, spreadIndex: result.length });
        }
        i += 1;
      } else {
        const next = pages[i + 1];
        if (isRTL) {
          result.push({ right: current, left: next, spreadIndex: result.length });
        } else {
          result.push({ left: current, right: next, spreadIndex: result.length });
        }
        i += 2;
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

  // 外部からの選択（整えるバーのファイル名ジャンプ等）に追従して該当スプレッドへ移動
  useEffect(() => {
    if (!selectedPageId) return;
    const idx = spreads.findIndex(
      (s) => s.left?.page.id === selectedPageId || s.right?.page.id === selectedPageId
    );
    if (idx >= 0) setCurrentSpreadIndex(idx);
  }, [selectedPageId, spreads]);

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
      if (!e.altKey) {
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (Math.abs(delta) < WHEEL_NAVIGATION_THRESHOLD || totalSpreads <= 1) return;

        e.preventDefault();
        e.stopPropagation();

        const now = Date.now();
        if (now - lastWheelNavigationAtRef.current < WHEEL_NAVIGATION_INTERVAL) return;
        lastWheelNavigationAtRef.current = now;

        const direction = delta > 0 ? 1 : -1;
        setCurrentSpreadIndex(prev => Math.max(0, Math.min(totalSpreads - 1, prev + direction)));
        return;
      }

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
  }, [zoom, onZoomChange, totalSpreads]);

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

  // ページラベル名取得（白紙ページは "白紙" を表示）
  const getPageLabelName = (item: typeof pages[0]): string | null => {
    const { page } = item;
    if (page.fileName) return page.fileName;
    if (page.pageType === 'blank') return '白紙';
    return null;
  };

  const renderPage = (item: typeof pages[0] | undefined, side: 'left' | 'right', sibling?: typeof pages[0]) => {
    if (!item) {
      // 相手ページが存在する場合は、相手の画像を不可視で埋め込んで同サイズの空枠を表示
      if (sibling && sibling.page.thumbnailStatus === 'ready' && sibling.page.thumbnailCachePath) {
        // 相手が表紙の場合は白紙表示せず、完全に透明な空枠（サイズだけ維持）
        const isCoverSibling = sibling.chapter.type === 'cover';
        const slotClass = isCoverSibling ? 'spread-page-hidden' : 'spread-page-blank';
        return (
          <div className={`spread-page ${slotClass} ${side}`}>
            <div className="spread-page-content">
              <img
                src={convertFileSrc(sibling.page.thumbnailCachePath)}
                alt=""
                className="spread-thumbnail spread-thumbnail-sizer"
                draggable={false}
                aria-hidden="true"
              />
            </div>
          </div>
        );
      }
      return <div className={`spread-page spread-page-empty ${side}`} />;
    }

    const { page, globalIndex } = item;
    const isSpecialPage = page.pageType !== 'file';
    const hasFile = page.filePath && page.modifiedTime;
    const typeColor = PAGE_TYPE_COLORS[page.pageType] || '#888';
    const isSelected = !isViewerMode && (
      selectedPageId === page.id ||
      (selectedPageIds?.includes(page.id) ?? false)
    );

    // ファイル無しの特殊ページ（白紙等）は兄弟画像でサイズを合わせる
    const isBlankSpecial = isSpecialPage && !hasFile;
    const sizerSrc =
      isBlankSpecial && sibling?.page.thumbnailStatus === 'ready' && sibling?.page.thumbnailCachePath
        ? convertFileSrc(sibling.page.thumbnailCachePath)
        : null;

    return (
      <div
        className={`spread-page ${side}${isSelected ? ' selected' : ''}`}
        onClick={(e) => !isViewerMode && onPageSelect?.(item.chapter.id, page.id, e)}
      >
        <div className="spread-page-content">
          {isBlankSpecial ? (
            <div className="spread-special-wrapper">
              {sizerSrc && (
                <img
                  src={sizerSrc}
                  alt=""
                  className="spread-thumbnail spread-thumbnail-sizer"
                  draggable={false}
                  aria-hidden="true"
                />
              )}
              <div
                className="spread-special-page"
                style={{
                  backgroundColor: page.pageType === 'blank' ? 'white' : typeColor + '20',
                  borderColor: typeColor,
                }}
              >
                <span className="spread-special-label" style={{ color: typeColor }}>
                  {page.label || PAGE_TYPE_LABELS[page.pageType]}
                </span>
              </div>
            </div>
          ) : page.thumbnailStatus === 'ready' && page.thumbnailCachePath ? (
            <>
              <img
                src={convertFileSrc(page.thumbnailCachePath)}
                alt={page.fileName || ''}
                className="spread-thumbnail"
                draggable={false}
              />
              {!isViewerMode && page.fileValidationStatus && page.fileValidationStatus !== 'ok' && (
                <div className="spread-alert-group">
                  <span
                    className="spread-file-alert"
                    title={getValidationMessage(page, validationContext, item.chapter.type)}
                  >
                    <AlertTriangleIcon size={18} />
                  </span>
                  {onReplaceFile && page.fileValidationStatus === 'modified' && (
                    <button
                      className="spread-file-replace-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReplaceFile(page.id);
                      }}
                      title="リンクを更新"
                    >
                      <ReplaceIcon size={16} />
                    </button>
                  )}
                </div>
              )}
            </>
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
    <div className="spread-viewer-container viewer-canvas">
      {/* ビューア操作オーバーレイ（ホバーで出現） */}
      {onBindingChange && onZoomChange && onEnterViewerMode && onTogglePageBar && (
        <ViewerOverlay
          bindingDirection={bindingDirection}
          onBindingChange={onBindingChange}
          zoom={zoom}
          onZoomChange={onZoomChange}
          onEnterViewerMode={onEnterViewerMode}
          canEnterViewerMode={pages.length > 0}
          isPageBarVisible={isPageBarVisible}
          onTogglePageBar={onTogglePageBar}
          isViewerMode={isViewerMode}
        />
      )}
      {/* 現在のスプレッドのみ表示 */}
      <div className="spread-viewer-current">
        {currentSpread && (
          <div className="spread-item">
            {/* ページ情報バー */}
            <div className={`spread-info-bar ${isRTL ? 'rtl' : 'ltr'}`}>
              {isRTL ? (
                <>
                  {/* 右綴じ: row-reverseにより画像の視覚左=left、視覚右=right なのでラベルもそれに合わせる */}
                  {currentSpread.left && (
                    <span className="spread-page-label left">
                      P.{currentSpread.left.globalIndex + 1}
                      {getPageLabelName(currentSpread.left) && ` - ${getPageLabelName(currentSpread.left)}`}
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
                  {currentSpread.right && (
                    <span className="spread-page-label right">
                      P.{currentSpread.right.globalIndex + 1}
                      {getPageLabelName(currentSpread.right) && ` - ${getPageLabelName(currentSpread.right)}`}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {currentSpread.left && (
                    <span className="spread-page-label left">
                      P.{currentSpread.left.globalIndex + 1}
                      {getPageLabelName(currentSpread.left) && ` - ${getPageLabelName(currentSpread.left)}`}
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
                      {getPageLabelName(currentSpread.right) && ` - ${getPageLabelName(currentSpread.right)}`}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* 見開きコンテナ */}
            <div className={`spread-pair ${isRTL ? 'rtl' : 'ltr'}`} ref={spreadPairRef} style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom / 100})`, transformOrigin: 'center center' }}>
              {isRTL ? (
                <>
                  {renderPage(currentSpread.right, 'right', currentSpread.left)}
                  <div className="spread-gutter" />
                  {renderPage(currentSpread.left, 'left', currentSpread.right)}
                </>
              ) : (
                <>
                  {renderPage(currentSpread.left, 'left', currentSpread.right)}
                  <div className="spread-gutter" />
                  {renderPage(currentSpread.right, 'right', currentSpread.left)}
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
