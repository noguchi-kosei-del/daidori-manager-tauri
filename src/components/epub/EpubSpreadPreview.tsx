import { useState, useRef, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { EpubPageInfo } from '../../types';

interface EpubSpreadPreviewProps {
  pages: EpubPageInfo[];
  currentSpread: number;
  selectedPageId: string | null;
  onSpreadChange: (index: number) => void;
  onSelectPage: (pageId: string) => void;
}

export function EpubSpreadPreview({
  pages,
  currentSpread,
  selectedPageId,
  onSpreadChange,
  onSelectPage,
}: EpubSpreadPreviewProps) {
  const [zoom, setZoom] = useState(100);
  const containerRef = useRef<HTMLDivElement>(null);

  // スプレッドを計算（2ページずつ）
  const spreads: EpubPageInfo[][] = [];
  for (let i = 0; i < pages.length; i += 2) {
    spreads.push(pages.slice(i, i + 2));
  }

  const currentPages = spreads[currentSpread] || [];
  const totalSpreads = spreads.length;

  // キーボードナビゲーション
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentSpread < totalSpreads - 1) {
        onSpreadChange(currentSpread + 1);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentSpread > 0) {
        onSpreadChange(currentSpread - 1);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSpreadChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSpreadChange(totalSpreads - 1);
    }
  }, [currentSpread, totalSpreads, onSpreadChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

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

  return (
    <div
      className="epub-spread-preview"
      ref={containerRef}
      tabIndex={0}
    >
      {/* ズームコントロール */}
      <div className="epub-zoom-control">
        <button
          className="zoom-btn"
          onClick={() => setZoom(Math.max(50, zoom - 10))}
          disabled={zoom <= 50}
        >
          −
        </button>
        <input
          type="range"
          min="50"
          max="200"
          value={zoom}
          onChange={(e) => setZoom(parseInt(e.target.value))}
          className="zoom-slider"
        />
        <span className="zoom-value">{zoom}%</span>
        <button
          className="zoom-btn"
          onClick={() => setZoom(Math.min(200, zoom + 10))}
          disabled={zoom >= 200}
        >
          +
        </button>
      </div>

      {/* 見開き表示エリア */}
      <div className="epub-spread-container" style={{ transform: `scale(${zoom / 100})` }}>
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
                onClick={() => onSelectPage(currentPages[0].id)}
              >
                <img
                  src={getImageSrc(currentPages[0])}
                  alt={`Page ${getPageIndex(currentPages[0])}`}
                />
                <div className="epub-page-label">
                  {currentPages[0].isCover && <span className="page-badge cover">表紙</span>}
                  {currentPages[0].isColophon && <span className="page-badge colophon">奥付</span>}
                  <span className="page-number">{getPageIndex(currentPages[0])}p</span>
                </div>
              </div>
            )}

            {/* ノド */}
            <div className="epub-spread-gutter" />

            {/* 左ページ */}
            {currentPages[1] && (
              <div
                className={`epub-spread-page left-page ${selectedPageId === currentPages[1].id ? 'selected' : ''}`}
                onClick={() => onSelectPage(currentPages[1].id)}
              >
                <img
                  src={getImageSrc(currentPages[1])}
                  alt={`Page ${getPageIndex(currentPages[1])}`}
                />
                <div className="epub-page-label">
                  {currentPages[1].isCover && <span className="page-badge cover">表紙</span>}
                  {currentPages[1].isColophon && <span className="page-badge colophon">奥付</span>}
                  <span className="page-number">{getPageIndex(currentPages[1])}p</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ナビゲーション */}
      <div className="epub-spread-nav">
        <button
          className="nav-btn"
          onClick={() => onSpreadChange(currentSpread - 1)}
          disabled={currentSpread === 0}
        >
          ←
        </button>
        <span className="nav-info">
          {currentSpread + 1} / {totalSpreads}
        </span>
        <button
          className="nav-btn"
          onClick={() => onSpreadChange(currentSpread + 1)}
          disabled={currentSpread >= totalSpreads - 1}
        >
          →
        </button>
      </div>
    </div>
  );
}
