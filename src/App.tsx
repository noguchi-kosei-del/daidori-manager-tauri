import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { desktopDir, join } from '@tauri-apps/api/path';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore, FileInfo, THUMBNAIL_SIZES, ThumbnailSize } from './store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Chapter,
  ChapterType,
  CHAPTER_TYPE_LABELS,
  CHAPTER_TYPE_COLORS,
  Page,
  PageType,
  PAGE_TYPE_LABELS,
  PAGE_TYPE_COLORS,
  FILE_SELECTABLE_PAGE_TYPES,
  DaidoriProjectFile,
  SavedChapter,
  SavedPage,
  FileValidationResult,
  RecentFile,
} from './types';

// サムネイル生成キュー（並列処理版）
const thumbnailQueue: { pageId: string; filePath: string; modifiedTime: number }[] = [];
let isProcessingQueue = false;
let processingPromise: Promise<void> | null = null;
const PARALLEL_LIMIT = 4; // 同時処理数

async function processThumbnailQueue() {
  if (isProcessingQueue || thumbnailQueue.length === 0) return;
  isProcessingQueue = true;

  try {
    while (thumbnailQueue.length > 0) {
      // 最大PARALLEL_LIMIT個のアイテムを同時に処理
      const batch = thumbnailQueue.splice(0, PARALLEL_LIMIT);

      await Promise.all(
        batch.map(async (item) => {
          try {
            const thumbnailPath = await invoke<string>('generate_thumbnail', {
              filePath: item.filePath,
              modifiedTime: item.modifiedTime,
            });
            useStore.getState().updatePageThumbnail(item.pageId, thumbnailPath);
          } catch (error) {
            console.error('Thumbnail generation failed:', error);
            useStore.getState().setPageThumbnailError(item.pageId);
          }
        })
      );
    }
  } finally {
    isProcessingQueue = false;
  }
}

function queueThumbnail(pageId: string, filePath: string, modifiedTime: number) {
  // 重複チェック: 同じpageIdが既にキューにある場合はスキップ
  const exists = thumbnailQueue.find(item => item.pageId === pageId);
  if (exists) return;

  thumbnailQueue.push({ pageId, filePath, modifiedTime });

  // 競合状態防止: Promiseチェーンで順次処理を保証
  if (!processingPromise) {
    processingPromise = processThumbnailQueue().finally(() => {
      processingPromise = null;
    });
  }
}

// ファイルドロップ関連のグローバル状態（windowオブジェクトで管理してHMR対策）
declare global {
  interface Window {
    __dropListenersSetup?: boolean;
    __lastDropTime?: number;
    __isProcessingDrop?: boolean;
    __dropHandler?: ((paths: string[], targetPageId: string | null, mode: string | null, targetChapterId: string | null, insertPosition: 'before' | 'after' | null) => Promise<void>) | null;
    __setIsDraggingFiles?: ((value: boolean) => void) | null;
    __setFileDropTargetPageId?: ((value: string | null) => void) | null;
    __setFileDropMode?: ((value: 'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null) => void) | null;
    __setFileDropTargetChapterId?: ((value: string | null) => void) | null;
    __setInsertPosition?: ((value: 'before' | 'after' | null) => void) | null;
    __getDropInfoFromPosition?: ((x: number, y: number) => { pageId: string | null; chapterId: string | null; mode: 'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null; insertPosition: 'before' | 'after' | null }) | null;
    __autoScrollPreview?: ((x: number, y: number) => void) | null;
    __fileDropTargetPageId?: string | null;
    __fileDropMode?: 'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null;
    __fileDropTargetChapterId?: string | null;
    __insertPosition?: 'before' | 'after' | null;
  }
}

// 初期化
if (typeof window !== 'undefined') {
  window.__lastDropTime = window.__lastDropTime || 0;
  window.__isProcessingDrop = window.__isProcessingDrop || false;
  window.__fileDropTargetPageId = window.__fileDropTargetPageId || null;
  window.__fileDropMode = window.__fileDropMode || null;
  window.__fileDropTargetChapterId = window.__fileDropTargetChapterId || null;
  window.__insertPosition = window.__insertPosition || null;
}

// 見開きプレビューコンポーネント（縦スクロール式）
function SpreadViewer({
  pages,
  onPageSelect,
}: {
  pages: { page: Page; chapter: Chapter; globalIndex: number }[];
  onPageSelect?: (chapterId: string, pageId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleSpreads, setVisibleSpreads] = useState<Set<number>>(new Set());

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
          ) : page.thumbnailStatus === 'ready' && page.thumbnailPath ? (
            <img
              src={page.thumbnailPath}
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
              見開き {index + 1} / {totalSpreads}
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
  );
}

// サムネイルカード
function ThumbnailCard({
  page,
  globalIndex,
  thumbnailSize,
  isHighlighted,
  isSelected,
  isMultiSelected,
  onSelect,
  onCtrlClick,
  onShiftClick,
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

  useEffect(() => {
    // ファイルがあればサムネイル生成をキューに追加（通常ページ + ファイル付き特殊ページ）
    if (hasFile && page.thumbnailStatus === 'pending') {
      queueThumbnail(page.id, page.filePath!, page.modifiedTime!);
    }
  }, [page.id, page.filePath, page.modifiedTime, page.thumbnailStatus, hasFile]);

  const renderThumbnail = () => {
    // 特殊ページでファイルがある場合はサムネイル表示
    if (isSpecialPage && hasFile) {
      if (page.thumbnailStatus === 'ready' && page.thumbnailPath) {
        return (
          <>
            <img
              src={page.thumbnailPath}
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
    if (page.thumbnailStatus === 'ready' && page.thumbnailPath) {
      return (
        <img
          src={page.thumbnailPath}
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
    : page.fileName;

  return (
    <div
      ref={setNodeRef}
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
        <span className="thumbnail-number">{globalIndex + 1}</span>
        <span className="thumbnail-filename" title={displayName}>
          {displayName}
        </span>
      </div>
    </div>
  );
}

// ドラッグオーバーレイ用のサムネイル
function DragOverlayThumbnail({
  page,
  thumbnailSize,
}: {
  page: Page;
  thumbnailSize: number;
}) {
  const isSpecialPage = page.pageType !== 'file';
  const displayName = isSpecialPage
    ? (page.label || PAGE_TYPE_LABELS[page.pageType])
    : page.fileName;

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
        ) : page.thumbnailStatus === 'ready' && page.thumbnailPath ? (
          <img
            src={page.thumbnailPath}
            alt={page.fileName}
            className="thumbnail-image"
          />
        ) : (
          <div className="thumbnail-loading">読込中...</div>
        )}
      </div>
      <div className="thumbnail-info">
        <span className="thumbnail-filename">{displayName}</span>
      </div>
    </div>
  );
}

// サイドバー用のドラッグオーバーレイ
function DragOverlaySidebarItem({ page }: { page: Page }) {
  const isSpecialPage = page.pageType !== 'file';
  const displayName = isSpecialPage
    ? (page.label || PAGE_TYPE_LABELS[page.pageType])
    : page.fileName;

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
        <span className="sidebar-drag-icon">📄</span>
      )}
      <span className="sidebar-drag-name">{displayName}</span>
    </div>
  );
}

// チャプター用のドラッグオーバーレイ
function DragOverlayChapterItem({ chapter }: { chapter: Chapter }) {
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

// サイドバー用のページID（プレビューと区別するため）
const SIDEBAR_PREFIX = 'sidebar-';

// 新規チャプター作成ゾーンのID
const NEW_CHAPTER_DROP_ZONE_ID = 'new-chapter-drop-zone';
const NEW_CHAPTER_DROP_ZONE_START_ID = 'new-chapter-drop-zone-start';
const SIDEBAR_NEW_CHAPTER_DROP_ZONE_ID = 'sidebar-new-chapter-drop-zone';
const SIDEBAR_NEW_CHAPTER_DROP_ZONE_START_ID = 'sidebar-new-chapter-drop-zone-start';
const CHAPTER_REORDER_DROP_ZONE_START_ID = 'chapter-reorder-drop-zone-start';
const CHAPTER_REORDER_DROP_ZONE_END_ID = 'chapter-reorder-drop-zone-end';

// 挿入ラインコンポーネント（ドロップ位置を示す）
function InsertionLine() {
  return <div className="insertion-line" />;
}

// 新規チャプター作成ゾーン（ドロップ可能）
function NewChapterDropZone({ isActive, isDragging, position = 'end' }: { isActive: boolean; isDragging: boolean; position?: 'start' | 'end' }) {
  const { setNodeRef, isOver } = useDroppable({
    id: position === 'start' ? NEW_CHAPTER_DROP_ZONE_START_ID : NEW_CHAPTER_DROP_ZONE_ID,
  });

  if (!isDragging) return null;

  return (
    <div
      ref={setNodeRef}
      className={`new-chapter-drop-zone ${position} ${isActive || isOver ? 'active' : ''}`}
    >
      <div className="new-chapter-drop-content">
        <span className="new-chapter-icon">➕</span>
        <span className="new-chapter-text">
          {position === 'start' ? '先頭に新しいチャプターを作成' : 'ここにドロップで新しいチャプターを作成'}
        </span>
      </div>
    </div>
  );
}

// サイドバー用の新規チャプター作成ゾーン（ドロップ可能）
function SidebarNewChapterDropZone({ isDragging, position = 'end' }: { isDragging: boolean; position?: 'start' | 'end' }) {
  const { setNodeRef, isOver } = useDroppable({
    id: position === 'start' ? SIDEBAR_NEW_CHAPTER_DROP_ZONE_START_ID : SIDEBAR_NEW_CHAPTER_DROP_ZONE_ID,
  });

  if (!isDragging) return null;

  return (
    <div
      ref={setNodeRef}
      className={`sidebar-new-chapter-zone ${position} ${isOver ? 'active' : ''}`}
    >
      <span className="sidebar-new-chapter-icon">➕</span>
      <span className="sidebar-new-chapter-text">
        {position === 'start' ? '先頭にチャプターを作成' : '新しいチャプターを作成'}
      </span>
    </div>
  );
}

// サイドバー用のチャプター並べ替えゾーン（ドロップ可能）
function SidebarChapterReorderDropZone({ isDragging, position = 'end' }: { isDragging: boolean; position?: 'start' | 'end' }) {
  const { setNodeRef, isOver } = useDroppable({
    id: position === 'start' ? CHAPTER_REORDER_DROP_ZONE_START_ID : CHAPTER_REORDER_DROP_ZONE_END_ID,
  });

  if (!isDragging) return null;

  return (
    <div
      ref={setNodeRef}
      className={`sidebar-chapter-reorder-zone ${position} ${isOver ? 'active' : ''}`}
    >
      <span className="sidebar-chapter-reorder-icon">↕</span>
      <span className="sidebar-chapter-reorder-text">
        {position === 'start' ? '先頭に移動' : '末尾に移動'}
      </span>
    </div>
  );
}

// サイドバーのソート可能なページアイテム
function SortablePageItem({
  page,
  index,
  isSelected,
  onSelect,
  onAddSpecialPage,
  onSelectFile,
  showInsertionBefore,
  showInsertionAfter,
}: {
  page: Page;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onAddSpecialPage: (pageType: PageType, afterPageId: string) => void;
  onSelectFile: (pageId: string) => void;
  showInsertionBefore?: boolean;
  showInsertionAfter?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const sidebarId = `${SIDEBAR_PREFIX}${page.id}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sidebarId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms ease',
  };

  const isSpecialPage = page.pageType !== 'file';
  const isFileSelectable = FILE_SELECTABLE_PAGE_TYPES.includes(page.pageType);
  const hasFile = isSpecialPage && page.filePath;
  const displayName = isSpecialPage
    ? (hasFile ? page.fileName : (page.label || PAGE_TYPE_LABELS[page.pageType]))
    : page.fileName;

  return (
    <>
      {showInsertionBefore && <InsertionLine />}
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={`page-item ${isDragging ? 'page-item-dragging' : ''} ${isSpecialPage ? 'special-page' : ''} ${hasFile ? 'has-file' : ''} ${isSelected ? 'selected' : ''}`}
        data-page-type={page.pageType}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        {isDragging ? (
          <div className="page-item-placeholder">
            <span className="placeholder-line"></span>
          </div>
        ) : (
          <>
            <span className="page-index">{index + 1}.</span>
            {isSpecialPage && (
              <span
                className="page-type-badge"
                style={{ backgroundColor: PAGE_TYPE_COLORS[page.pageType] }}
              >
                {PAGE_TYPE_LABELS[page.pageType]}
              </span>
            )}
            <span className="page-name" title={displayName}>
              {hasFile ? page.fileName : (isSpecialPage ? '' : displayName)}
            </span>
            <div className="page-actions">
              {isFileSelectable && (
                <button
                  className="page-file-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectFile(page.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  title={hasFile ? 'ファイルを変更' : 'ファイルを選択'}
                >
                  📁
                </button>
              )}
              <button
                className="page-add-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="ページを挿入"
              >
                +
              </button>
              {showMenu && (
                <div className="page-add-menu">
                  <button onClick={() => { onAddSpecialPage('cover', page.id); setShowMenu(false); }}>
                    表紙
                  </button>
                  <button onClick={() => { onAddSpecialPage('blank', page.id); setShowMenu(false); }}>
                    白紙
                  </button>
                  <button onClick={() => { onAddSpecialPage('intermission', page.id); setShowMenu(false); }}>
                    幕間
                  </button>
                  <button onClick={() => { onAddSpecialPage('colophon', page.id); setShowMenu(false); }}>
                    奥付
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {showInsertionAfter && <InsertionLine />}
    </>
  );
}

// チャプターアイテム
function ChapterItem({
  chapter,
  isSelected,
  selectedPageId,
  onSelect,
  onSelectPage,
  onToggle,
  onRename,
  onDelete,
  onAddFiles,
  onAddFolder,
  onAddSpecialPage,
  onSelectFile,
  dropTarget,
}: {
  chapter: Chapter;
  isSelected: boolean;
  selectedPageId: string | null;
  onSelect: () => void;
  onSelectPage: (pageId: string) => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onAddSpecialPage: (pageType: PageType, afterPageId?: string) => void;
  onSelectFile: (pageId: string) => void;
  dropTarget: {
    type: 'page-before' | 'page-after' | 'chapter-before' | 'chapter-after' | 'chapter-end' | 'new-chapter-start' | 'new-chapter-end';
    chapterId: string;
    pageId?: string;
  } | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chapter.id });

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(chapter.name);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleRename = () => {
    if (editName.trim()) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  // チャプターへの挿入ライン表示判定
  const showChapterInsertionBefore = dropTarget?.type === 'chapter-before' && dropTarget.chapterId === chapter.id;
  const showChapterInsertionAfter = dropTarget?.type === 'chapter-after' && dropTarget.chapterId === chapter.id;

  return (
    <>
      {showChapterInsertionBefore && <InsertionLine />}
      <div
        ref={setNodeRef}
        style={{
          ...style,
          backgroundColor: chapter.type !== 'chapter' ? `${CHAPTER_TYPE_COLORS[chapter.type]}15` : undefined,
          borderColor: chapter.type !== 'chapter' ? `${CHAPTER_TYPE_COLORS[chapter.type]}40` : undefined,
        }}
        className={`chapter-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
        onClick={onSelect}
      >
      <div
        className="chapter-header"
        {...attributes}
        {...listeners}
      >
        <button
          className="chapter-collapse-btn"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {chapter.collapsed ? '▶' : '▼'}
        </button>
        <span
          className="chapter-type-badge"
          style={{ backgroundColor: CHAPTER_TYPE_COLORS[chapter.type] }}
        >
          {CHAPTER_TYPE_LABELS[chapter.type]}
        </span>
        {isEditing ? (
          <input
            type="text"
            className="chapter-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span
            className="chapter-name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
              setEditName(chapter.name);
            }}
          >
            {chapter.name}
          </span>
        )}
        <span className="chapter-page-count">({chapter.pages.length})</span>
        <div className="chapter-actions">
          <div className="chapter-add-wrapper">
            <button
              className="btn-icon"
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMenu(!showAddMenu);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="ページ追加"
            >
              +
            </button>
            {showAddMenu && (
              <>
                <div
                  className="menu-backdrop"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAddMenu(false);
                  }}
                />
                <div className="chapter-add-menu menu-down">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddFiles();
                      setShowAddMenu(false);
                    }}
                  >
                    📄 ファイルを選択
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddFolder();
                      setShowAddMenu(false);
                    }}
                  >
                    📁 フォルダを選択
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            className="btn-icon"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="削除"
          >
            ×
          </button>
        </div>
      </div>
      {!chapter.collapsed && (
        <div className="chapter-pages">
          {chapter.pages.length > 0 && (
            <SortableContext
              items={chapter.pages.map((p) => `${SIDEBAR_PREFIX}${p.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {chapter.pages.map((page, index) => (
                <SortablePageItem
                  key={page.id}
                  page={page}
                  index={index}
                  isSelected={selectedPageId === page.id}
                  onSelect={() => onSelectPage(page.id)}
                  onAddSpecialPage={onAddSpecialPage}
                  onSelectFile={onSelectFile}
                  showInsertionBefore={dropTarget?.type === 'page-before' && dropTarget.pageId === page.id && dropTarget.chapterId === chapter.id}
                  showInsertionAfter={dropTarget?.type === 'page-after' && dropTarget.pageId === page.id && dropTarget.chapterId === chapter.id}
                />
              ))}
            </SortableContext>
          )}
          <div className="chapter-pages-footer">
            <button
              className="add-special-btn"
              onClick={(e) => {
                e.stopPropagation();
                onAddSpecialPage('cover');
              }}
            >
              +表紙
            </button>
            <button
              className="add-special-btn"
              onClick={(e) => {
                e.stopPropagation();
                onAddSpecialPage('blank');
              }}
            >
              +白紙
            </button>
            <button
              className="add-special-btn"
              onClick={(e) => {
                e.stopPropagation();
                onAddSpecialPage('intermission');
              }}
            >
              +幕間
            </button>
            <button
              className="add-special-btn"
              onClick={(e) => {
                e.stopPropagation();
                onAddSpecialPage('colophon');
              }}
            >
              +奥付
            </button>
          </div>
        </div>
      )}
      </div>
      {showChapterInsertionAfter && <InsertionLine />}
    </>
  );
}

// チャプターごとのリネーム設定
export interface ChapterRenameSettings {
  enabled: boolean;
  startNumber: number;
  startNumberText?: string;
  digits: number;
  digitsText?: string;
  prefix: string;
}

// エクスポート設定
export interface ExportOptions {
  outputPath: string;
  exportMode: 'copy' | 'move';  // コピーか移動か
  convertToJpg: boolean;  // JPGに変換するか
  jpgQuality: number;  // JPG品質（1-100）
  renameMode: 'unified' | 'perChapter';
  // 一括設定
  startNumber: number;
  digits: number;
  prefix: string;
  // チャプターごとの設定
  perChapterSettings: Record<string, ChapterRenameSettings>;
}

// エクスポートモーダル
function ExportModal({
  isOpen,
  onClose,
  onExport,
  chapters,
}: {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  chapters: Chapter[];
}) {
  const [outputPath, setOutputPath] = useState('');
  const [exportMode, setExportMode] = useState<'copy' | 'move'>('copy');
  const [convertToJpg, setConvertToJpg] = useState(false);
  const [jpgQuality, setJpgQuality] = useState(100);
  const [renameMode, setRenameMode] = useState<'unified' | 'perChapter'>('unified');
  const [startNumber, setStartNumber] = useState(1);
  const [startNumberText, setStartNumberText] = useState('1');
  const [digits, setDigits] = useState(4);
  const [digitsText, setDigitsText] = useState('4');
  const [prefix, setPrefix] = useState('');
  const [perChapterSettings, setPerChapterSettings] = useState<Record<string, ChapterRenameSettings>>({});
  const [isExporting, setIsExporting] = useState(false);

  // 初期化：デフォルトの出力パスを設定
  useEffect(() => {
    const initDefaultPath = async () => {
      try {
        const desktop = await desktopDir();
        const defaultPath = await join(desktop, 'Script_Output', '台割');
        setOutputPath(defaultPath);
      } catch (e) {
        console.error('Failed to get desktop path:', e);
      }
    };
    if (isOpen && !outputPath) {
      initDefaultPath();
    }
  }, [isOpen, outputPath]);

  // チャプターごとの設定を初期化
  useEffect(() => {
    const newSettings: Record<string, ChapterRenameSettings> = {};
    chapters.forEach((chapter) => {
      if (!perChapterSettings[chapter.id]) {
        newSettings[chapter.id] = { enabled: true, startNumber: 1, startNumberText: '1', digits: 4, digitsText: '4', prefix: '' };
      } else {
        const existing = perChapterSettings[chapter.id];
        newSettings[chapter.id] = {
          ...existing,
          startNumberText: existing.startNumberText ?? String(existing.startNumber),
          digitsText: existing.digitsText ?? String(existing.digits),
        };
      }
    });
    if (Object.keys(newSettings).length > 0) {
      setPerChapterSettings((prev) => ({ ...prev, ...newSettings }));
    }
  }, [chapters]);

  const handleSelectFolder = async () => {
    const selected = await save({
      title: '出力先を選択',
      defaultPath: outputPath || 'export',
    });
    if (selected) {
      setOutputPath(selected);
    }
  };

  const handleExport = async () => {
    if (!outputPath) return;
    setIsExporting(true);
    await onExport({ outputPath, exportMode, convertToJpg, jpgQuality, renameMode, startNumber, digits, prefix, perChapterSettings });
    setIsExporting(false);
    onClose();
  };

  const updateChapterSetting = (chapterId: string, key: keyof ChapterRenameSettings, value: number | string | boolean) => {
    setPerChapterSettings((prev) => ({
      ...prev,
      [chapterId]: { ...prev[chapterId], [key]: value },
    }));
  };

  // プレビュー例
  const previewName1 = `${prefix}${String(startNumber).padStart(digits, '0')}.jpg`;
  const previewName2 = `${prefix}${String(startNumber + 1).padStart(digits, '0')}.jpg`;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>エクスポート</h2>
          <button className="btn-icon modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>出力先フォルダ</label>
            <div className="input-with-button">
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="フォルダを選択..."
                readOnly
              />
              <button className="btn-secondary" onClick={handleSelectFolder}>
                参照
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>出力方法</label>
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === 'copy'}
                  onChange={() => setExportMode('copy')}
                />
                コピー
                <span className="radio-description">元ファイルを残す</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === 'move'}
                  onChange={() => setExportMode('move')}
                />
                移動
                <span className="radio-description">元ファイルを整理</span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={convertToJpg}
                onChange={(e) => setConvertToJpg(e.target.checked)}
              />
              高画質JPGに変換して出力
            </label>
            {convertToJpg && (
              <div className="quality-slider">
                <label>品質: {jpgQuality}%</label>
                <input
                  type="range"
                  min="70"
                  max="100"
                  value={jpgQuality}
                  onChange={(e) => setJpgQuality(parseInt(e.target.value))}
                />
                <div className="quality-labels">
                  <span>小さめ</span>
                  <span>高画質</span>
                </div>
              </div>
            )}
          </div>

          <div className="form-section">
            <h3>リネーム設定</h3>
            <div className="form-group">
              <label>リネームモード</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="renameMode"
                    checked={renameMode === 'unified'}
                    onChange={() => setRenameMode('unified')}
                  />
                  一括設定
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="renameMode"
                    checked={renameMode === 'perChapter'}
                    onChange={() => setRenameMode('perChapter')}
                  />
                  チャプターごとに設定
                </label>
              </div>
            </div>

            {renameMode === 'unified' ? (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>開始番号</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={startNumberText}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setStartNumberText(val);
                        if (val !== '') {
                          setStartNumber(parseInt(val, 10));
                        }
                      }}
                      onBlur={() => {
                        if (startNumberText === '') {
                          setStartNumber(0);
                          setStartNumberText('0');
                        }
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>桁数</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={digitsText}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setDigitsText(val);
                        if (val !== '') {
                          setDigits(Math.min(8, Math.max(1, parseInt(val, 10))));
                        }
                      }}
                      onBlur={() => {
                        if (digitsText === '') {
                          setDigits(1);
                          setDigitsText('1');
                        } else {
                          const clamped = Math.min(8, Math.max(1, parseInt(digitsText, 10)));
                          setDigits(clamped);
                          setDigitsText(String(clamped));
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>プレフィックス（任意）</label>
                  <input
                    type="text"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="例: page_"
                  />
                </div>
                <div className="form-group">
                  <label>プレビュー</label>
                  <div className="filename-preview">
                    {previewName1}, {previewName2}, ...
                  </div>
                </div>
              </>
            ) : (
              <div className="per-chapter-settings">
                {chapters.map((chapter) => {
                  const settings = perChapterSettings[chapter.id] || { enabled: true, startNumber: 1, startNumberText: '1', digits: 4, digitsText: '4', prefix: '' };
                  const isEnabled = settings.enabled !== false;
                  const startNumberTextVal = settings.startNumberText ?? String(settings.startNumber);
                  const digitsTextVal = settings.digitsText ?? String(settings.digits);
                  const chPreview1 = `${chapter.name}/${settings.prefix}${String(settings.startNumber).padStart(settings.digits, '0')}.jpg`;
                  const chPreview2 = `${settings.prefix}${String(settings.startNumber + 1).padStart(settings.digits, '0')}.jpg`;
                  return (
                    <div key={chapter.id} className={`chapter-rename-settings ${!isEnabled ? 'disabled' : ''}`}>
                      <div className="chapter-rename-header">
                        <label className="chapter-enable-checkbox">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => updateChapterSetting(chapter.id, 'enabled', e.target.checked)}
                          />
                        </label>
                        <span
                          className="chapter-type-badge"
                          style={{ backgroundColor: CHAPTER_TYPE_COLORS[chapter.type] }}
                        >
                          {CHAPTER_TYPE_LABELS[chapter.type]}
                        </span>
                        <span className="chapter-rename-name">{chapter.name}</span>
                        <span className="chapter-rename-count">({chapter.pages.length}P)</span>
                      </div>
                      {isEnabled && (
                        <>
                          <div className="chapter-rename-inputs">
                            <div className="form-group-inline">
                              <label>開始</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={startNumberTextVal}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9]/g, '');
                                  updateChapterSetting(chapter.id, 'startNumberText', val);
                                  if (val !== '') {
                                    updateChapterSetting(chapter.id, 'startNumber', parseInt(val, 10));
                                  }
                                }}
                                onBlur={() => {
                                  if (startNumberTextVal === '') {
                                    updateChapterSetting(chapter.id, 'startNumber', 0);
                                    updateChapterSetting(chapter.id, 'startNumberText', '0');
                                  }
                                }}
                              />
                            </div>
                            <div className="form-group-inline">
                              <label>桁</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={digitsTextVal}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9]/g, '');
                                  updateChapterSetting(chapter.id, 'digitsText', val);
                                  if (val !== '') {
                                    updateChapterSetting(chapter.id, 'digits', Math.min(8, Math.max(1, parseInt(val, 10))));
                                  }
                                }}
                                onBlur={() => {
                                  if (digitsTextVal === '') {
                                    updateChapterSetting(chapter.id, 'digits', 1);
                                    updateChapterSetting(chapter.id, 'digitsText', '1');
                                  } else {
                                    const clamped = Math.min(8, Math.max(1, parseInt(digitsTextVal, 10)));
                                    updateChapterSetting(chapter.id, 'digits', clamped);
                                    updateChapterSetting(chapter.id, 'digitsText', String(clamped));
                                  }
                                }}
                              />
                            </div>
                            <div className="form-group-inline prefix-input">
                              <label>接頭</label>
                              <input
                                type="text"
                                value={settings.prefix}
                                onChange={(e) => updateChapterSetting(chapter.id, 'prefix', e.target.value)}
                                placeholder="prefix_"
                              />
                            </div>
                          </div>
                          <div className="chapter-rename-preview">
                            → {chPreview1}, {chPreview2}, ...
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="btn-primary"
            onClick={handleExport}
            disabled={!outputPath || isExporting}
          >
            {isExporting ? 'エクスポート中...' : 'エクスポート'}
          </button>
        </div>
      </div>
    </div>
  );
}

// メインApp
function App() {
  const {
    chapters,
    selectedChapterId,
    selectedPageId,
    selectedPageIds,
    viewMode,
    thumbnailSize,
    // プロジェクト状態
    currentProjectPath,
    projectName,
    isModified,
    // チャプター管理
    addChapter,
    removeChapter,
    renameChapter,
    toggleChapterCollapsed,
    reorderChapters,
    addPagesToChapter,
    addPagesToChapterAt,
    addSpecialPage,
    setPageFile,
    removePage,
    reorderPages,
    movePage,
    selectChapter,
    selectPage,
    togglePageSelection,
    selectPageRange,
    clearPageSelection,
    removeSelectedPages,
    setViewMode,
    setThumbnailSize,
    undo,
    redo,
    // プロジェクト管理
    markAsSaved,
    resetProject,
    loadProjectState,
  } = useStore();

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<'chapter' | 'page' | null>(null);
  const [previewMode, setPreviewMode] = useState<'grid' | 'spread'>('grid');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  // サイドバーD&D用のドロップターゲット
  const [dropTarget, setDropTarget] = useState<{
    type: 'page-before' | 'page-after' | 'chapter-before' | 'chapter-after' | 'chapter-end' | 'new-chapter-start' | 'new-chapter-end';
    chapterId: string;
    pageId?: string;
  } | null>(null);
  const [fileDropTargetPageId, setFileDropTargetPageId] = useState<string | null>(null);
  const [fileDropMode, setFileDropMode] = useState<'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null>(null);
  const [fileDropTargetChapterId, setFileDropTargetChapterId] = useState<string | null>(null);
  const [insertPosition, setInsertPosition] = useState<'before' | 'after' | null>(null);
  const [isNearPreviewTop, setIsNearPreviewTop] = useState(false);
  // プレビューエリアのチャプター折りたたみ状態（チャプターID -> 折りたたみ状態）
  const [previewCollapsedChapters, setPreviewCollapsedChapters] = useState<Set<string>>(new Set());

  // プレビューエリアのチャプター折りたたみをトグル
  const togglePreviewChapterCollapse = (chapterId: string) => {
    setPreviewCollapsedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  // プロジェクト関連のstate
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | 'close' | null>(null);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [missingFiles, setMissingFiles] = useState<FileValidationResult[]>([]);
  const [showMissingFilesDialog, setShowMissingFilesDialog] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  // chaptersからallPagesを計算（リアクティブに更新される）
  const allPages = useMemo(() => {
    const result: { page: Page; chapter: Chapter; globalIndex: number }[] = [];
    let globalIndex = 0;
    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        result.push({ page, chapter, globalIndex });
        globalIndex++;
      }
    }
    return result;
  }, [chapters]);

  // プロジェクトファイルへの変換
  const createProjectFile = async (savePath: string): Promise<DaidoriProjectFile> => {
    const basePath = savePath.replace(/[\\\/][^\\\/]+$/, '');
    const name = savePath.split(/[\\\/]/).pop()?.replace(/\.daidori$/, '') || '新規プロジェクト';

    const savedChapters: SavedChapter[] = chapters.map(ch => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      pages: ch.pages.map(page => {
        const savedPage: SavedPage = {
          id: page.id,
          pageType: page.pageType,
          label: page.label,
        };
        if (page.filePath) {
          // 相対パスを計算
          let relativePath = page.filePath;
          const normalizedBase = basePath.replace(/\\/g, '/');
          const normalizedFile = page.filePath.replace(/\\/g, '/');
          if (normalizedFile.startsWith(normalizedBase + '/')) {
            relativePath = normalizedFile.slice(normalizedBase.length + 1);
          }
          savedPage.file = {
            absolutePath: page.filePath,
            relativePath,
            fileName: page.fileName || '',
            fileType: page.fileType || 'unknown',
            fileSize: page.fileSize || 0,
            modifiedTime: page.modifiedTime || 0,
          };
        }
        return savedPage;
      }),
      folderPath: ch.folderPath,
    }));

    const collapsedChapterIds = chapters.filter(ch => ch.collapsed).map(ch => ch.id);

    return {
      version: '1.0',
      name,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      basePath,
      chapters: savedChapters,
      uiState: {
        selectedChapterId,
        selectedPageId,
        viewMode,
        thumbnailSize,
        collapsedChapterIds,
      },
    };
  };

  // プロジェクトファイルから状態への変換
  const loadFromProjectFile = (project: DaidoriProjectFile, _basePath: string): Chapter[] => {
    return project.chapters.map(ch => ({
      id: ch.id,
      name: ch.name,
      type: ch.type as ChapterType,
      collapsed: project.uiState?.collapsedChapterIds?.includes(ch.id) || false,
      folderPath: ch.folderPath,
      pages: ch.pages.map(page => {
        const p: Page = {
          id: page.id,
          pageType: page.pageType as PageType,
          label: page.label,
          thumbnailStatus: 'pending',
        };
        if (page.file) {
          p.filePath = page.file.absolutePath;
          p.fileName = page.file.fileName;
          p.fileType = page.file.fileType as Page['fileType'];
          p.fileSize = page.file.fileSize;
          p.modifiedTime = page.file.modifiedTime;
        }
        return p;
      }),
    }));
  };

  // プロジェクト保存
  const handleSaveProject = async (saveAs = false) => {
    try {
      let savePath = currentProjectPath;

      if (!savePath || saveAs) {
        const desktopPath = await desktopDir();
        const result = await save({
          defaultPath: await join(desktopPath, `${projectName}.daidori`),
          filters: [{ name: '台割プロジェクト', extensions: ['daidori'] }],
        });
        if (!result) return;
        savePath = result;
      }

      const projectFile = await createProjectFile(savePath);
      await invoke('save_project', { filePath: savePath, project: projectFile });
      await invoke('add_recent_file', { path: savePath, name: projectFile.name });
      markAsSaved(savePath);
      loadRecentFiles();
    } catch (error) {
      console.error('プロジェクト保存エラー:', error);
      alert(`保存に失敗しました: ${error}`);
    }
  };

  // プロジェクト読み込み
  const handleOpenProject = async (filePath?: string) => {
    try {
      let openPath = filePath;

      if (!openPath) {
        const result = await open({
          filters: [{ name: '台割プロジェクト', extensions: ['daidori'] }],
          multiple: false,
        });
        if (!result) return;
        openPath = result as string;
      }

      const project = await invoke<DaidoriProjectFile>('load_project', { filePath: openPath });
      const basePath = openPath.replace(/[\\\/][^\\\/]+$/, '');

      // ファイル検証
      const validationResults = await invoke<FileValidationResult[]>('validate_project_files', {
        project,
        basePath,
      });

      const missing = validationResults.filter(r => r.status === 'missing');
      if (missing.length > 0) {
        setMissingFiles(missing);
        setShowMissingFilesDialog(true);
      }

      // 状態を読み込み
      const loadedChapters = loadFromProjectFile(project, basePath);
      loadProjectState(loadedChapters, project.uiState ? {
        selectedChapterId: project.uiState.selectedChapterId ?? null,
        selectedPageId: project.uiState.selectedPageId ?? null,
        viewMode: (project.uiState.viewMode as 'selection' | 'all') ?? 'all',
        thumbnailSize: (project.uiState.thumbnailSize as ThumbnailSize) ?? 'medium',
        collapsedChapterIds: project.uiState.collapsedChapterIds ?? [],
      } : undefined);

      const name = openPath.split(/[\\\/]/).pop()?.replace(/\.daidori$/, '') || '新規プロジェクト';
      markAsSaved(openPath);
      await invoke('add_recent_file', { path: openPath, name });
      loadRecentFiles();
    } catch (error) {
      console.error('プロジェクト読み込みエラー:', error);
      alert(`読み込みに失敗しました: ${error}`);
    }
  };

  // 新規プロジェクト
  const handleNewProject = () => {
    if (isModified) {
      setPendingAction('new');
      setShowUnsavedDialog(true);
    } else {
      resetProject();
    }
  };

  // 最近使ったファイルの読み込み
  const loadRecentFiles = async () => {
    try {
      const files = await invoke<RecentFile[]>('get_recent_files');
      setRecentFiles(files);
    } catch (error) {
      console.error('最近使ったファイル読み込みエラー:', error);
    }
  };

  // 未保存確認後のアクション実行
  const handleUnsavedDialogAction = async (action: 'save' | 'discard' | 'cancel') => {
    setShowUnsavedDialog(false);
    if (action === 'cancel') {
      setPendingAction(null);
      setPendingOpenPath(null);
      return;
    }

    if (action === 'save') {
      await handleSaveProject();
    }

    if (pendingAction === 'new') {
      resetProject();
    } else if (pendingAction === 'open' && pendingOpenPath) {
      await handleOpenProject(pendingOpenPath);
    } else if (pendingAction === 'close') {
      await getCurrentWindow().close();
    }

    setPendingAction(null);
    setPendingOpenPath(null);
  };

  // 最近使ったファイルを開く
  const handleOpenRecentFile = (path: string) => {
    if (isModified) {
      setPendingAction('open');
      setPendingOpenPath(path);
      setShowUnsavedDialog(true);
    } else {
      handleOpenProject(path);
    }
    setIsProjectMenuOpen(false);
  };

  // 最近使ったファイルの初期読み込み
  useEffect(() => {
    loadRecentFiles();
  }, []);

  // ウィンドウ終了ハンドラ
  useEffect(() => {
    const setupCloseHandler = async () => {
      const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        if (isModified) {
          event.preventDefault();
          setPendingAction('close');
          setShowUnsavedDialog(true);
        }
      });
      return unlisten;
    };

    const unlistenPromise = setupCloseHandler();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [isModified]);

  // プロジェクトメニューの外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setIsProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // キーボードナビゲーション（削除・矢印移動・Undo/Redo）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 入力フィールドにフォーカスがある場合は無視
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Ctrl+N: 新規プロジェクト
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleNewProject();
        return;
      }

      // Ctrl+O: プロジェクトを開く
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        if (isModified) {
          setPendingAction('open');
          setShowUnsavedDialog(true);
        } else {
          handleOpenProject();
        }
        return;
      }

      // Ctrl+S: 保存 / Ctrl+Shift+S: 名前を付けて保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveProject(e.shiftKey);
        return;
      }

      // Ctrl+Z: 元に戻す
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Y または Ctrl+Shift+Z: やり直し
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      // 削除キー
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();

        // 複数ページが選択されている場合は一括削除
        if (selectedPageIds.length > 1) {
          removeSelectedPages();
        }
        // ページが選択されている場合はページを削除
        else if (selectedPageId) {
          const pageInfo = allPages.find((p) => p.page.id === selectedPageId);
          if (pageInfo) {
            removePage(pageInfo.chapter.id, selectedPageId);
          }
        }
        // チャプターが選択されている場合はチャプターを削除
        else if (selectedChapterId) {
          removeChapter(selectedChapterId);
        }
      }

      // 矢印キーでナビゲーション
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const isNext = e.key === 'ArrowDown' || e.key === 'ArrowRight';
        const isPrev = e.key === 'ArrowUp' || e.key === 'ArrowLeft';

        // ページが選択されている場合
        if (selectedPageId) {
          const currentIndex = allPages.findIndex((p) => p.page.id === selectedPageId);
          if (currentIndex !== -1) {
            let newIndex = currentIndex;
            if (isNext && currentIndex < allPages.length - 1) {
              newIndex = currentIndex + 1;
            } else if (isPrev && currentIndex > 0) {
              newIndex = currentIndex - 1;
            }
            if (newIndex !== currentIndex) {
              const newPage = allPages[newIndex];
              selectChapter(newPage.chapter.id);
              selectPage(newPage.page.id);
            }
          }
        }
        // チャプターのみ選択されている場合
        else if (selectedChapterId) {
          const currentIndex = chapters.findIndex((c) => c.id === selectedChapterId);
          if (currentIndex !== -1) {
            let newIndex = currentIndex;
            if (isNext && currentIndex < chapters.length - 1) {
              newIndex = currentIndex + 1;
            } else if (isPrev && currentIndex > 0) {
              newIndex = currentIndex - 1;
            }
            if (newIndex !== currentIndex) {
              selectChapter(chapters[newIndex].id);
              selectPage(null);
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedChapterId, selectedPageId, selectedPageIds, chapters, allPages, removePage, removeChapter, removeSelectedPages, selectChapter, selectPage, undo, redo]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleAddChapter = (type: ChapterType) => {
    addChapter(type);
  };

  const handleAddPages = async (chapterId: string) => {
    try {
      const selected = await open({
        title: 'ページを追加',
        multiple: true,
        directory: false,
        filters: [
          {
            name: '画像ファイル',
            extensions: ['jpg', 'jpeg', 'png', 'psd', 'tif', 'tiff'],
          },
        ],
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        const folderPath = selected[0].replace(/[^\\/]+$/, '');
        if (!folderPath) {
          console.error('Invalid folder path');
          return;
        }

        const files: FileInfo[] = await invoke('get_folder_contents', {
          folderPath,
        });

        const selectedFiles = files.filter((f) =>
          selected.some((s) => s === f.path)
        );

        if (selectedFiles.length > 0) {
          addPagesToChapter(chapterId, selectedFiles);
        }
      }
    } catch (error) {
      console.error('ページ追加エラー:', error);
    }
  };

  const handleAddFolder = async (chapterId: string) => {
    try {
      const selected = await open({
        title: 'フォルダを選択',
        directory: true,
      });

      if (selected && typeof selected === 'string' && selected.trim().length > 0) {
        const files: FileInfo[] = await invoke('get_folder_contents', {
          folderPath: selected,
        });

        if (files.length > 0) {
          addPagesToChapter(chapterId, files);
        }
      }
    } catch (error) {
      console.error('フォルダ追加エラー:', error);
    }
  };

  // 特殊ページ（表紙・奥付）にファイルを設定
  const handleSelectFile = async (pageId: string) => {
    try {
      const selected = await open({
        title: 'ファイルを選択',
        multiple: false,
        directory: false,
        filters: [
          {
            name: '画像ファイル',
            extensions: ['jpg', 'jpeg', 'png', 'psd', 'tif', 'tiff'],
          },
        ],
      });

      if (selected && typeof selected === 'string' && selected.trim().length > 0) {
        // ファイル情報を取得
        const folderPath = selected.replace(/[^\\/]+$/, '');
        if (!folderPath) {
          console.error('Invalid folder path');
          return;
        }

        const files: FileInfo[] = await invoke('get_folder_contents', {
          folderPath,
        });
        const fileInfo = files.find((f) => f.path === selected);
        if (fileInfo) {
          setPageFile(pageId, fileInfo);
        }
      }
    } catch (error) {
      console.error('ファイル選択エラー:', error);
    }
  };

  const handleExport = async (options: ExportOptions) => {
    const { outputPath, exportMode, convertToJpg, jpgQuality, renameMode, startNumber, digits, prefix, perChapterSettings } = options;

    // エクスポートページを生成
    let exportPages: { source_path: string | null; output_name: string; page_type: string; subfolder?: string }[] = [];

    if (renameMode === 'unified') {
      // 一括設定: 全ページを通し番号でリネーム
      exportPages = allPages.map((item, index) => ({
        source_path: item.page.filePath || null,
        output_name: `${prefix}${String(startNumber + index).padStart(digits, '0')}`,
        page_type: item.page.pageType,
      }));
    } else {
      // チャプターごとの設定: 各チャプター内で個別にリネーム、サブフォルダに出力
      for (const chapter of chapters) {
        const settings = perChapterSettings[chapter.id] || { enabled: true, startNumber: 1, digits: 4, prefix: '' };
        // 無効なチャプターはスキップ
        if (settings.enabled === false) continue;
        chapter.pages.forEach((page, pageIndex) => {
          exportPages.push({
            source_path: page.filePath || null,
            output_name: `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}`,
            page_type: page.pageType,
            subfolder: chapter.name, // チャプター名をサブフォルダとして使用
          });
        });
      }
    }

    try {
      const count = await invoke<number>('export_pages', {
        outputPath,
        pages: exportPages,
        moveFiles: exportMode === 'move',
        convertToJpg,
        jpgQuality,
      });

      // 統計情報
      const blankCount = allPages.filter((p) => p.page.pageType === 'blank').length;
      const skippedCount = exportPages.length - count;

      let message = `${count}ページをエクスポートしました`;
      if (blankCount > 0) {
        message += `（白紙${blankCount}件を自動生成）`;
      }
      if (skippedCount > 0) {
        message += `（${skippedCount}件スキップ）`;
      }
      alert(message);
    } catch (error) {
      alert(`エクスポートエラー: ${error}`);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);

    const isChapter = chapters.some((c) => c.id === active.id);
    setActiveDragType(isChapter ? 'chapter' : 'page');
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropTarget(null);
      return;
    }

    const overIdStr = String(over.id);

    // チャプタードラッグの場合
    if (activeDragType === 'chapter') {
      // 特殊ドロップゾーンのチェック
      if (overIdStr === CHAPTER_REORDER_DROP_ZONE_START_ID) {
        setDropTarget({ type: 'chapter-before', chapterId: chapters[0]?.id || '' });
        return;
      }
      if (overIdStr === CHAPTER_REORDER_DROP_ZONE_END_ID) {
        setDropTarget({ type: 'chapter-after', chapterId: chapters[chapters.length - 1]?.id || '' });
        return;
      }
      // チャプター上にホバー
      const isChapterId = chapters.some(c => c.id === overIdStr);
      if (isChapterId) {
        // マウス位置に基づいて挿入位置を決定
        const overRect = over.rect;
        const pointerY = (event.activatorEvent as PointerEvent)?.clientY ?? 0;
        const overCenterY = overRect.top + overRect.height / 2;
        const insertType = pointerY < overCenterY ? 'chapter-before' : 'chapter-after';
        setDropTarget({ type: insertType, chapterId: overIdStr });
      } else {
        setDropTarget(null);
      }
      return;
    }

    // ページドラッグの場合
    const activeIdStr = String(active.id);
    const isSidebarDrag = activeIdStr.startsWith(SIDEBAR_PREFIX);
    const isOverSidebar = overIdStr.startsWith(SIDEBAR_PREFIX);

    // 新規チャプターゾーンへのドロップ
    if (overIdStr === SIDEBAR_NEW_CHAPTER_DROP_ZONE_START_ID || overIdStr === NEW_CHAPTER_DROP_ZONE_START_ID) {
      setDropTarget({ type: 'new-chapter-start', chapterId: '' });
      return;
    }
    if (overIdStr === SIDEBAR_NEW_CHAPTER_DROP_ZONE_ID || overIdStr === NEW_CHAPTER_DROP_ZONE_ID) {
      setDropTarget({ type: 'new-chapter-end', chapterId: '' });
      return;
    }

    // サイドバーとプレビュー間のドラッグは無視
    if (isSidebarDrag !== isOverSidebar) {
      setDropTarget(null);
      return;
    }

    const actualActiveId = isSidebarDrag ? activeIdStr.replace(SIDEBAR_PREFIX, '') : activeIdStr;
    const actualOverId = isOverSidebar ? overIdStr.replace(SIDEBAR_PREFIX, '') : overIdStr;

    const activePage = allPages.find((p) => p.page.id === actualActiveId);
    const overPage = allPages.find((p) => p.page.id === actualOverId);

    if (activePage && overPage) {
      // マウス位置に基づいて挿入位置を決定（アイテムの中央より上なら前、下なら後）
      const overRect = over.rect;
      const pointerY = (event.activatorEvent as PointerEvent)?.clientY ?? 0;

      // over要素の中央位置
      const overCenterY = overRect.top + overRect.height / 2;

      // マウスが中央より上なら「前」、下なら「後」に挿入
      const insertType = pointerY < overCenterY ? 'page-before' : 'page-after';
      setDropTarget({ type: insertType, chapterId: overPage.chapter.id, pageId: actualOverId });
    } else {
      setDropTarget(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active } = event;

    // dropTargetがない場合は何もしない
    if (!dropTarget) {
      setActiveId(null);
      setActiveDragType(null);
      setDropTarget(null);
      return;
    }

    // チャプターの並べ替え
    if (activeDragType === 'chapter') {
      const oldIndex = chapters.findIndex((c) => c.id === active.id);
      if (oldIndex === -1) {
        setActiveId(null);
        setActiveDragType(null);
        setDropTarget(null);
        return;
      }

      if (dropTarget.type === 'chapter-before' || dropTarget.type === 'chapter-after') {
        const targetIndex = chapters.findIndex((c) => c.id === dropTarget.chapterId);
        if (targetIndex !== -1 && oldIndex !== targetIndex) {
          const newIndex = dropTarget.type === 'chapter-after' ? targetIndex + 1 : targetIndex;
          // 自分より後ろに移動する場合は、自分が抜けた分を考慮
          const adjustedIndex = newIndex > oldIndex ? newIndex - 1 : newIndex;
          reorderChapters(oldIndex, adjustedIndex);
        }
      }

      setActiveId(null);
      setActiveDragType(null);
      setDropTarget(null);
      return;
    }

    // ページのドラッグ処理
    if (activeDragType === 'page') {
      const activeIdStr = String(active.id);
      const isSidebarDrag = activeIdStr.startsWith(SIDEBAR_PREFIX);
      const actualActiveId = isSidebarDrag ? activeIdStr.replace(SIDEBAR_PREFIX, '') : activeIdStr;
      const activePage = allPages.find((p) => p.page.id === actualActiveId);

      if (!activePage) {
        setActiveId(null);
        setActiveDragType(null);
        setDropTarget(null);
        return;
      }

      // 新規チャプターへのドロップ
      if (dropTarget.type === 'new-chapter-start' || dropTarget.type === 'new-chapter-end') {
        const page = activePage.page;
        const fromChapterId = activePage.chapter.id;

        const chapterType: ChapterType = page.pageType !== 'file'
          ? (page.pageType as ChapterType)
          : 'chapter';

        const insertAt = dropTarget.type === 'new-chapter-start' ? 0 : undefined;
        const newChapterId = addChapter(chapterType, undefined, true, insertAt);
        movePage(fromChapterId, newChapterId, actualActiveId, 0);
        selectChapter(newChapterId);

        setActiveId(null);
        setActiveDragType(null);
        setDropTarget(null);
        return;
      }

      // 通常のページ移動（page-before / page-after）
      if ((dropTarget.type === 'page-before' || dropTarget.type === 'page-after') && dropTarget.pageId) {
        const fromChapterId = activePage.chapter.id;
        const toChapterId = dropTarget.chapterId;
        const targetChapter = chapters.find(c => c.id === toChapterId);

        if (targetChapter) {
          const targetPageIndex = targetChapter.pages.findIndex(p => p.id === dropTarget.pageId);

          if (fromChapterId === toChapterId) {
            // 同じチャプター内での並べ替え
            const sourceIndex = targetChapter.pages.findIndex(p => p.id === actualActiveId);
            if (sourceIndex !== -1 && targetPageIndex !== -1 && sourceIndex !== targetPageIndex) {
              let newIndex = dropTarget.type === 'page-after' ? targetPageIndex + 1 : targetPageIndex;
              // 自分より後ろに移動する場合は、自分が抜けた分を考慮
              if (newIndex > sourceIndex) newIndex -= 1;
              reorderPages(toChapterId, sourceIndex, newIndex);
            }
          } else {
            // 異なるチャプター間の移動
            const newIndex = dropTarget.type === 'page-after' ? targetPageIndex + 1 : targetPageIndex;
            movePage(fromChapterId, toChapterId, actualActiveId, newIndex);
          }
        }
      }

      // チャプター末尾へのドロップ
      if (dropTarget.type === 'chapter-end') {
        const fromChapterId = activePage.chapter.id;
        const toChapterId = dropTarget.chapterId;
        if (fromChapterId !== toChapterId) {
          const targetChapter = chapters.find(c => c.id === toChapterId);
          if (targetChapter) {
            movePage(fromChapterId, toChapterId, actualActiveId, targetChapter.pages.length);
          }
        }
      }
    }

    setActiveId(null);
    setActiveDragType(null);
    setDropTarget(null);
  };

  const displayPages =
    viewMode === 'all'
      ? allPages
      : allPages.filter((p) => p.chapter.id === selectedChapterId);

  // サイドバーのIDからプレフィックスを取り除いてページデータを検索
  const isSidebarDragging = activeId?.startsWith(SIDEBAR_PREFIX) ?? false;
  const actualActiveId = isSidebarDragging
    ? activeId?.replace(SIDEBAR_PREFIX, '') ?? ''
    : activeId;
  const activePageData = actualActiveId
    ? allPages.find((p) => p.page.id === actualActiveId)
    : null;

  // サイドバーでドラッグ中のページIDをハイライト用に保持
  const highlightedPageId = isSidebarDragging ? actualActiveId : null;

  // プレビューエリアの参照
  const previewAreaRef = useRef<HTMLDivElement>(null);

  // サイドバーでドラッグ開始時にプレビューエリア内の該当アイテムにスクロール
  useEffect(() => {
    if (highlightedPageId && previewAreaRef.current) {
      const element = previewAreaRef.current.querySelector(
        `[data-page-id="${highlightedPageId}"]`
      );
      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center',
        });
      }
    }
  }, [highlightedPageId]);

  // プレビューエリア上部付近かどうかを追跡（「先頭にチャプターを追加」の表示制御用）
  useEffect(() => {
    if (activeDragType !== 'page' || isDraggingFiles) {
      setIsNearPreviewTop(false);
      return;
    }
    const handlePointerMove = (e: PointerEvent) => {
      const previewArea = previewAreaRef.current;
      if (!previewArea) return;
      const rect = previewArea.getBoundingClientRect();
      setIsNearPreviewTop(e.clientY <= rect.top + 100);
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [activeDragType, isDraggingFiles]);

  const thumbnailSizeValue = THUMBNAIL_SIZES[thumbnailSize].value;

  // windowオブジェクトにセッターを登録
  window.__setIsDraggingFiles = setIsDraggingFiles;
  window.__setFileDropTargetPageId = setFileDropTargetPageId;
  window.__setFileDropMode = setFileDropMode;
  window.__setFileDropTargetChapterId = setFileDropTargetChapterId;
  window.__setInsertPosition = setInsertPosition;

  // 自動スクロール関数（ドラッグ中にエッジ付近で自動スクロール）
  window.__autoScrollPreview = (_x: number, y: number) => {
    const previewArea = previewAreaRef.current;
    if (!previewArea) return;

    // Tauriのドラッグイベントは物理ピクセル座標を返すため、CSSピクセルに変換
    const dpr = window.devicePixelRatio || 1;
    const cssY = y / dpr;

    const rect = previewArea.getBoundingClientRect();
    const scrollSpeed = 20;
    const edgeThreshold = 100; // エッジからの距離（px）

    // 上端付近
    if (cssY < rect.top + edgeThreshold && cssY > rect.top - 50) {
      previewArea.scrollTop -= scrollSpeed;
    }
    // 下端付近（エリア外に出ても少し余裕を持たせる）
    else if (cssY > rect.bottom - edgeThreshold) {
      // スクロール可能な残り量を確認
      const maxScroll = previewArea.scrollHeight - previewArea.clientHeight;
      if (previewArea.scrollTop < maxScroll) {
        previewArea.scrollTop += scrollSpeed;
      }
    }
  };

  // マウス位置からドロップ情報を取得するヘルパー（改善版：挿入点ベース）
  window.__getDropInfoFromPosition = (x: number, y: number) => {
    // Tauriのドラッグイベントは物理ピクセル座標を返すため、CSSピクセルに変換
    const dpr = window.devicePixelRatio || 1;
    const cssX = x / dpr;
    const cssY = y / dpr;

    // 以降はCSSピクセル座標を使用
    x = cssX;
    y = cssY;

    // 新規チャプターゾーン（先頭）を境界ボックスベースで検出（優先度高）
    const newChapterZoneStart = document.querySelector('.new-chapter-drop-zone.start');
    if (newChapterZoneStart) {
      const rect = newChapterZoneStart.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { pageId: null, chapterId: null, mode: 'new-chapter-start' as const, insertPosition: null };
      }
    }

    // 新規チャプターゾーン（末尾）を境界ボックスベースで検出
    const newChapterZoneEnd = document.querySelector('.new-chapter-drop-zone.end');
    if (newChapterZoneEnd) {
      const rect = newChapterZoneEnd.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { pageId: null, chapterId: null, mode: 'new-chapter' as const, insertPosition: null };
      }
    }

    // elementFromPoint で直接ヒットする要素を確認
    const element = document.elementFromPoint(x, y);

    // チャプターセパレーターの上 → そのチャプターの末尾に追加
    if (element) {
      const chapterSeparator = element.closest('.chapter-separator');
      if (chapterSeparator) {
        const chapterGroup = chapterSeparator.closest('.chapter-group');
        if (chapterGroup) {
          const chapterId = chapterGroup.getAttribute('data-chapter-id');
          return { pageId: null, chapterId, mode: 'append-chapter' as const, insertPosition: null };
        }
      }
    }

    // サムネイルカードの検出（挿入点ベースの改善版）
    const thumbnailCards = document.querySelectorAll('.thumbnail-card');

    // 挿入点の型定義
    interface InsertPoint {
      x: number;
      y: number;
      card: Element;
      position: 'before' | 'after';
    }

    // カードを行ごとにグループ化
    const cardData = Array.from(thumbnailCards).map(card => {
      const rect = card.getBoundingClientRect();
      return { card, rect };
    });

    // Y座標でグループ化（同一行のカードをまとめる）
    const rows = new Map<number, typeof cardData>();
    cardData.forEach(item => {
      const rowKey = Math.round(item.rect.top / 20) * 20;
      if (!rows.has(rowKey)) rows.set(rowKey, []);
      const rowItems = rows.get(rowKey);
      if (rowItems) rowItems.push(item);
    });

    // 挿入点を収集
    const insertPoints: InsertPoint[] = [];

    rows.forEach(rowCards => {
      // X座標でソート
      rowCards.sort((a, b) => a.rect.left - b.rect.left);

      rowCards.forEach((item, i) => {
        const centerY = item.rect.top + item.rect.height / 2;

        // 行の最初のカードの左側
        if (i === 0) {
          insertPoints.push({
            x: item.rect.left,
            y: centerY,
            card: item.card,
            position: 'before'
          });
        }

        // カード間の挿入点（ギャップ中央）
        if (i < rowCards.length - 1) {
          const nextItem = rowCards[i + 1];
          const gapCenter = (item.rect.right + nextItem.rect.left) / 2;
          insertPoints.push({
            x: gapCenter,
            y: centerY,
            card: item.card,
            position: 'after'
          });
        } else {
          // 行の最後のカードの右側
          insertPoints.push({
            x: item.rect.right,
            y: centerY,
            card: item.card,
            position: 'after'
          });
        }
      });
    });

    // 最も近い挿入点を見つける
    let closestPoint: InsertPoint | null = null;
    let closestDistance = Infinity;
    const Y_TOLERANCE = 80; // カード高さの半分程度
    const MAX_DISTANCE = 60; // 最大反応距離

    insertPoints.forEach(point => {
      const dy = Math.abs(y - point.y);
      if (dy > Y_TOLERANCE) return;

      const dx = Math.abs(x - point.x);
      const distance = dx + dy * 0.3;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPoint = point;
      }
    });

    if (closestPoint && closestDistance < MAX_DISTANCE) {
      const foundPoint = closestPoint as InsertPoint;
      const pageId = foundPoint.card.getAttribute('data-page-id');
      return {
        pageId,
        chapterId: null,
        mode: 'insert' as const,
        insertPosition: foundPoint.position
      };
    }

    // プレビューエリア内だが何もない場所 → 選択中チャプターに追加（なければ新規作成）
    if (element) {
      const previewArea = element.closest('.preview-area');
      if (previewArea) {
        return { pageId: null, chapterId: null, mode: null, insertPosition: null };
      }
    }

    return { pageId: null, chapterId: null, mode: null, insertPosition: null };
  };

  // グローバルドロップハンドラーを更新（最新のstateを参照するため）
  window.__dropHandler = async (paths: string[], targetPageId: string | null, mode: string | null, targetChapterId: string | null, insertPos: 'before' | 'after' | null) => {
    // 同期的なロックチェック（最優先）
    if (window.__isProcessingDrop) {
      console.log('Drop already processing (sync lock), skipping...');
      return;
    }

    // 500ms以内の連続ドロップは無視
    const now = Date.now();
    const lastDropTime = window.__lastDropTime || 0;
    if (now - lastDropTime < 500) {
      console.log('Drop too soon after previous, skipping...', now - lastDropTime, 'ms');
      return;
    }

    if (paths.length === 0) return;

    // ロックを取得
    window.__isProcessingDrop = true;
    window.__lastDropTime = now;
    console.log('Processing drop at', now, 'mode:', mode, 'targetPageId:', targetPageId, 'targetChapterId:', targetChapterId, 'insertPos:', insertPos);

    try {
      // 画像ファイルのみをフィルタリング
      const imageExtensions = ['jpg', 'jpeg', 'png', 'psd', 'tif', 'tiff'];
      const imagePaths = paths.filter(path => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext && imageExtensions.includes(ext);
      });

      if (imagePaths.length === 0) {
        window.__isProcessingDrop = false;
        return;
      }

      // ファイル情報を取得
      const folderPath = imagePaths[0].replace(/[^\\/]+$/, '');
      const files: FileInfo[] = await invoke('get_folder_contents', {
        folderPath,
      });

      const droppedFiles = files.filter((f) =>
        imagePaths.some((p) => p === f.path)
      );

      if (droppedFiles.length === 0) {
        window.__isProcessingDrop = false;
        return;
      }

      // 最新の状態を取得（ハンドラー定義時の古い値ではなく）
      const currentState = useStore.getState();
      const currentChapters = currentState.chapters;
      const currentSelectedChapterId = currentState.selectedChapterId;

      // モードに応じて処理
      if (mode === 'new-chapter-start') {
        // 先頭に新しいチャプターを作成してそこに追加
        const newChapterId = addChapter('chapter', undefined, false, 0);
        selectChapter(newChapterId);
        addPagesToChapter(newChapterId, droppedFiles);
      } else if (mode === 'new-chapter') {
        // 末尾に新しいチャプターを作成してそこに追加
        const newChapterId = addChapter('chapter');
        selectChapter(newChapterId);
        addPagesToChapter(newChapterId, droppedFiles);
      } else if (mode === 'append-chapter' && targetChapterId) {
        // 指定チャプターの末尾に追加
        addPagesToChapter(targetChapterId, droppedFiles);
        selectChapter(targetChapterId);
      } else if (mode === 'insert' && targetPageId) {
        // ターゲットページの前または後に挿入
        for (const chapter of currentChapters) {
          const pageIndex = chapter.pages.findIndex(p => p.id === targetPageId);
          if (pageIndex !== -1) {
            // insertPos が 'after' なら pageIndex + 1、それ以外は pageIndex
            const insertIndex = insertPos === 'after' ? pageIndex + 1 : pageIndex;
            addPagesToChapterAt(chapter.id, droppedFiles, insertIndex);
            selectChapter(chapter.id);
            break;
          }
        }
      } else {
        // デフォルト：選択中のチャプターに追加、なければ新規作成
        let chapterId = currentSelectedChapterId;
        if (!chapterId) {
          chapterId = addChapter('chapter');
          selectChapter(chapterId);
        }
        addPagesToChapter(chapterId, droppedFiles);
      }
    } catch (error) {
      console.error('Drop handler error:', error);
    } finally {
      // ロックを解放（少し遅延させて連続ドロップを確実に防止）
      setTimeout(() => {
        window.__isProcessingDrop = false;
        console.log('Drop lock released');
      }, 300);
    }
  };

  // Tauri ファイルドロップイベントリスナー（windowオブジェクトで一度だけ登録）
  useEffect(() => {
    // windowオブジェクトでチェック（HMRでも永続化される）
    if (window.__dropListenersSetup) {
      console.log('Window listeners already setup, skipping...');
      return;
    }
    window.__dropListenersSetup = true;

    const setupListeners = async () => {
      // ドロップイベント (Tauri v2)
      await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', (event) => {
        console.log('Drop event received:', event.payload);

        // ドロップ時の位置から直接ドロップ情報を取得（より正確）
        const { x, y } = event.payload.position;
        const dropInfo = window.__getDropInfoFromPosition?.(x, y) || { pageId: null, chapterId: null, mode: null, insertPosition: null };

        console.log('Drop info at position:', x, y, dropInfo);

        const targetPageId = dropInfo.pageId;
        const mode = dropInfo.mode;
        const targetChapterId = dropInfo.chapterId;
        const insertPos = dropInfo.insertPosition;

        // UIをリセット
        window.__setIsDraggingFiles?.(false);
        window.__setFileDropTargetPageId?.(null);
        window.__setFileDropMode?.(null);
        window.__setFileDropTargetChapterId?.(null);
        window.__setInsertPosition?.(null);
        window.__fileDropTargetPageId = null;
        window.__fileDropMode = null;
        window.__fileDropTargetChapterId = null;
        window.__insertPosition = null;

        window.__dropHandler?.(event.payload.paths, targetPageId, mode, targetChapterId, insertPos);
      });

      // ドラッグ開始イベント
      await listen('tauri://drag-enter', () => {
        window.__setIsDraggingFiles?.(true);
      });

      // ドラッグ終了イベント
      await listen('tauri://drag-leave', () => {
        window.__setIsDraggingFiles?.(false);
        window.__setFileDropTargetPageId?.(null);
        window.__setFileDropMode?.(null);
        window.__setFileDropTargetChapterId?.(null);
        window.__setInsertPosition?.(null);
        window.__fileDropTargetPageId = null;
        window.__fileDropMode = null;
        window.__fileDropTargetChapterId = null;
        window.__insertPosition = null;
      });

      // ドラッグオーバーイベント（位置追跡用 + 自動スクロール）
      await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-over', (event) => {
        const { x, y } = event.payload.position;

        // 自動スクロール（エッジ付近でスクロール）
        window.__autoScrollPreview?.(x, y);

        const dropInfo = window.__getDropInfoFromPosition?.(x, y) || { pageId: null, chapterId: null, mode: null, insertPosition: null };

        window.__fileDropTargetPageId = dropInfo.pageId;
        window.__fileDropMode = dropInfo.mode;
        window.__fileDropTargetChapterId = dropInfo.chapterId;
        window.__insertPosition = dropInfo.insertPosition;

        window.__setFileDropTargetPageId?.(dropInfo.pageId);
        window.__setFileDropMode?.(dropInfo.mode);
        window.__setFileDropTargetChapterId?.(dropInfo.chapterId);
        window.__setInsertPosition?.(dropInfo.insertPosition);
      });

      console.log('Window drop listeners setup complete');
    };

    setupListeners();

    // クリーンアップは不要（アプリ全体で一度だけ登録）
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="project-menu-container" ref={projectMenuRef}>
              <button
                className="project-menu-trigger"
                onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
              >
                <span className="project-name-display">
                  {isModified && <span className="modified-indicator">●</span>}
                  {projectName}
                </span>
                <svg className="project-menu-chevron" width="12" height="12" viewBox="0 0 12 12">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                </svg>
              </button>

              {isProjectMenuOpen && (
                <div className="project-menu-dropdown">
                  <button onClick={() => { handleNewProject(); setIsProjectMenuOpen(false); }}>
                    <span>新規プロジェクト</span>
                    <kbd>Ctrl+N</kbd>
                  </button>
                  <button onClick={() => {
                    if (isModified) {
                      setPendingAction('open');
                      setShowUnsavedDialog(true);
                    } else {
                      handleOpenProject();
                    }
                    setIsProjectMenuOpen(false);
                  }}>
                    <span>開く...</span>
                    <kbd>Ctrl+O</kbd>
                  </button>
                  {recentFiles.length > 0 && (
                    <div className="project-menu-submenu">
                      <button className="submenu-trigger">
                        <span>最近使ったファイル</span>
                        <svg width="12" height="12" viewBox="0 0 12 12">
                          <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                        </svg>
                      </button>
                      <div className="submenu-content">
                        {recentFiles.map(file => (
                          <button key={file.path} onClick={() => handleOpenRecentFile(file.path)}>
                            {file.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="project-menu-divider" />
                  <button onClick={() => { handleSaveProject(); setIsProjectMenuOpen(false); }}>
                    <span>保存</span>
                    <kbd>Ctrl+S</kbd>
                  </button>
                  <button onClick={() => { handleSaveProject(true); setIsProjectMenuOpen(false); }}>
                    <span>名前を付けて保存...</span>
                    <kbd>Ctrl+Shift+S</kbd>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="sidebar-content">
            <div className="chapter-actions-bar">
              <button
                className="btn-secondary btn-small"
                onClick={() => handleAddChapter('chapter')}
              >
                +話
              </button>
              <button
                className="btn-secondary btn-small"
                onClick={() => handleAddChapter('cover')}
              >
                +表紙
              </button>
              <button
                className="btn-secondary btn-small"
                onClick={() => handleAddChapter('blank')}
              >
                +白紙
              </button>
              <button
                className="btn-secondary btn-small"
                onClick={() => handleAddChapter('intermission')}
              >
                +幕間
              </button>
              <button
                className="btn-secondary btn-small"
                onClick={() => handleAddChapter('colophon')}
              >
                +奥付
              </button>
            </div>

            <div className="chapter-list">
              {/* サイドバー用の新規チャプター作成ゾーン（先頭） */}
              <SidebarNewChapterDropZone isDragging={activeDragType === 'page'} position="start" />
              {/* サイドバー用のチャプター並べ替えゾーン（先頭） */}
              <SidebarChapterReorderDropZone isDragging={activeDragType === 'chapter'} position="start" />
              <SortableContext
                items={chapters.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {chapters.map((chapter) => (
                  <ChapterItem
                    key={chapter.id}
                    chapter={chapter}
                    isSelected={chapter.id === selectedChapterId}
                    selectedPageId={selectedPageId}
                    onSelect={() => {
                      selectChapter(chapter.id);
                      selectPage(null);
                    }}
                    onSelectPage={(pageId) => {
                      selectChapter(chapter.id);
                      selectPage(pageId);
                    }}
                    onToggle={() => toggleChapterCollapsed(chapter.id)}
                    onRename={(name) => renameChapter(chapter.id, name)}
                    onDelete={() => removeChapter(chapter.id)}
                    onAddFiles={() => handleAddPages(chapter.id)}
                    onAddFolder={() => handleAddFolder(chapter.id)}
                    onAddSpecialPage={(pageType, afterPageId) => addSpecialPage(chapter.id, pageType, afterPageId)}
                    onSelectFile={handleSelectFile}
                    dropTarget={dropTarget}
                  />
                ))}
              </SortableContext>
              {/* サイドバー用のチャプター並べ替えゾーン（末尾） */}
              <SidebarChapterReorderDropZone isDragging={activeDragType === 'chapter'} position="end" />
              {/* サイドバー用の新規チャプター作成ゾーン（末尾） */}
              <SidebarNewChapterDropZone isDragging={activeDragType === 'page'} position="end" />
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="footer-stats">
              <span className="stats-label">合計</span>
              <span className="stats-value">{allPages.length}</span>
              <span className="stats-unit">ページ</span>
            </div>
          </div>
        </aside>

        <main className="main-area">
          <div className="toolbar">
            {selectedPageIds.length > 1 ? (
              <div className="selection-bar">
                <span className="selection-count">{selectedPageIds.length}件選択中</span>
                <button
                  className="btn-secondary btn-small"
                  onClick={clearPageSelection}
                >
                  選択解除
                </button>
                <button
                  className="btn-primary btn-small btn-danger"
                  onClick={removeSelectedPages}
                >
                  削除
                </button>
              </div>
            ) : (
              <div className="view-mode-toggle">
                <button
                  className={`view-mode-btn ${viewMode === 'all' ? 'active' : ''}`}
                  onClick={() => setViewMode('all')}
                >
                  全体
                </button>
                <button
                  className={`view-mode-btn ${viewMode === 'selection' ? 'active' : ''}`}
                  onClick={() => setViewMode('selection')}
                  disabled={!selectedChapterId}
                >
                  選択中
                </button>
              </div>
            )}

            <div className="preview-mode-toggle">
              <button
                className={`view-mode-btn ${previewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setPreviewMode('grid')}
                title="グリッド表示"
              >
                ⊞ グリッド
              </button>
              <button
                className={`view-mode-btn ${previewMode === 'spread' ? 'active' : ''}`}
                onClick={() => setPreviewMode('spread')}
                title="見開き表示"
              >
                📖 見開き
              </button>
            </div>

            {previewMode === 'grid' && (
              <div className="thumbnail-size-selector">
                {(Object.keys(THUMBNAIL_SIZES) as ThumbnailSize[]).map((size) => (
                  <button
                    key={size}
                    className={`size-btn ${thumbnailSize === size ? 'active' : ''}`}
                    onClick={() => setThumbnailSize(size)}
                  >
                    {THUMBNAIL_SIZES[size].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="preview-area" ref={previewAreaRef}>
            {displayPages.length === 0 ? (
              <div className="empty-state">
                <p>ページがありません</p>
                <p>左のパネルからチャプターを追加し、ページを読み込んでください</p>
              </div>
            ) : previewMode === 'spread' ? (
              <SpreadViewer
                key={displayPages.map(p => p.page.id).join(',')}
                pages={displayPages}
                onPageSelect={(chapterId, pageId) => {
                  selectChapter(chapterId);
                  selectPage(pageId);
                }}
              />
            ) : (
              <div className="thumbnail-grid-container">
                <SortableContext
                  items={displayPages.map((p) => p.page.id)}
                  strategy={rectSortingStrategy}
                >
                  {viewMode === 'all' ? (
                    // 全体表示：連続横並び
                    <>
                      {/* 新規チャプター作成ゾーン（先頭・外部ファイルドラッグ時） */}
                      {isDraggingFiles && (
                        <div className={`new-chapter-drop-zone start ${fileDropMode === 'new-chapter-start' ? 'active' : ''}`}>
                          <div className="new-chapter-drop-content">
                            <span className="new-chapter-icon">➕</span>
                            <span className="new-chapter-text">先頭に新しいチャプターを作成</span>
                          </div>
                        </div>
                      )}
                      {/* 新規チャプター作成ゾーン（先頭・内部ドラッグ時・上部付近のみ表示） */}
                      <NewChapterDropZone
                        isActive={false}
                        isDragging={activeDragType === 'page' && !isDraggingFiles && isNearPreviewTop}
                        position="start"
                      />
                      <div className="thumbnail-grid-continuous">
                        {(() => {
                          // チャプターごとにグループ化
                          const chapterGroups: { chapter: Chapter; pages: typeof displayPages }[] = [];
                          displayPages.forEach((item) => {
                            const lastGroup = chapterGroups[chapterGroups.length - 1];
                            if (lastGroup && lastGroup.chapter.id === item.chapter.id) {
                              lastGroup.pages.push(item);
                            } else {
                              chapterGroups.push({ chapter: item.chapter, pages: [item] });
                            }
                          });

                          return (
                            <>
                              {/* チャプターブロック（横並び、展開時は幅が広がる） */}
                              <div className="chapter-blocks-row">
                                {chapterGroups.map((group) => {
                                  const isCollapsed = previewCollapsedChapters.has(group.chapter.id);
                                  const isExpanded = !isCollapsed && group.pages.length > 1;
                                  const firstPage = group.pages[0];

                                  return (
                                    <div
                                      key={group.chapter.id}
                                      className={`chapter-block ${isCollapsed ? 'collapsed' : ''} ${isExpanded ? 'expanded' : ''} ${fileDropMode === 'append-chapter' && fileDropTargetChapterId === group.chapter.id ? 'drop-target' : ''}`}
                                      data-chapter-id={group.chapter.id}
                                      style={{
                                        backgroundColor: group.chapter.type !== 'chapter' ? `${CHAPTER_TYPE_COLORS[group.chapter.type]}12` : undefined,
                                        borderColor: group.chapter.type !== 'chapter' ? `${CHAPTER_TYPE_COLORS[group.chapter.type]}40` : undefined,
                                      }}
                                    >
                                      {/* チャプターヘッダー */}
                                      <div
                                        className="chapter-block-header"
                                        onClick={() => group.pages.length > 1 && togglePreviewChapterCollapse(group.chapter.id)}
                                        style={{ cursor: group.pages.length > 1 ? 'pointer' : 'default' }}
                                      >
                                        {group.pages.length > 1 && (
                                          <span className="chapter-block-collapse-btn">
                                            {isCollapsed ? '▶' : '▼'}
                                          </span>
                                        )}
                                        <span
                                          className="chapter-block-badge"
                                          style={{ backgroundColor: CHAPTER_TYPE_COLORS[group.chapter.type] }}
                                        >
                                          {CHAPTER_TYPE_LABELS[group.chapter.type]}
                                        </span>
                                        <span className="chapter-block-name">{group.chapter.name}</span>
                                        <span className="chapter-block-count">{group.pages.length}P</span>
                                      </div>
                                      {/* ページ表示（折りたたみ時は先頭のみ、展開時は全て） */}
                                      <div className="chapter-block-pages">
                                        {isExpanded ? (
                                          // 展開時：全ページを表示
                                          group.pages.map((item) => (
                                            <div key={item.page.id} className="thumbnail-wrapper-with-indicator">
                                              {dropTarget?.pageId === item.page.id && activeId && (dropTarget?.type === 'page-before' || dropTarget?.type === 'page-after') && (
                                                <div className={`drop-indicator ${dropTarget?.type === 'page-after' ? 'right' : 'left'}`} />
                                              )}
                                              {fileDropTargetPageId === item.page.id && isDraggingFiles && (
                                                <div className={`drop-indicator file-drop ${insertPosition === 'after' ? 'right' : 'left'}`} />
                                              )}
                                              <ThumbnailCard
                                                page={item.page}
                                                globalIndex={item.globalIndex}
                                                thumbnailSize={thumbnailSizeValue}
                                                isHighlighted={item.page.id === highlightedPageId}
                                                isSelected={item.page.id === selectedPageId}
                                                isMultiSelected={selectedPageIds.includes(item.page.id)}
                                                onSelect={() => {
                                                  selectChapter(item.chapter.id);
                                                  selectPage(item.page.id);
                                                }}
                                                onCtrlClick={() => {
                                                  selectChapter(item.chapter.id);
                                                  togglePageSelection(item.page.id);
                                                }}
                                                onShiftClick={() => {
                                                  if (selectedPageId) {
                                                    selectPageRange(selectedPageId, item.page.id);
                                                  } else {
                                                    selectPage(item.page.id);
                                                  }
                                                }}
                                              />
                                            </div>
                                          ))
                                        ) : (
                                          // 折りたたみ時または1ページのみ：先頭ページのみ表示
                                          <>
                                            <div className="thumbnail-wrapper-with-indicator">
                                              {dropTarget?.pageId === firstPage.page.id && activeId && (dropTarget?.type === 'page-before' || dropTarget?.type === 'page-after') && (
                                                <div className={`drop-indicator ${dropTarget?.type === 'page-after' ? 'right' : 'left'}`} />
                                              )}
                                              {fileDropTargetPageId === firstPage.page.id && isDraggingFiles && (
                                                <div className={`drop-indicator file-drop ${insertPosition === 'after' ? 'right' : 'left'}`} />
                                              )}
                                              <ThumbnailCard
                                                page={firstPage.page}
                                                globalIndex={firstPage.globalIndex}
                                                thumbnailSize={thumbnailSizeValue}
                                                isHighlighted={firstPage.page.id === highlightedPageId}
                                                isSelected={firstPage.page.id === selectedPageId}
                                                isMultiSelected={selectedPageIds.includes(firstPage.page.id)}
                                                onSelect={() => {
                                                  selectChapter(firstPage.chapter.id);
                                                  selectPage(firstPage.page.id);
                                                }}
                                                onCtrlClick={() => {
                                                  selectChapter(firstPage.chapter.id);
                                                  togglePageSelection(firstPage.page.id);
                                                }}
                                                onShiftClick={() => {
                                                  if (selectedPageId) {
                                                    selectPageRange(selectedPageId, firstPage.page.id);
                                                  } else {
                                                    selectPage(firstPage.page.id);
                                                  }
                                                }}
                                              />
                                            </div>
                                            {/* 折りたたみ時に残りページ数を表示 */}
                                            {isCollapsed && group.pages.length > 1 && (
                                              <div
                                                className="chapter-block-hidden-indicator"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  togglePreviewChapterCollapse(group.chapter.id);
                                                }}
                                              >
                                                <span className="hidden-count">+{group.pages.length - 1}</span>
                                                <span className="hidden-text">ページ</span>
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      {/* 新規チャプター作成ゾーン（末尾・外部ファイルドラッグ時） */}
                      {isDraggingFiles && (
                        <div className={`new-chapter-drop-zone end ${fileDropMode === 'new-chapter' ? 'active' : ''}`}>
                          <div className="new-chapter-drop-content">
                            <span className="new-chapter-icon">➕</span>
                            <span className="new-chapter-text">末尾に新しいチャプターを作成</span>
                          </div>
                        </div>
                      )}
                      {/* 新規チャプター作成ゾーン（末尾） */}
                      <NewChapterDropZone
                        isActive={false}
                        isDragging={activeDragType === 'page' && !isDraggingFiles}
                        position="end"
                      />
                    </>
                  ) : (
                    // 選択中チャプターのみ表示
                    <div className="thumbnail-grid">
                      {displayPages.map((item) => (
                        <div key={item.page.id} className="thumbnail-wrapper-with-indicator">
                          {/* 内部ドラッグ用インジケーター */}
                          {dropTarget?.pageId === item.page.id && activeId && (dropTarget?.type === 'page-before' || dropTarget?.type === 'page-after') && (
                            <div className={`drop-indicator ${dropTarget?.type === 'page-after' ? 'right' : 'left'}`} />
                          )}
                          {/* 外部ファイルドラッグ用インジケーター（左右対応） */}
                          {fileDropTargetPageId === item.page.id && isDraggingFiles && (
                            <div className={`drop-indicator file-drop ${insertPosition === 'after' ? 'right' : 'left'}`} />
                          )}
                          <ThumbnailCard
                            page={item.page}
                            globalIndex={item.globalIndex}
                            thumbnailSize={thumbnailSizeValue}
                            isHighlighted={item.page.id === highlightedPageId}
                            isSelected={item.page.id === selectedPageId}
                            isMultiSelected={selectedPageIds.includes(item.page.id)}
                            onSelect={() => {
                              selectChapter(item.chapter.id);
                              selectPage(item.page.id);
                            }}
                            onCtrlClick={() => {
                              selectChapter(item.chapter.id);
                              togglePageSelection(item.page.id);
                            }}
                            onShiftClick={() => {
                              if (selectedPageId) {
                                selectPageRange(selectedPageId, item.page.id);
                              } else {
                                selectPage(item.page.id);
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </SortableContext>
              </div>
            )}
          </div>

          {/* フローティングエクスポートボタン */}
          <button
            className="btn-export-floating"
            onClick={() => setIsExportModalOpen(true)}
            disabled={allPages.length === 0}
          >
            <svg className="export-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="export-label">エクスポート</span>
            <span className="export-count">{allPages.length}P</span>
          </button>
        </main>
      </div>

      <DragOverlay>
        {activeId && activeDragType === 'chapter' ? (
          (() => {
            const chapter = chapters.find((c) => c.id === activeId);
            return chapter ? <DragOverlayChapterItem chapter={chapter} /> : null;
          })()
        ) : activeId && activePageData && activeDragType === 'page' ? (
          activeId.startsWith(SIDEBAR_PREFIX) ? (
            <DragOverlaySidebarItem page={activePageData.page} />
          ) : (
            <DragOverlayThumbnail
              page={activePageData.page}
              thumbnailSize={thumbnailSizeValue}
            />
          )
        ) : null}
      </DragOverlay>

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onExport={handleExport}
        chapters={chapters}
      />

      {/* 未保存確認ダイアログ */}
      {showUnsavedDialog && (
        <div className="modal-overlay">
          <div className="modal-content unsaved-dialog">
            <h2>未保存の変更があります</h2>
            <p>「{projectName}」への変更を保存しますか？</p>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => handleUnsavedDialogAction('cancel')}>
                キャンセル
              </button>
              <button className="btn-secondary" onClick={() => handleUnsavedDialogAction('discard')}>
                保存しない
              </button>
              <button className="btn-primary" onClick={() => handleUnsavedDialogAction('save')}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 欠落ファイルダイアログ */}
      {showMissingFilesDialog && missingFiles.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-content missing-files-dialog">
            <h2>ファイルが見つかりません</h2>
            <p>以下のファイルが見つかりませんでした。移動または削除された可能性があります。</p>
            <div className="missing-files-list">
              {missingFiles.map(file => (
                <div key={file.pageId} className="missing-file-item">
                  <span className="missing-file-icon">⚠️</span>
                  <span className="missing-file-path">{file.originalPath}</span>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setShowMissingFilesDialog(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ドロップインジケーターバー（外部ファイル・内部ドラッグ両対応） */}
      {(isDraggingFiles || activeDragType) && (
        <div className={`drop-indicator-bar ${isDraggingFiles ? 'file-drop' : 'internal-drop'}`}>
          <div className="drop-indicator-content">
            <span className="drop-indicator-icon">
              {isDraggingFiles ? '📁' : (activeDragType === 'chapter' ? '📚' : '📄')}
            </span>
            <span className="drop-indicator-text">
              {isDraggingFiles ? (
                // 外部ファイルドロップ時のメッセージ
                fileDropMode === 'insert' && fileDropTargetPageId ? (
                  (() => {
                    const targetItem = allPages.find(p => p.page.id === fileDropTargetPageId);
                    if (targetItem) {
                      const posText = insertPosition === 'after' ? '後' : '前';
                      return `「${targetItem.chapter.name}」の ${targetItem.globalIndex + 1}ページ目の${posText}に挿入`;
                    }
                    return 'ドロップして追加';
                  })()
                ) : fileDropMode === 'append-chapter' && fileDropTargetChapterId ? (
                  (() => {
                    const targetChapter = chapters.find(c => c.id === fileDropTargetChapterId);
                    if (targetChapter) {
                      return `「${targetChapter.name}」の末尾に追加`;
                    }
                    return 'チャプターの末尾に追加';
                  })()
                ) : fileDropMode === 'new-chapter' || fileDropMode === 'new-chapter-start' ? (
                  '新しいチャプターを作成してファイルを追加'
                ) : (
                  'ページの上にドロップして挿入位置を指定 / 下部で新規チャプター作成'
                )
              ) : activeDragType === 'chapter' ? (
                // チャプター移動時のメッセージ
                (() => {
                  const sourceChapter = chapters.find(c => c.id === activeId);
                  if (sourceChapter) {
                    return `「${sourceChapter.name}」を移動中...`;
                  }
                  return 'チャプターを移動中...';
                })()
              ) : activeDragType === 'page' && activePageData ? (
                // ページ移動時のメッセージ
                (() => {
                  const sourceName = activePageData.page.fileName ||
                    activePageData.page.label ||
                    PAGE_TYPE_LABELS[activePageData.page.pageType];

                  if (dropTarget?.pageId) {
                    const targetItem = allPages.find(p => p.page.id === dropTarget.pageId);
                    if (targetItem) {
                      if (targetItem.chapter.id !== activePageData.chapter.id) {
                        return `「${sourceName}」を「${targetItem.chapter.name}」に移動`;
                      } else {
                        const posText = dropTarget.type === 'page-after' ? '後' : '前';
                        return `「${sourceName}」を ${targetItem.globalIndex + 1}ページ目の${posText}に移動`;
                      }
                    }
                  }
                  return `「${sourceName}」を移動中...`;
                })()
              ) : (
                'ドラッグ中...'
              )}
            </span>
          </div>
        </div>
      )}
    </DndContext>
  );
}

export default App;
