import { useDroppable } from '@dnd-kit/core';
import { PlusIcon } from '../../icons';
import {
  NEW_CHAPTER_DROP_ZONE_ID,
  NEW_CHAPTER_DROP_ZONE_START_ID,
  SIDEBAR_NEW_CHAPTER_DROP_ZONE_ID,
  SIDEBAR_NEW_CHAPTER_DROP_ZONE_START_ID,
  CHAPTER_REORDER_DROP_ZONE_START_ID,
  CHAPTER_REORDER_DROP_ZONE_END_ID,
} from '../../constants/dnd';

// 挿入ラインコンポーネント（ドロップ位置を示す）
export function InsertionLine() {
  return <div className="insertion-line" />;
}

// 新規チャプター作成ゾーン（ドロップ可能）
export function NewChapterDropZone({ isActive, isDragging, position = 'end' }: { isActive: boolean; isDragging: boolean; position?: 'start' | 'end' }) {
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
        <span className="new-chapter-icon"><PlusIcon size={16} /></span>
        <span className="new-chapter-text">
          {position === 'start' ? '先頭に新しいチャプターを作成' : 'ここにドロップで新しいチャプターを作成'}
        </span>
      </div>
    </div>
  );
}

// サイドバー用の新規チャプター作成ゾーン（ドロップ可能）
export function SidebarNewChapterDropZone({ isDragging, position = 'end' }: { isDragging: boolean; position?: 'start' | 'end' }) {
  const { setNodeRef, isOver } = useDroppable({
    id: position === 'start' ? SIDEBAR_NEW_CHAPTER_DROP_ZONE_START_ID : SIDEBAR_NEW_CHAPTER_DROP_ZONE_ID,
  });

  if (!isDragging) return null;

  return (
    <div
      ref={setNodeRef}
      className={`sidebar-new-chapter-zone ${position} ${isOver ? 'active' : ''}`}
    >
      <span className="sidebar-new-chapter-icon"><PlusIcon size={14} /></span>
      <span className="sidebar-new-chapter-text">
        {position === 'start' ? '先頭にチャプターを作成' : '新しいチャプターを作成'}
      </span>
    </div>
  );
}

// サイドバー用のチャプター並べ替えゾーン（ドロップ可能）
export function SidebarChapterReorderDropZone({ isDragging, position = 'end' }: { isDragging: boolean; position?: 'start' | 'end' }) {
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
