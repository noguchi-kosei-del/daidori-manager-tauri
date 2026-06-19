import { useState } from 'react';
import {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  CollisionDetection,
} from '@dnd-kit/core';
import { Chapter, Page } from '../types';
import { SIDEBAR_PREFIX } from '../constants/dnd';

export type DropTarget = {
  type: 'page-before' | 'page-after' | 'chapter-before' | 'chapter-after' | 'chapter-end';
  chapterId: string;
  pageId?: string;
  /** リスト表示の点線プレースホルダー上にカーソルが乗っている（ロック状態）: ドロップで実際に並べ替えを実行する */
  locked?: boolean;
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
        return chapterIds.has(id);
      });

      // フィルタリングされたコンテナでclosestCenterを使用
      return closestCenter({
        ...args,
        droppableContainers: chapterContainers,
      });
    }

    // ページドラッグ時はポインタ位置で判定（チャプター跨ぎ・空チャプターへの移動を確実にする）。
    // 優先: ph(プレースホルダ) > ページ > チャプター枠(chapter-drop)。
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const ph = pointer.filter((c) => String(c.id).startsWith('ph:'));
      if (ph.length) return ph;
      const pageHits = pointer.filter((c) => {
        const id = String(c.id);
        return !id.startsWith('ph:') && !id.startsWith('chapter-drop:');
      });
      if (pageHits.length) return pageHits;
      const chap = pointer.filter((c) => String(c.id).startsWith('chapter-drop:'));
      if (chap.length) return chap;
    }
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

    // チャプター枠の上にホバー（空チャプター含む）: そのチャプターの末尾へ移動（即ロック）
    if (overIdStr.startsWith('chapter-drop:')) {
      if (activeDragType === 'page') {
        const chapterId = overIdStr.slice('chapter-drop:'.length);
        setDropTarget({ type: 'chapter-end', chapterId, locked: true });
      } else {
        setDropTarget(null);
      }
      return;
    }

    // プレースホルダー上にホバー: 位置をロック（実線表示・ドロップで並べ替え確定）
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
          locked: true,
        });
      }
      return;
    }

    // ドラッグ中のアイテムの現在位置（中央）を計算
    const activeRect = active.rect.current.translated;
    const activeCenterY = activeRect ? activeRect.top + activeRect.height / 2 : 0;

    // チャプタードラッグの場合
    if (activeDragType === 'chapter') {
      // チャプター上にホバー（サイドバー）
      // ドラッグ方向（active が over より上か下か）でビジュアル指標を切替:
      //  - active が over より下にある（下→上にドラッグ中） → 'chapter-before'（over の上に挿入）
      //  - active が over より上にある（上→下にドラッグ中） → 'chapter-after'（over の下に挿入）
      // この方式は SortableContext の verticalListSortingStrategy が
      // active.id を over の位置に挿入する dnd-kit 標準動作と一致する
      const overIndex = chapters.findIndex(c => c.id === overIdStr);
      const activeIndex = chapters.findIndex(c => c.id === String(active.id));
      if (overIndex !== -1 && activeIndex !== -1) {
        const insertType = activeIndex > overIndex ? 'chapter-before' : 'chapter-after';
        setDropTarget({ type: insertType, chapterId: overIdStr, locked: true });
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

      // サイドバーは従来通り即ロック（ドロップで確定）。
      // リスト表示でも「チャプターを跨ぐ移動」は即ロックして、別チャプターのページ上に
      // ドロップするだけで移動できるようにする（薄い点線プレースホルダーを狙わなくてよい）。
      // 同一チャプター内の並べ替えだけは従来どおりプレースホルダー上ホバーでロック（誤操作防止）。
      const isCrossChapter = activePage.chapter.id !== overPage.chapter.id;
      setDropTarget({
        type: insertType,
        chapterId: overPage.chapter.id,
        pageId: actualOverId,
        locked: isSidebarDrag || isCrossChapter,
      });
    } else {
      setDropTarget(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // dropTarget(React state)はドラッグ中の更新ラグで、リリース時に null になっていることが
    // ある（特に遠いチャプターへ運ぶ間に over が一瞬外れた場合）。そのため event.over から
    // 直接ターゲットを補完し、別チャプター／空チャプターへの移動を取りこぼさないようにする。
    let dt = dropTarget;
    if (activeDragType === 'page' && over) {
      const aId = String(active.id);
      const isSb = aId.startsWith(SIDEBAR_PREFIX);
      const actualA = isSb ? aId.replace(SIDEBAR_PREFIX, '') : aId;
      const aPage = allPages.find((p) => p.page.id === actualA);
      const overId = String(over.id);
      // dropTarget が無い/未ロックのときだけ補完（プレースホルダー上の確定など既存挙動は尊重）
      if (!dt || !dt.locked) {
        if (overId.startsWith('chapter-drop:')) {
          dt = { type: 'chapter-end', chapterId: overId.slice('chapter-drop:'.length), locked: true };
        } else if (overId.startsWith('ph:')) {
          const parts = overId.split(':');
          const pos = parts[1];
          const pid = parts.slice(2).join(':');
          const oPage = allPages.find((p) => p.page.id === pid);
          if (oPage) dt = { type: pos === 'before' ? 'page-before' : 'page-after', chapterId: oPage.chapter.id, pageId: pid, locked: true };
        } else {
          const oId = overId.startsWith(SIDEBAR_PREFIX) ? overId.replace(SIDEBAR_PREFIX, '') : overId;
          const oPage = allPages.find((p) => p.page.id === oId);
          // 別チャプターのページ上 → そのチャプター末尾へ移動（確実に確定）
          if (oPage && aPage && oPage.chapter.id !== aPage.chapter.id) {
            dt = { type: 'chapter-end', chapterId: oPage.chapter.id, locked: true };
          }
        }
      }
    }

    // dropTargetがない場合は何もしない
    if (!dt) {
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

      if (dt.type === 'chapter-before' || dt.type === 'chapter-after') {
        const targetIndex = chapters.findIndex((c) => c.id === dt.chapterId);
        if (targetIndex !== -1) {
          // dnd-kit 標準パターン: over.id の位置に active を移動（splice ベースの reorderChapters と整合）
          // 'chapter-after' の場合のみ +1 する。reorderChapters は from を抜いた後の配列に対して to で挿入するので
          // 自分より後ろへの移動のオフセット補正は不要（splice(from,1) で一旦抜く実装のため）。
          let newIndex = dt.type === 'chapter-after' ? targetIndex + 1 : targetIndex;
          // newIndex が oldIndex より後ろの場合、抜いた分だけ index を1つ前にずらす
          if (newIndex > oldIndex) newIndex -= 1;
          if (newIndex !== oldIndex) {
            reorderChapters(oldIndex, newIndex);
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
      // dt.locked が false の場合は確定せずキャンセル（点線プレースホルダー上にホバーしていない状態でリリースされた）
      if ((dt.type === 'page-before' || dt.type === 'page-after') && dt.pageId && dt.locked) {
        const toChapterId = dt.chapterId;
        const targetChapter = chapters.find(c => c.id === toChapterId);

        if (targetChapter) {
          const targetPageIndex = targetChapter.pages.findIndex(p => p.id === dt.pageId);
          let newIndex = dt.type === 'page-after' ? targetPageIndex + 1 : targetPageIndex;

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
      if (dt.type === 'chapter-end') {
        const toChapterId = dt.chapterId;
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
