import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Chapter, PageType, CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS } from '../../types';
import { FileIcon, FolderIcon, TrashIcon, PlusCircleIcon, ReplaceIcon } from '../../icons';
import { SIDEBAR_PREFIX } from '../../constants/dnd';
import { SortablePageItem } from './SortablePageItem';

// チャプターアイテム
export function ChapterItem({
  chapter,
  isSelected,
  selectedPageId,
  onSelect,
  onSelectPage,
  onToggle,
  onRename,
  onDelete,
  onDeletePage,
  onAddFiles,
  onAddFolder,
  onReplacePages,
  onAddSpecialPage,
  onInsertFile,
  onSelectFile,
  onRefreshFile,
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
  onDeletePage: (pageId: string) => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onReplacePages: () => void;
  onAddSpecialPage: (pageType: PageType, afterPageId?: string) => void;
  onInsertFile: (afterPageId: string) => void;
  onSelectFile: (pageId: string) => void;
  onRefreshFile: (pageId: string) => void;
  dropTarget: {
    type: 'page-before' | 'page-after' | 'chapter-before' | 'chapter-after' | 'chapter-end';
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
  const [menuPosition, setMenuPosition] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

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

  // チャプターへの挿入ライン表示判定（上部に表示）
  const showChapterInsertionLine = dropTarget?.type === 'chapter-before' && dropTarget.chapterId === chapter.id;

  return (
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
        {showChapterInsertionLine && <div className="chapter-header-insertion-line" />}
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
          {(chapter.type === 'cover' || chapter.type === 'chapter' || chapter.type === 'intermission') && (
            <button
              className="btn-icon"
              onClick={(e) => {
                e.stopPropagation();
                onReplacePages();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="フォルダから差し替え"
            >
              <ReplaceIcon size={14} />
            </button>
          )}
          <button
            className="btn-icon btn-delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="削除"
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
      <div className={`chapter-pages-outer ${chapter.collapsed ? 'collapsed' : ''}`}>
        <div className="chapter-pages">
          <div className="chapter-pages-inner">
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
                  chapterType={chapter.type}
                  onSelect={() => onSelectPage(page.id)}
                  onAddSpecialPage={onAddSpecialPage}
                  onInsertFile={onInsertFile}
                  onSelectFile={onSelectFile}
                  onRefreshFile={onRefreshFile}
                  onDelete={() => onDeletePage(page.id)}
                  showInsertionBefore={dropTarget?.type === 'page-before' && dropTarget.pageId === page.id && dropTarget.chapterId === chapter.id}
                  showInsertionAfter={dropTarget?.type === 'page-after' && dropTarget.pageId === page.id && dropTarget.chapterId === chapter.id}
                />
              ))}
            </SortableContext>
          )}
          {chapter.type === 'blank' ? (
            <div className="chapter-pages-add">
              <button
                className="btn-icon chapter-add-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddSpecialPage('blank');
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="白紙ページを追加"
              >
                <PlusCircleIcon size={16} />
                <span className="chapter-add-btn-label">白紙を追加</span>
              </button>
            </div>
          ) : (
          <div className="chapter-pages-add">
              <button
                ref={addBtnRef}
                className="btn-icon chapter-add-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!showAddMenu && addBtnRef.current) {
                    const rect = addBtnRef.current.getBoundingClientRect();
                    const menuHeight = 100; // メニューの推定高さ（2項目）
                    const windowHeight = window.innerHeight;
                    // 画面下部に近い場合は上方向に開く
                    if (rect.bottom + menuHeight > windowHeight) {
                      setMenuPosition({ bottom: windowHeight - rect.top + 4, left: rect.left });
                    } else {
                      setMenuPosition({ top: rect.bottom + 4, left: rect.left });
                    }
                  }
                  setShowAddMenu(!showAddMenu);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="ページ追加"
              >
                <PlusCircleIcon size={16} />
                <span className="chapter-add-btn-label">ページを追加</span>
              </button>
              {showAddMenu && menuPosition && createPortal(
                <>
                  <div
                    className="menu-backdrop-fixed"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAddMenu(false);
                    }}
                  />
                  <div
                    className="chapter-add-menu menu-fixed"
                    style={{
                      top: menuPosition.top,
                      bottom: menuPosition.bottom,
                      left: menuPosition.left,
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddFiles();
                        setShowAddMenu(false);
                      }}
                    >
                      <FileIcon size={14} /> ファイルを選択
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddFolder();
                        setShowAddMenu(false);
                      }}
                    >
                      <FolderIcon size={14} /> フォルダを選択
                    </button>
                  </div>
                </>,
                document.body
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
