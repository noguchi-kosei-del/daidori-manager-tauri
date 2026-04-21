import { useDroppable } from '@dnd-kit/core';
import {
  CHAPTER_REORDER_DROP_ZONE_START_ID,
  CHAPTER_REORDER_DROP_ZONE_END_ID,
} from '../../constants/dnd';

// 挿入ラインコンポーネント（ドロップ位置を示す）
export function InsertionLine() {
  return <div className="insertion-line" />;
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
