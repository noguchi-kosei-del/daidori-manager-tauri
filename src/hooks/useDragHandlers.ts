import { useState } from 'react';
import {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  CollisionDetection,
} from '@dnd-kit/core';
import { Chapter, Page } from '../types';
import {
  SIDEBAR_PREFIX,
  CHAPTER_REORDER_DROP_ZONE_START_ID,
  CHAPTER_REORDER_DROP_ZONE_END_ID,
} from '../constants/dnd';

export type DropTarget = {
  type: 'page-before' | 'page-after' | 'chapter-before' | 'chapter-after' | 'chapter-end';
  chapterId: string;
  pageId?: string;
} | null;

interface AllPageItem {
  page: Page;
  chapter: Chapter;
  globalIndex: number;
}

interface UseDragHandlersParams {
  chapters: Chapter[];
  allPages: AllPageItem[];
  selectedPageIds: string[];
  // store actions
  reorderChapters: (fromIndex: number, toIndex: number) => void;
  reorderPages: (chapterId: string, fromIndex: number, toIndex: number) => void;
  movePage: (fromChapterId: string, toChapterId: string, pageId: string, toIndex: number) => void;
  movePages: (pageIds: string[], toChapterId: string, toIndex: number) => void;
}

export function useDragHandlers({
  chapters,
  allPages,
  selectedPageIds,
  reorderChapters,
  reorderPages,
  movePage,
  movePages,
}: UseDragHandlersParams) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<'page' | 'chapter' | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [draggedPageIds, setDraggedPageIds] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // カスタムcollision detection: チャプタードラッグ時はチャプターIDのみを対象にする
  const customCollisionDetection: CollisionDetection = (args) => {
    const { droppableContainers } = args;

    // チャプタードラッグ時
    if (activeDragType === 'chapter') {
      // チャプターIDのみをフィルタリング（ページIDを除外）
      const chapterIds = new Set(chapters.map(c => c.id));
      const chapterContainers = droppableContainers.filter(container => {
        const id = String(container.id);
        return chapterIds.has(id) ||
               id === CHAPTER_REORDER_DROP_ZONE_START_ID ||
               id === CHAPTER_REORDER_DROP_ZONE_END_ID;
      });

      // フィルタリングされたコンテナでclosestCenterを使用
      return closestCenter({
        ...args,
        droppableContainers: chapterContainers,
      });
    }

    // ページドラッグ時は通常のclosestCenter
    return closestCenter(args);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeIdStr = active.id as string;
    setActiveId(activeIdStr);

    const isChapter = chapters.some((c) => c.id === activeIdStr);
    setActiveDragType(isChapter ? 'chapter' : 'page');

    // ページドラッグの場合、複数選択をチェック
    if (!isChapter) {
      const isSidebarDrag = activeIdStr.startsWith(SIDEBAR_PREFIX);
      const actualPageId = isSidebarDrag ? activeIdStr.replace(SIDEBAR_PREFIX, '') : activeIdStr;

      // ドラッグしたページが選択中のページに含まれている場合、選択中のページすべてをドラッグ
      if (selectedPageIds.length > 1 && selectedPageIds.includes(actualPageId)) {
        setDraggedPageIds(selectedPageIds);
      } else {
        setDraggedPageIds([actualPageId]);
      }
    } else {
      setDraggedPageIds([]);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropTarget(null);
      return;
    }

    const overIdStr = String(over.id);

    // プレースホルダー上にホバー: 位置をロック
    if (overIdStr.startsWith('ph:')) {
      const parts = overIdStr.split(':');
      const position = parts[1];
      const pageId = parts.slice(2).join(':');
      const overPage = allPages.find((p) => p.page.id === pageId);
      if (overPage) {
        setDropTarget({
          type: position === 'before' ? 'page-before' : 'page-after',
          chapterId: overPage.chapter.id,
          pageId,
        });
      }
      return;
    }

    // ドラッグ中のアイテムの現在位置（中央）を計算
    const activeRect = active.rect.current.translated;
    const activeCenterY = activeRect ? activeRect.top + activeRect.height / 2 : 0;

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

      // チャプター上にホバー（サイドバー）
      const isChapterId = chapters.some(c => c.id === overIdStr);
      if (isChapterId) {
        // ドラッグ中のアイテムの中央位置とover要素の中央を比較
        const overRect = over.rect;
        const overCenterY = overRect.top + overRect.height / 2;
        // ドラッグアイテムの中央がover要素の中央より上なら「前」、下なら「後」
        const insertType = activeCenterY < overCenterY ? 'chapter-before' : 'chapter-after';
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
      const overRect = over.rect;
      let insertType: 'page-before' | 'page-after';

      if (isSidebarDrag) {
        // サイドバー: 縦並びなのでY軸で判定
        const overCenterY = overRect.top + overRect.height / 2;
        insertType = activeCenterY < overCenterY ? 'page-before' : 'page-after';
      } else {
        // リスト表示: 横並びwrapなのでX軸で判定
        const activeCenterX = activeRect ? activeRect.left + activeRect.width / 2 : 0;
        const overCenterX = overRect.left + overRect.width / 2;
        insertType = activeCenterX < overCenterX ? 'page-before' : 'page-after';
      }

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
      const activeIdStr = String(active.id);

      const oldIndex = chapters.findIndex((c) => c.id === activeIdStr);
      if (oldIndex === -1) {
        setActiveId(null);
        setActiveDragType(null);
        setDropTarget(null);
        return;
      }

      if (dropTarget.type === 'chapter-before' || dropTarget.type === 'chapter-after') {
        const targetIndex = chapters.findIndex((c) => c.id === dropTarget.chapterId);
        if (targetIndex !== -1) {
          const newIndex = dropTarget.type === 'chapter-after' ? targetIndex + 1 : targetIndex;
          // 自分より後ろに移動する場合は、自分が抜けた分を考慮
          const adjustedIndex = newIndex > oldIndex ? newIndex - 1 : newIndex;
          // 実際に位置が変わる場合のみ移動
          if (adjustedIndex !== oldIndex) {
            reorderChapters(oldIndex, adjustedIndex);
          }
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

      // 複数ページドラッグの場合
      const isMultiDrag = draggedPageIds.length > 1;

      // 通常のページ移動（page-before / page-after）
      if ((dropTarget.type === 'page-before' || dropTarget.type === 'page-after') && dropTarget.pageId) {
        const toChapterId = dropTarget.chapterId;
        const targetChapter = chapters.find(c => c.id === toChapterId);

        if (targetChapter) {
          const targetPageIndex = targetChapter.pages.findIndex(p => p.id === dropTarget.pageId);
          let newIndex = dropTarget.type === 'page-after' ? targetPageIndex + 1 : targetPageIndex;

          if (isMultiDrag) {
            // 複数ページ移動
            // ドロップ先にドラッグ中のページが含まれている場合、調整が必要
            const draggedPagesBeforeTarget = draggedPageIds.filter(id => {
              const page = targetChapter.pages.find(p => p.id === id);
              if (!page) return false;
              const pageIndex = targetChapter.pages.indexOf(page);
              return pageIndex < targetPageIndex;
            }).length;
            newIndex = Math.max(0, newIndex - draggedPagesBeforeTarget);
            movePages(draggedPageIds, toChapterId, newIndex);
          } else {
            // 単一ページ移動
            const fromChapterId = activePage.chapter.id;
            if (fromChapterId === toChapterId) {
              // 同じチャプター内での並べ替え
              const sourceIndex = targetChapter.pages.findIndex(p => p.id === actualActiveId);
              if (sourceIndex !== -1 && targetPageIndex !== -1 && sourceIndex !== targetPageIndex) {
                // 自分より後ろに移動する場合は、自分が抜けた分を考慮
                if (newIndex > sourceIndex) newIndex -= 1;
                reorderPages(toChapterId, sourceIndex, newIndex);
              }
            } else {
              // 異なるチャプター間の移動
              movePage(fromChapterId, toChapterId, actualActiveId, newIndex);
            }
          }
        }
      }

      // チャプター末尾へのドロップ
      if (dropTarget.type === 'chapter-end') {
        const toChapterId = dropTarget.chapterId;
        const targetChapter = chapters.find(c => c.id === toChapterId);
        if (targetChapter) {
          if (isMultiDrag) {
            // 複数ページ移動
            movePages(draggedPageIds, toChapterId, targetChapter.pages.length);
          } else {
            // 単一ページ移動
            const fromChapterId = activePage.chapter.id;
            if (fromChapterId !== toChapterId) {
              movePage(fromChapterId, toChapterId, actualActiveId, targetChapter.pages.length);
            }
          }
        }
      }
    }

    setActiveId(null);
    setActiveDragType(null);
    setDropTarget(null);
    setDraggedPageIds([]);
  };

  return {
    sensors,
    activeId,
    activeDragType,
    dropTarget,
    draggedPageIds,
    customCollisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
}
