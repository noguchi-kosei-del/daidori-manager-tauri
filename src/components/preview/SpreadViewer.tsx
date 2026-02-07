import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Chapter, Page, PAGE_TYPE_LABELS, PAGE_TYPE_COLORS } from '../../types';
import { queueThumbnail } from '../../hooks';

// 見開きプレビューコンポーネント（縦スクロール式）
export function SpreadViewer({
  pages,
  onPageSelect,
}: {
  pages: { page: Page; chapter: Chapter; globalIndex: number }[];
  onPageSelect?: (chapterId: string, pageId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [visibleSpreads, setVisibleSpreads] = useState<Set<number>>(new Set());
  const [currentSpreadIndex, setCurrentSpreadIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  // ドラッグ中のハンドル位置（0〜1の範囲）
  const [dragHandlePosition, setDragHandlePosition] = useState(0);

  // 見開きのペアを計算（日本の漫画スタイル：右から左へ読む）
  const spreads = useMemo(() => {
    const result: { left?: typeof pages[0]; right?: typeof pages[0]; spreadIndex: number }[] = [];
    for (let i = 0; i < pages.length; i += 2) {
      result.push({
        right: pages[i],      // 右ページ（1, 3, 5...）
        left: pages[i + 1],   // 左ページ（2, 4, 6...）
        spreadIndex: Math.floor(i / 2),
      });
    }
    return result;
  }, [pages]);

  const totalSpreads = spreads.length;

  // Intersection Observer で遅延読み込み
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const spreadIndex = Number(entry.target.getAttribute('data-spread-index'));
          if (entry.isIntersecting) {
            setVisibleSpreads(prev => new Set([...prev, spreadIndex]));
          }
        });
      },
      {
        root: containerRef.current,
        rootMargin: '200px 0px',
        threshold: 0.1,
      }
    );

    const spreadElements = containerRef.current?.querySelectorAll('.spread-item');
    spreadElements?.forEach(el => observer.observe(el));

    return () => observer.disconnect();
  }, [spreads.length]);

  // 可視状態になった見開きのサムネイルをキュー
  useEffect(() => {
    visibleSpreads.forEach(spreadIndex => {
      const spread = spreads[spreadIndex];
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
  }, [visibleSpreads, spreads]);

  // スクロール位置から現在の見開きインデックスを計算（ドラッグ中は無視）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isDragging) return;

      const spreadElements = container.querySelectorAll('.spread-item');
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;

      let closestIndex = 0;
      let closestDistance = Infinity;

      spreadElements.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        const elementCenter = rect.top + rect.height / 2;
        const distance = Math.abs(elementCenter - containerCenter);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      setCurrentSpreadIndex(closestIndex);
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [spreads.length, isDragging]);

  // スクロール位置に基づくハンドル位置（0〜1の範囲）
  const scrollHandlePosition = useMemo(() => {
    if (totalSpreads <= 1) return 0;
    return currentSpreadIndex / (totalSpreads - 1);
  }, [currentSpreadIndex, totalSpreads]);

  // 実際に表示するハンドル位置（ドラッグ中はドラッグ位置、それ以外はスクロール位置）
  const displayHandlePosition = isDragging ? dragHandlePosition : scrollHandlePosition;

  // 表示するインデックス（ラベル用）
  const displaySpreadIndex = isDragging
    ? Math.round(dragHandlePosition * (totalSpreads - 1))
    : currentSpreadIndex;

  // ナビゲーション関数
  const scrollToSpread = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;

    const spreadElements = container.querySelectorAll('.spread-item');
    const targetElement = spreadElements[index] as HTMLElement;
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }, []);

  // トラッククリック/ドラッグでスクロール
  const handleTrackInteraction = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track || totalSpreads <= 1) return;

    const rect = track.getBoundingClientRect();
    const handleHeight = 40;
    const trackHeight = rect.height - handleHeight;
    const relativeY = Math.max(0, Math.min(clientY - rect.top - handleHeight / 2, trackHeight));
    const ratio = relativeY / trackHeight;

    // ハンドル位置を直接更新
    setDragHandlePosition(ratio);

    // スクロール
    const targetIndex = Math.round(ratio * (totalSpreads - 1));
    scrollToSpread(targetIndex);
  }, [totalSpreads, scrollToSpread]);

  // マウスダウン開始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    handleTrackInteraction(e.clientY);
  }, [handleTrackInteraction]);

  // マウス移動とマウスアップのグローバルイベント
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleTrackInteraction(e.clientY);
    };

    const handleMouseUp = () => {
      // ドラッグ終了時に、ドラッグ位置から計算したインデックスを設定
      const targetIndex = Math.round(dragHandlePosition * (totalSpreads - 1));
      setCurrentSpreadIndex(targetIndex);
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleTrackInteraction, dragHandlePosition, totalSpreads]);

  const renderPage = (item: typeof pages[0] | undefined, side: 'left' | 'right') => {
    if (!item) {
      return <div className={`spread-page spread-page-empty ${side}`} />;
    }

    const { page, globalIndex } = item;
    const isSpecialPage = page.pageType !== 'file';
    const hasFile = page.filePath && page.modifiedTime;
    const typeColor = PAGE_TYPE_COLORS[page.pageType] || '#888';

    return (
      <div
        className={`spread-page ${side}`}
        onClick={() => onPageSelect?.(item.chapter.id, page.id)}
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
        <p>ページがありません</p>
      </div>
    );
  }

  return (
    <div className="spread-viewer-container">
      <div className="spread-viewer-scroll" ref={containerRef}>
        <div className="spread-list">
          {spreads.map((spread, index) => (
            <div
              key={index}
              className="spread-item"
              data-spread-index={index}
            >
              {/* 見開き番号ラベル */}
              <div className="spread-number-label">
                {spread.right && spread.left
                  ? `見開き ${spread.right.globalIndex + 1}～${spread.left.globalIndex + 1}P`
                  : spread.right
                    ? `見開き ${spread.right.globalIndex + 1}P`
                    : spread.left
                      ? `見開き ${spread.left.globalIndex + 1}P`
                      : `見開き ${index + 1} / ${totalSpreads}`}
              </div>

              {/* 見開きコンテナ */}
              <div className="spread-pair">
                {/* 右ページ（画面右側）- 日本式で右から読む */}
                {renderPage(spread.right, 'right')}
                {/* 中央の綴じ目（ノド） */}
                <div className="spread-gutter" />
                {/* 左ページ（画面左側） */}
                {renderPage(spread.left, 'left')}
              </div>

              {/* ページ情報バー */}
              <div className="spread-info-bar">
                {spread.right && (
                  <span className="spread-page-label right">
                    P.{spread.right.globalIndex + 1}
                    {spread.right.page.fileName && ` - ${spread.right.page.fileName}`}
                  </span>
                )}
                {spread.left && (
                  <span className="spread-page-label left">
                    P.{spread.left.globalIndex + 1}
                    {spread.left.page.fileName && ` - ${spread.left.page.fileName}`}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* フローティングスクロールバー */}
      {totalSpreads > 1 && (
        <div className="spread-nav-bar">
          <div
            className="spread-nav-track"
            ref={trackRef}
            onMouseDown={handleMouseDown}
          >
            <div
              className={`spread-nav-handle ${isDragging ? 'dragging' : ''}`}
              style={{ top: `calc(${displayHandlePosition * 100}% - ${displayHandlePosition * 40}px)` }}
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
    </div>
  );
}
