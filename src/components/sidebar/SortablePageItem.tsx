import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Page, PageType, PAGE_TYPE_LABELS, PAGE_TYPE_COLORS, FILE_SELECTABLE_PAGE_TYPES, ChapterType } from '../../types';
import { FolderIcon, TrashIcon, AlertTriangleIcon, ReplaceIcon } from '../../icons';
import { SIDEBAR_PREFIX } from '../../constants/dnd';
import { InsertionLine } from '../dnd';
import { useStore } from '../../store';
import { getValidationMessage } from '../../utils/validationMessage';

// サイドバーのソート可能なページアイテム
export function SortablePageItem({
  page,
  index,
  isSelected,
  chapterType,
  onSelect,
  onAddSpecialPage,
  onInsertFile,
  onSelectFile,
  onRefreshFile,
  onDelete,
  showInsertionBefore,
  showInsertionAfter,
}: {
  page: Page;
  index: number;
  isSelected: boolean;
  chapterType: ChapterType;
  onSelect: () => void;
  onAddSpecialPage: (pageType: PageType, afterPageId: string) => void;
  onInsertFile: (afterPageId: string) => void;
  onSelectFile: (pageId: string) => void;
  onRefreshFile: (pageId: string) => void;
  onDelete: () => void;
  showInsertionBefore?: boolean;
  showInsertionAfter?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const validationContext = useStore((s) => s.validationContext);
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
            {page.fileValidationStatus && page.fileValidationStatus !== 'ok' && (
              <>
                <span
                  className="page-file-alert"
                  title={getValidationMessage(page, validationContext, chapterType)}
                >
                  <AlertTriangleIcon size={12} />
                </span>
                {page.fileValidationStatus === 'modified' && (
                  <button
                    className="page-file-replace-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRefreshFile(page.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="リンクを更新"
                  >
                    <ReplaceIcon size={11} />
                  </button>
                )}
              </>
            )}
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
                  <FolderIcon size={12} />
                </button>
              )}
              {!isSpecialPage && (
                <>
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
                      <button onClick={() => { onAddSpecialPage('blank', page.id); setShowMenu(false); }}>
                        白紙
                      </button>
                      <button onClick={() => { onInsertFile(page.id); setShowMenu(false); }}>
                        ファイル
                      </button>
                    </div>
                  )}
                </>
              )}
              <button
                className="page-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="削除"
              >
                <TrashIcon size={12} />
              </button>
            </div>
          </>
        )}
      </div>
      {showInsertionAfter && <InsertionLine />}
    </>
  );
}
