import type { ReactNode, CSSProperties } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  CHAPTER_REORDER_DROP_ZONE_START_ID,
  CHAPTER_REORDER_DROP_ZONE_END_ID,
} from '../../constants/dnd';

// グリッドのチャプター枠（チャプター単位のドロップ先）。ページをここに落とすと
// そのチャプターの末尾へ移動する（空チャプター＝ページなしへも移動可能）。
// pointerWithin 判定により、内側のページ／プレースホルダーが優先される。
export function ChapterDropZone({
  chapterId,
  className,
  style,
  children,
}: {
  chapterId: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `chapter-drop:${chapterId}` });
  return (
    <div ref={setNodeRef} className={`${className ?? ''}${isOver ? ' chapter-drop-over' : ''}`} style={style}>
      {children}
    </div>
  );
}

// 挿入ラインコンポーネント（ドロップ位置を示す）
export function InsertionLine() {
  return <div className="insertion-line" />;
}

// リスト表示の挿入予定位置に表示する空白カードプレースホルダー（ドロップ可能・絶対配置）
export function DropPlaceholder({
  id,
  width,
  height,
  variant,
  side,
}: {
  id: string;
  width: number;
  height: number;
  variant?: string;
  side: 'before' | 'after';
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const classes = ['chapter-page-placeholder', `side-${side}`];
  if (variant) classes.push(variant);
  if (isOver) classes.push('locked');
  return (
    <div
      ref={setNodeRef}
      className={classes.join(' ')}
      style={{ width, height }}
    />
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
