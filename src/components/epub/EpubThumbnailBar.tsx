import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import type { EpubPageImageProfileOverride, EpubPageInfo } from '../../types';
import { EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS, EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_OPTIONS } from '../../types';
import { AlertTriangleIcon, ReplaceIcon } from '../../icons';
import { getValidationMessage } from '../../utils/validationMessage';

interface EpubThumbnailBarProps {
  pages: EpubPageInfo[];
  currentSpread: number;
  selectedPageId: string | null;
  selectedPageIds?: string[];
  onSelectPage: (pageId: string, e?: React.MouseEvent) => void;
  onSpreadChange: (index: number) => void;
  onReplaceFile?: (originalPageId: string) => void;
  bindingDirection?: 'rtl' | 'ltr';
}

export function EpubThumbnailBar({
  pages,
  currentSpread,
  selectedPageId,
  selectedPageIds,
  onSelectPage,
  onSpreadChange,
  onReplaceFile,
  bindingDirection = 'rtl',
}: EpubThumbnailBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const validationContext = useStore((s) => s.validationContext);
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
    setEpubPageImageProfileOverride,
    reorderEpubPage,
  } = useStore();

  // ページインデックス→スプレッドインデックスのマッピング（表紙単独スプレッド対応）
  const pageToSpread = useMemo(() => {
    const map: number[] = [];
    let spreadIdx = 0;
    let i = 0;
    while (i < pages.length) {
      const current = pages[i];
      if (current.isCover) {
        map[i] = spreadIdx;
        i += 1;
      } else {
        const next = pages[i + 1];
        if (next) {
          map[i] = spreadIdx;
          map[i + 1] = spreadIdx;
          i += 2;
        } else {
          map[i] = spreadIdx;
          i += 1;
        }
      }
      spreadIdx++;
    }
    return map;
  }, [pages]);

  // 現在のスプレッドにスクロール
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const pageIndex = pageToSpread.findIndex((s) => s === currentSpread);
    if (pageIndex < 0) return;
    const thumbnails = container.querySelectorAll('.epub-thumbnail-item');
    const target = thumbnails[pageIndex] as HTMLElement;

    if (target) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const scrollLeft = target.offsetLeft - containerRect.width / 2 + targetRect.width / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [currentSpread, pageToSpread]);

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
    e.stopPropagation();
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

  const handleSetImageProfileOverride = (override: EpubPageImageProfileOverride) => {
    if (contextMenu) {
      setEpubPageImageProfileOverride(contextMenu.pageId, override);
      setContextMenu(null);
    }
  };

  // 選択したページの情報
  const selectedPage = contextMenu ? pages.find(p => p.id === contextMenu.pageId) : null;

  // ドラッグ&ドロップ
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (contextMenu) {
      e.preventDefault();
      return;
    }
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
              selectedPageId === page.id || (selectedPageIds?.includes(page.id) ?? false) ? 'selected' : ''
            } ${pageToSpread[index] === currentSpread ? 'current-spread' : ''} ${
              dropIndex === index ? 'drop-target' : ''
            }`}
            onClick={(e) => {
              if (e.button !== 0) return;
              onSelectPage(page.id, e);
              onSpreadChange(pageToSpread[index]);
            }}
            onMouseDown={(e) => {
              if (e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onContextMenu={(e) => handleContextMenu(e, page.id)}
            draggable={!contextMenu}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
          >
            <div className="epub-thumbnail-image">
              {page.isBlank ? (
                <div className="epub-thumbnail-blank">
                  <span>白紙</span>
                </div>
              ) : (
                <img
                  src={getImageSrc(page)}
                  alt={`Page ${index + 1}`}
                  loading="lazy"
                />
              )}
              {page.fileValidationStatus && page.fileValidationStatus !== 'ok' && (
                <div className="epub-thumb-alert-group">
                  <span
                    className="epub-thumb-file-alert"
                    title={getValidationMessage(page, validationContext, page.originalChapterType)}
                  >
                    <AlertTriangleIcon size={11} />
                  </span>
                  {onReplaceFile && page.originalPageId && page.fileValidationStatus === 'modified' && (
                    <button
                      className="epub-thumb-file-replace-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReplaceFile(page.originalPageId!);
                      }}
                      title="リンクを更新"
                    >
                      <ReplaceIcon size={10} />
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="epub-thumbnail-info">
              {page.isCover && <span className="page-badge cover">表紙</span>}
              {page.isColophon && <span className="page-badge colophon">奥付</span>}
              {page.imageProfileOverride && page.imageProfileOverride !== 'auto' && (
                <span className="page-badge profile">
                  {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS[page.imageProfileOverride]}
                </span>
              )}
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
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
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
          <div className="epub-context-menu-separator" />
          {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_OPTIONS.map((override) => (
            <button
              key={override}
              onClick={() => handleSetImageProfileOverride(override)}
              className={selectedPage?.imageProfileOverride === override ? 'selected' : ''}
            >
              ICC: {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS[override]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
