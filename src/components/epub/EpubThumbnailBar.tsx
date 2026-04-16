import { useRef, useEffect, useCallback, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import type { EpubPageInfo } from '../../types';

interface EpubThumbnailBarProps {
  pages: EpubPageInfo[];
  currentSpread: number;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onSpreadChange: (index: number) => void;
  bindingDirection?: 'rtl' | 'ltr';
}

export function EpubThumbnailBar({
  pages,
  currentSpread,
  selectedPageId,
  onSelectPage,
  onSpreadChange,
  bindingDirection = 'rtl',
}: EpubThumbnailBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    pageId: string;
  } | null>(null);

  const {
    setEpubPageAsCover,
    setEpubPageAsColophon,
    clearEpubPageCover,
    clearEpubPageColophon,
    reorderEpubPage,
  } = useStore();

  // 現在のスプレッドにスクロール
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const pageIndex = currentSpread * 2;
    const thumbnails = container.querySelectorAll('.epub-thumbnail-item');
    const target = thumbnails[pageIndex] as HTMLElement;

    if (target) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const scrollLeft = target.offsetLeft - containerRect.width / 2 + targetRect.width / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [currentSpread]);

  // 画像ソースを取得
  const getImageSrc = (page: EpubPageInfo): string => {
    if (page.thumbnailPath) {
      return page.thumbnailPath.startsWith('data:')
        ? page.thumbnailPath
        : convertFileSrc(page.thumbnailPath);
    }
    return convertFileSrc(page.sourcePath);
  };

  // 右クリックメニュー
  const handleContextMenu = useCallback((e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      pageId,
    });
  }, []);

  // コンテキストメニューを閉じる
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // コンテキストメニューのアクション
  const handleSetCover = () => {
    if (contextMenu) {
      setEpubPageAsCover(contextMenu.pageId);
      setContextMenu(null);
    }
  };

  const handleSetColophon = () => {
    if (contextMenu) {
      setEpubPageAsColophon(contextMenu.pageId);
      setContextMenu(null);
    }
  };

  const handleClearCover = () => {
    clearEpubPageCover();
    setContextMenu(null);
  };

  const handleClearColophon = () => {
    if (contextMenu) {
      clearEpubPageColophon(contextMenu.pageId);
      setContextMenu(null);
    }
  };

  // 選択したページの情報
  const selectedPage = contextMenu ? pages.find(p => p.id === contextMenu.pageId) : null;

  // ドラッグ&ドロップ
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDropIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDropIndex(null);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      reorderEpubPage(draggedIndex, index);
    }
    setDraggedIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropIndex(null);
  };

  return (
    <div className="epub-thumbnail-bar">
      <div className={`epub-thumbnail-scroll ${bindingDirection === 'rtl' ? 'rtl' : 'ltr'}`} ref={scrollRef}>
        {pages.map((page, index) => (
          <div
            key={page.id}
            className={`epub-thumbnail-item ${
              selectedPageId === page.id ? 'selected' : ''
            } ${Math.floor(index / 2) === currentSpread ? 'current-spread' : ''} ${
              dropIndex === index ? 'drop-target' : ''
            }`}
            onClick={() => {
              onSelectPage(page.id);
              onSpreadChange(Math.floor(index / 2));
            }}
            onContextMenu={(e) => handleContextMenu(e, page.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
          >
            <div className="epub-thumbnail-image">
              <img
                src={getImageSrc(page)}
                alt={`Page ${index + 1}`}
                loading="lazy"
              />
            </div>
            <div className="epub-thumbnail-info">
              {page.isCover && <span className="page-badge cover">表紙</span>}
              {page.isColophon && <span className="page-badge colophon">奥付</span>}
              <span className="page-number">{index + 1}</span>
            </div>
          </div>
        ))}
      </div>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <div
          className="epub-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {!selectedPage?.isCover && (
            <button onClick={handleSetCover}>表紙に設定</button>
          )}
          {selectedPage?.isCover && (
            <button onClick={handleClearCover}>表紙を解除</button>
          )}
          {!selectedPage?.isColophon && (
            <button onClick={handleSetColophon}>奥付に設定</button>
          )}
          {selectedPage?.isColophon && (
            <button onClick={handleClearColophon}>奥付を解除</button>
          )}
        </div>
      )}
    </div>
  );
}
