import { useEffect, useRef, useState, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Page, PAGE_TYPE_LABELS, PAGE_TYPE_COLORS } from '../../types';
import { queueThumbnail } from '../../hooks';

// サムネイルカード
export function ThumbnailCard({
  page,
  globalIndex,
  thumbnailSize,
  isHighlighted,
  isSelected,
  isMultiSelected,
  onSelect,
  onCtrlClick,
  onShiftClick,
  pageCount,
  lastGlobalIndex,
}: {
  page: Page;
  globalIndex: number;
  thumbnailSize: number;
  isHighlighted?: boolean;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  onSelect?: () => void;
  onCtrlClick?: () => void;
  onShiftClick?: () => void;
  pageCount?: number;
  lastGlobalIndex?: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 250ms ease',
  };

  const isSpecialPage = page.pageType !== 'file';
  const hasFile = page.filePath && page.modifiedTime;

  // IntersectionObserverで可視状態を追跡
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect(); // 一度表示されたら監視を停止
        }
      },
      { rootMargin: '100px' } // 100px先読み
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // 可視状態かつファイルがあればサムネイル生成をキューに追加
    if (isVisible && hasFile && page.thumbnailStatus === 'pending') {
      queueThumbnail(page.id, page.filePath!, page.modifiedTime!);
    }
  }, [isVisible, page.id, page.filePath, page.modifiedTime, page.thumbnailStatus, hasFile]);

  // サムネイルのURL（assetプロトコル経由）
  const thumbnailSrc = useMemo(() => {
    if (page.thumbnailStatus === 'ready' && page.thumbnailCachePath) {
      return convertFileSrc(page.thumbnailCachePath);
    }
    return null;
  }, [page.thumbnailStatus, page.thumbnailCachePath]);

  const renderThumbnail = () => {
    // 特殊ページでファイルがある場合はサムネイル表示
    if (isSpecialPage && hasFile) {
      if (thumbnailSrc) {
        return (
          <>
            <img
              src={thumbnailSrc}
              alt={page.fileName}
              className="thumbnail-image"
            />
            <span
              className="thumbnail-type-overlay"
              style={{ backgroundColor: PAGE_TYPE_COLORS[page.pageType] }}
            >
              {PAGE_TYPE_LABELS[page.pageType]}
            </span>
          </>
        );
      } else if (page.thumbnailStatus === 'error') {
        return <div className="thumbnail-error">読込エラー</div>;
      } else {
        return <div className="thumbnail-loading">読込中...</div>;
      }
    }

    // 特殊ページでファイルがない場合はラベル表示
    if (isSpecialPage) {
      return (
        <div
          className="thumbnail-special"
          style={{ backgroundColor: PAGE_TYPE_COLORS[page.pageType] + '20' }}
        >
          <span
            className="special-label"
            style={{ color: PAGE_TYPE_COLORS[page.pageType] }}
          >
            {page.label || PAGE_TYPE_LABELS[page.pageType]}
          </span>
        </div>
      );
    }

    // 通常のファイルページ
    if (thumbnailSrc) {
      return (
        <img
          src={thumbnailSrc}
          alt={page.fileName}
          className="thumbnail-image"
        />
      );
    } else if (page.thumbnailStatus === 'error') {
      return <div className="thumbnail-error">読込エラー</div>;
    } else {
      return <div className="thumbnail-loading">読込中...</div>;
    }
  };

  const displayName = isSpecialPage
    ? (hasFile ? `${PAGE_TYPE_LABELS[page.pageType]}: ${page.fileName}` : (page.label || PAGE_TYPE_LABELS[page.pageType]))
    : (page.fileName || '');

  // 複数のrefをマージ
  const mergedRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  return (
    <div
      ref={mergedRef}
      style={{
        ...style,
        opacity: isDragging ? 0 : 1,
        width: thumbnailSize,
        height: thumbnailSize * 1.4,
      }}
      {...attributes}
      {...listeners}
      className={`thumbnail-card ${isHighlighted ? 'highlighted' : ''} ${isSpecialPage ? 'special' : ''} ${isSelected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
      data-page-id={page.id}
      data-page-type={page.pageType}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) {
          onCtrlClick?.();
        } else if (e.shiftKey) {
          onShiftClick?.();
        } else {
          onSelect?.();
        }
      }}
    >
      <div className="thumbnail-wrapper">
        {renderThumbnail()}
      </div>
      <div className="thumbnail-info">
        <span className="thumbnail-number">
          {pageCount && pageCount > 1 && lastGlobalIndex !== undefined
            ? `${globalIndex + 1}～${lastGlobalIndex + 1}P`
            : `${globalIndex + 1}P`}
        </span>
        <span className="thumbnail-filename" title={displayName}>
          {(() => {
            const maxLength = thumbnailSize <= 100 ? 10 : 15;
            return displayName.length > maxLength ? displayName.slice(0, maxLength) + '…' : displayName;
          })()}
        </span>
      </div>
    </div>
  );
}
