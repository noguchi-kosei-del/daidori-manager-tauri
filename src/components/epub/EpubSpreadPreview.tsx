import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { EpubPageInfo } from '../../types';
import { CloseIcon } from '../../icons';

const CLOSE_BUTTON_HIDE_DELAY = 3000;
const NAV_HINT_SHOW_DURATION = 3000;

interface EpubSpreadPreviewProps {
  pages: EpubPageInfo[];
  currentSpread: number;
  selectedPageId: string | null;
  onSpreadChange: (index: number) => void;
  onSelectPage: (pageId: string) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  isViewerMode?: boolean;
  onExitViewerMode?: () => void;
  isPageBarVisible?: boolean;
}

export function EpubSpreadPreview({
  pages,
  currentSpread,
  selectedPageId,
  onSpreadChange,
  onSelectPage,
  zoom = 100,
  onZoomChange,
  isViewerMode = false,
  onExitViewerMode,
  isPageBarVisible = true,
}: EpubSpreadPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
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

  // スプレッドを計算（2ページずつ）
  const spreads: EpubPageInfo[][] = [];
  for (let i = 0; i < pages.length; i += 2) {
    spreads.push(pages.slice(i, i + 2));
  }

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

  // ハンドル位置（右始まり）
  const scrollHandlePosition = useMemo(() => {
    if (totalSpreads <= 1) return 0;
    return 1 - currentSpread / (totalSpreads - 1);
  }, [currentSpread, totalSpreads]);

  const displayHandlePosition = isDragging ? dragHandlePosition : scrollHandlePosition;

  const displaySpreadIndex = isDragging
    ? Math.round((1 - dragHandlePosition) * (totalSpreads - 1))
    : currentSpread;

  // キーボードナビゲーション（左で進む、右で戻る）
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

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        onSpreadChange(totalSpreads - 1);
      } else if (currentSpread < totalSpreads - 1) {
        onSpreadChange(currentSpread + 1);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        onSpreadChange(0);
      } else if (currentSpread > 0) {
        onSpreadChange(currentSpread - 1);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSpreadChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSpreadChange(totalSpreads - 1);
    }
  }, [currentSpread, totalSpreads, onSpreadChange, isViewerMode, onExitViewerMode]);

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

    // 右始まりなので反転
    const targetIndex = Math.round((1 - ratio) * (totalSpreads - 1));
    onSpreadChange(targetIndex);
  }, [totalSpreads, onSpreadChange]);

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
            <p>ページがありません</p>
          </div>
        ) : (
          <div className="epub-spread-pages">
            {/* 右ページ（日本式：右から左へ読む） */}
            {currentPages[0] && (
              <div
                className={`epub-spread-page right-page ${selectedPageId === currentPages[0].id ? 'selected' : ''}`}
                onClick={() => !isViewerMode && onSelectPage(currentPages[0].id)}
              >
                <img
                  src={getImageSrc(currentPages[0])}
                  alt={`Page ${getPageIndex(currentPages[0])}`}
                />
                {!isViewerMode && (
                  <div className="epub-page-label">
                    {currentPages[0].isCover && <span className="page-badge cover">表紙</span>}
                    {currentPages[0].isColophon && <span className="page-badge colophon">奥付</span>}
                    <span className="page-number">{getPageIndex(currentPages[0])}p</span>
                  </div>
                )}
              </div>
            )}

            {/* ノド */}
            <div className="epub-spread-gutter" />

            {/* 左ページ */}
            {currentPages[1] && (
              <div
                className={`epub-spread-page left-page ${selectedPageId === currentPages[1].id ? 'selected' : ''}`}
                onClick={() => !isViewerMode && onSelectPage(currentPages[1].id)}
              >
                <img
                  src={getImageSrc(currentPages[1])}
                  alt={`Page ${getPageIndex(currentPages[1])}`}
                />
                {!isViewerMode && (
                  <div className="epub-page-label">
                    {currentPages[1].isCover && <span className="page-badge cover">表紙</span>}
                    {currentPages[1].isColophon && <span className="page-badge colophon">奥付</span>}
                    <span className="page-number">{getPageIndex(currentPages[1])}p</span>
                  </div>
                )}
              </div>
            )}
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
