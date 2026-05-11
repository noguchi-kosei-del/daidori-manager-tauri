import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Chapter, PageType, CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS } from '../../types';
import { FileIcon, FolderIcon, TrashIcon, PlusCircleIcon, ReplaceIcon, CopyIcon, PencilIcon, MoreIcon } from '../../icons';
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
  onDuplicate,
  onDeletePage,
  onAddFiles,
  onAddFolder,
  onReplacePages,
  onAddSpecialPage,
  onInsertFile,
  onSelectFile,
  onRefreshFile,
  dropTarget,
  isFileDropTarget = false,
}: {
  chapter: Chapter;
  isSelected: boolean;
  selectedPageId: string | null;
  onSelect: () => void;
  onSelectPage: (pageId: string) => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
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
  isFileDropTarget?: boolean;
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

  // チャプター操作メニュー（…）の状態
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [actionsMenuPosition, setActionsMenuPosition] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const actionsBtnRef = useRef<HTMLButtonElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setShowActionsMenu(false);
      closeTimerRef.current = null;
    }, 200);
  };
  const openActionsMenu = () => {
    cancelClose();
    if (actionsBtnRef.current) {
      const rect = actionsBtnRef.current.getBoundingClientRect();
      const menuHeight = 160; // 4項目分のおよその高さ
      const windowHeight = window.innerHeight;
      const right = Math.max(0, window.innerWidth - rect.right);
      // ギャップを設けず、ボタンの直下に密着配置（ホバー追従中の途切れを防ぐ）
      if (rect.bottom + menuHeight > windowHeight) {
        setActionsMenuPosition({ bottom: windowHeight - rect.top, right });
      } else {
        setActionsMenuPosition({ top: rect.bottom, right });
      }
    }
    setShowActionsMenu(true);
  };

  // アンマウント時にタイマー解除
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // メニュー開時の外側クリック検知（backdropは使わない: ボタンの mouseLeave を誘発してフラッシュする）
  useEffect(() => {
    if (!showActionsMenu) return;
    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (actionsBtnRef.current?.contains(target)) return;
      if (actionsMenuRef.current?.contains(target)) return;
      cancelClose();
      setShowActionsMenu(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelClose();
        setShowActionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDocMouseDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showActionsMenu]);

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

  // チャプター並べ替え時のドロップ先プレースホルダー表示判定（点線枠）
  const showDropPlaceholderBefore = dropTarget?.type === 'chapter-before' && dropTarget.chapterId === chapter.id;
  const showDropPlaceholderAfter = dropTarget?.type === 'chapter-after' && dropTarget.chapterId === chapter.id;

  return (
    <>
      {showDropPlaceholderBefore && <div className="chapter-drop-placeholder" />}
    <div
      ref={setNodeRef}
      style={{
        ...style,
        backgroundColor: chapter.type !== 'chapter' ? `${CHAPTER_TYPE_COLORS[chapter.type]}15` : undefined,
        borderColor: chapter.type !== 'chapter' ? `${CHAPTER_TYPE_COLORS[chapter.type]}40` : undefined,
      }}
      className={`chapter-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isFileDropTarget ? 'file-drop-target' : ''}`}
      data-chapter-id={chapter.id}
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
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
              setEditName(chapter.name);
            }}
            title="ダブルクリックでリネーム"
          >
            {chapter.name}
          </span>
        )}
        <span className="chapter-page-count">({chapter.pages.length})</span>
        <div className="chapter-actions">
          <button
            ref={actionsBtnRef}
            className="btn-icon chapter-actions-trigger"
            onClick={(e) => {
              e.stopPropagation();
              if (showActionsMenu) {
                cancelClose();
                setShowActionsMenu(false);
              } else {
                openActionsMenu();
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={openActionsMenu}
            onMouseLeave={scheduleClose}
            title="その他の操作"
            aria-haspopup="menu"
            aria-expanded={showActionsMenu}
          >
            <MoreIcon size={14} />
          </button>
          {showActionsMenu && actionsMenuPosition && createPortal(
            <div
              ref={actionsMenuRef}
              className="chapter-actions-menu menu-fixed"
              style={{
                top: actionsMenuPosition.top,
                bottom: actionsMenuPosition.bottom,
                right: actionsMenuPosition.right,
              }}
              role="menu"
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
              onClick={(e) => e.stopPropagation()}
            >
                <button
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                    setEditName(chapter.name);
                    cancelClose();
                    setShowActionsMenu(false);
                  }}
                >
                  <PencilIcon size={14} /> リネーム
                </button>
                {(chapter.type === 'cover' || chapter.type === 'chapter' || chapter.type === 'intermission' || chapter.type === 'ad' || chapter.type === 'title' || chapter.type === 'toc') && (
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReplacePages();
                      cancelClose();
                      setShowActionsMenu(false);
                    }}
                  >
                    <ReplaceIcon size={14} /> フォルダから差し替え
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate();
                    cancelClose();
                    setShowActionsMenu(false);
                  }}
                >
                  <CopyIcon size={14} /> チャプターを複製
                </button>
                <button
                  role="menuitem"
                  className="menu-item-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                    cancelClose();
                    setShowActionsMenu(false);
                  }}
                >
                  <TrashIcon size={14} /> 削除
                </button>
            </div>,
            document.body
          )}
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
      {showDropPlaceholderAfter && <div className="chapter-drop-placeholder" />}
    </>
  );
}
