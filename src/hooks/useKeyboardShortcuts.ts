import { useEffect } from 'react';
import { Chapter, Page } from '../types';

interface PageWithContext {
  page: Page;
  chapter: Chapter;
  globalIndex: number;
}

interface UseKeyboardShortcutsOptions {
  // 状態
  selectedChapterId: string | null;
  selectedPageId: string | null;
  selectedPageIds: string[];
  chapters: Chapter[];
  allPages: PageWithContext[];
  previewMode: 'grid' | 'spread' | 'epub';

  // アクション
  removePage: (chapterId: string, pageId: string) => void;
  removeSelectedPages: () => void;
  selectChapter: (id: string | null) => void;
  selectPage: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
  handleDeleteChapter: (chapterId: string) => void;
  handleNewProject: () => void;
  handleOpenProject: () => Promise<void>;
  setIsViewerMode: (value: boolean | ((prev: boolean) => boolean)) => void;
}

/**
 * キーボードショートカットを管理するフック
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const {
    selectedChapterId,
    selectedPageId,
    selectedPageIds,
    chapters,
    allPages,
    previewMode,
    removePage,
    removeSelectedPages,
    selectChapter,
    selectPage,
    undo,
    redo,
    handleDeleteChapter,
    handleNewProject,
    handleOpenProject,
    setIsViewerMode,
  } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 入力フィールドにフォーカスがある場合は無視
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // F1: 閲覧モード切替（見開き表示時のみ）
      if (e.key === 'F1') {
        e.preventDefault();
        if (previewMode === 'spread') {
          setIsViewerMode(prev => !prev);
        }
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
        handleOpenProject();
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
          handleDeleteChapter(selectedChapterId);
        }
      }

      // 矢印キーでナビゲーション（見開き・EPUBモードでは左右キーはSpreadViewerが処理）
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if ((previewMode === 'spread' || previewMode === 'epub') &&
            (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          return;
        }
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
  }, [
    selectedChapterId,
    selectedPageId,
    selectedPageIds,
    chapters,
    allPages,
    previewMode,
    removePage,
    removeSelectedPages,
    selectChapter,
    selectPage,
    undo,
    redo,
    handleDeleteChapter,
    handleNewProject,
    handleOpenProject,
    setIsViewerMode,
  ]);
}
