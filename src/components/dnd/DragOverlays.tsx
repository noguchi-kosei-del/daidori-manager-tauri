import { convertFileSrc } from '@tauri-apps/api/core';
import { Page, PAGE_TYPE_LABELS, PAGE_TYPE_COLORS } from '../../types';
import { Chapter, CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS } from '../../types';
import { FileIcon } from '../../icons';

// ドラッグオーバーレイ用のサムネイル
export function DragOverlayThumbnail({
  page,
  thumbnailSize,
}: {
  page: Page;
  thumbnailSize: number;
}) {
  const isSpecialPage = page.pageType !== 'file';
  const displayName = isSpecialPage
    ? (page.label || PAGE_TYPE_LABELS[page.pageType])
    : (page.fileName || '');

  return (
    <div
      className="thumbnail-drag-overlay"
      style={{ width: thumbnailSize, height: thumbnailSize * 1.4 }}
    >
      <div className="thumbnail-wrapper">
        {isSpecialPage ? (
          <div
            className="thumbnail-special"
            style={{ backgroundColor: PAGE_TYPE_COLORS[page.pageType] + '20' }}
          >
            <span
              className="special-label"
              style={{ color: PAGE_TYPE_COLORS[page.pageType] }}
            >
              {displayName}
            </span>
          </div>
        ) : page.thumbnailStatus === 'ready' && page.thumbnailCachePath ? (
          <img
            src={convertFileSrc(page.thumbnailCachePath)}
            alt={page.fileName}
            className="thumbnail-image"
          />
        ) : (
          <div className="thumbnail-loading">読込中...</div>
        )}
      </div>
      <div className="thumbnail-info">
        <span className="thumbnail-filename">{displayName.length > 15 ? displayName.slice(0, 15) + '…' : displayName}</span>
      </div>
    </div>
  );
}

// サイドバー用のドラッグオーバーレイ
export function DragOverlaySidebarItem({ page }: { page: Page }) {
  const isSpecialPage = page.pageType !== 'file';
  const displayName = isSpecialPage
    ? (page.label || PAGE_TYPE_LABELS[page.pageType])
    : (page.fileName || '');

  return (
    <div className="sidebar-drag-overlay">
      {isSpecialPage ? (
        <span
          className="sidebar-drag-badge"
          style={{ backgroundColor: PAGE_TYPE_COLORS[page.pageType] }}
        >
          {PAGE_TYPE_LABELS[page.pageType]}
        </span>
      ) : (
        <span className="sidebar-drag-icon"><FileIcon size={14} /></span>
      )}
      <span className="sidebar-drag-name">{displayName}</span>
    </div>
  );
}

// チャプター用のドラッグオーバーレイ
export function DragOverlayChapterItem({ chapter }: { chapter: Chapter }) {
  return (
    <div className="chapter-drag-overlay">
      <span
        className="chapter-type-badge"
        style={{ backgroundColor: CHAPTER_TYPE_COLORS[chapter.type] }}
      >
        {CHAPTER_TYPE_LABELS[chapter.type]}
      </span>
      <span className="chapter-drag-name">{chapter.name}</span>
      <span className="chapter-drag-count">({chapter.pages.length})</span>
    </div>
  );
}
