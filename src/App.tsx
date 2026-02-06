import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save, ask } from '@tauri-apps/plugin-dialog';
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
  CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
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
  DaidoriProjectFile,
  SavedChapter,
  SavedPage,
  FileValidationResult,
  RecentFile,
} from './types';
import {
  FileIcon,
  FolderIcon,
  PlusIcon,
  BookOpenIcon,
  AlertTriangleIcon,
  BooksIcon,
  SunIcon,
  MoonIcon,
  HomeIcon,
  ExportIcon,
} from './icons';

// 抽出したコンポーネント
import { SpreadViewer } from './components/preview/SpreadViewer';
import { ThumbnailCard } from './components/preview/ThumbnailCard';
import { ChapterItem } from './components/sidebar';
import {
  DragOverlayThumbnail,
  DragOverlaySidebarItem,
  DragOverlayChapterItem,
  NewChapterDropZone,
  SidebarNewChapterDropZone,
  SidebarChapterReorderDropZone,
} from './components/dnd';
import { ExportModal } from './components/modals/ExportModal';
import type { ExportOptions } from './components/modals/ExportModal';
import {
  SIDEBAR_PREFIX,
  NEW_CHAPTER_DROP_ZONE_ID,
  NEW_CHAPTER_DROP_ZONE_START_ID,
  SIDEBAR_NEW_CHAPTER_DROP_ZONE_ID,
  SIDEBAR_NEW_CHAPTER_DROP_ZONE_START_ID,
  CHAPTER_REORDER_DROP_ZONE_START_ID,
  CHAPTER_REORDER_DROP_ZONE_END_ID,
} from './constants/dnd';

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
    setProjectName,
  } = useStore();

  // TODO: ホーム画面とエディター画面の切り替えに使用
  const [_currentView, setCurrentView] = useState<'home' | 'editor'>('home');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<'chapter' | 'page' | null>(null);
  const [previewMode, setPreviewMode] = useState<'grid' | 'spread'>('grid');
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // 初期状態をlocalStorageから復元（デフォルトはダークモード）
    const saved = localStorage.getItem('daidori_dark_mode');
    return saved !== 'false'; // 明示的にfalseでない限りダークモード
  });
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

  // プロジェクト名編集
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState('');
  const projectNameInputRef = useRef<HTMLInputElement>(null);

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

  // プロジェクト名編集の開始
  const startEditingProjectName = () => {
    setEditingProjectName(projectName);
    setIsEditingProjectName(true);
    setIsProjectMenuOpen(false);
  };

  // プロジェクト名編集の確定
  const confirmProjectNameEdit = () => {
    const trimmedName = editingProjectName.trim();
    if (trimmedName && trimmedName !== projectName) {
      setProjectName(trimmedName);
    }
    setIsEditingProjectName(false);
  };

  // プロジェクト名編集のキャンセル
  const cancelProjectNameEdit = () => {
    setIsEditingProjectName(false);
  };

  // プロジェクト名編集時にinputにフォーカス
  useEffect(() => {
    if (isEditingProjectName && projectNameInputRef.current) {
      projectNameInputRef.current.focus();
      projectNameInputRef.current.select();
    }
  }, [isEditingProjectName]);

  // プロジェクト関連のstate
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | 'close' | null>(null);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [missingFiles, setMissingFiles] = useState<FileValidationResult[]>([]);
  const [showMissingFilesDialog, setShowMissingFilesDialog] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const isModifiedRef = useRef(isModified);

  // isModifiedRefを常に最新に保つ
  useEffect(() => {
    isModifiedRef.current = isModified;
  }, [isModified]);

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
      await getCurrentWindow().destroy();
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

  // ダークモード切替の適用
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
    localStorage.setItem('daidori_dark_mode', isDarkMode ? 'true' : 'false');
  }, [isDarkMode]);

  // ダークモードトグル
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  // ウィンドウ終了ハンドラ（一度だけ登録、isModifiedはrefで参照）
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isMounted = true;

    const setupCloseHandler = async () => {
      console.log('Setting up close handler...');
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        console.log('Close requested, isModified:', isModifiedRef.current);
        if (isModifiedRef.current) {
          console.log('Preventing close, showing dialog');
          event.preventDefault();
          setPendingAction('close');
          setShowUnsavedDialog(true);
        } else {
          console.log('Allowing close');
          // 明示的にウィンドウを閉じる
          await appWindow.destroy();
        }
      });
      if (isMounted) {
        console.log('Close handler setup complete');
      }
    };

    setupCloseHandler();

    return () => {
      isMounted = false;
      console.log('Cleaning up close handler');
      if (unlisten) {
        unlisten();
      }
    };
  }, []); // 空の依存配列で一度だけ登録

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
    const activeIdStr = active.id as string;
    setActiveId(activeIdStr);

    const isChapter = chapters.some((c) => c.id === activeIdStr);
    setActiveDragType(isChapter ? 'chapter' : 'page');
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropTarget(null);
      return;
    }

    const overIdStr = String(over.id);

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
      // ドラッグ中のアイテムの中央位置とover要素の中央を比較
      const overRect = over.rect;
      const overCenterY = overRect.top + overRect.height / 2;

      // ドラッグアイテムの中央がover要素の中央より上なら「前」、下なら「後」
      const insertType = activeCenterY < overCenterY ? 'page-before' : 'page-after';
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
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="app">
        <main className="main-area">
          <div className={`main-header ${isToolbarCollapsed ? 'collapsed' : ''}`}>
            <div className="main-header-row">
              <div className="project-menu-container" ref={projectMenuRef}>
                {isEditingProjectName ? (
                  <div className="project-name-edit">
                    <input
                      ref={projectNameInputRef}
                      type="text"
                      value={editingProjectName}
                      onChange={(e) => setEditingProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          confirmProjectNameEdit();
                        } else if (e.key === 'Escape') {
                          cancelProjectNameEdit();
                        }
                      }}
                      onBlur={confirmProjectNameEdit}
                      className="project-name-input"
                    />
                  </div>
                ) : (
                  <button
                    className="project-menu-trigger"
                    onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEditingProjectName();
                    }}
                  >
                    <span className="project-name-display">
                      {isModified && <span className="modified-indicator">●</span>}
                      {projectName}
                    </span>
                  </button>
                )}

                {isProjectMenuOpen && !isEditingProjectName && (
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

              <div className="main-header-actions">
                <button
                  className="export-btn"
                  onClick={() => setIsExportModalOpen(true)}
                  title="エクスポート"
                  disabled={allPages.length === 0}
                >
                  <ExportIcon size={18} />
                </button>

                <button
                  className="home-btn"
                  onClick={async () => {
                    const confirmed = await ask('プロジェクトがリセットされます。よろしいですか？', {
                      title: '確認',
                      kind: 'warning',
                    });
                    if (confirmed) {
                      resetProject();
                      setCurrentView('home');
                    }
                  }}
                  title="ホーム画面に戻る"
                  disabled={chapters.length === 0}
                >
                  <HomeIcon size={18} />
                </button>

                <button
                  className="theme-toggle-btn"
                  onClick={toggleDarkMode}
                  title={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
                >
                  {isDarkMode ? <MoonIcon size={18} /> : <SunIcon size={18} />}
                </button>

                <button
                  className="toolbar-collapse-btn"
                  onClick={() => setIsToolbarCollapsed(!isToolbarCollapsed)}
                  title={isToolbarCollapsed ? 'ツールバーを展開' : 'ツールバーを折りたたむ'}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" className={`collapse-icon ${isToolbarCollapsed ? 'collapsed' : ''}`}>
                    <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className={`toolbar-content ${isToolbarCollapsed ? 'collapsed' : ''}`}>
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
                  <BookOpenIcon size={14} /> 見開き
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
          </div>

          <div className="preview-container">
            <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
              <div className="sidebar-header">
                <button
                  className="sidebar-toggle-btn"
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  title={isSidebarCollapsed ? 'サイドバーを展開' : 'サイドバーを折り畳む'}
                >
                  {isSidebarCollapsed ? '»' : '«'}
                </button>
              </div>
              <div className="sidebar-content">
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
                        onDeletePage={(pageId) => removePage(chapter.id, pageId)}
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
                <div className="chapter-actions-bar">
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
                    onClick={() => handleAddChapter('chapter')}
                  >
                    +話
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
                <div className="footer-stats">
                  <span className="stats-label">合計</span>
                  <span className="stats-value">{allPages.length}</span>
                  <span className="stats-unit">ページ</span>
                </div>
              </div>
            </aside>

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
                            <span className="new-chapter-icon"><PlusIcon size={16} /></span>
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
                          // チャプターごとにグループ化（空のチャプターも含む）
                          const chapterGroups: { chapter: Chapter; pages: typeof displayPages }[] = chapters.map(chapter => ({
                            chapter,
                            pages: displayPages.filter(item => item.chapter.id === chapter.id)
                          }));

                          return (
                            <>
                              {/* チャプターブロック（横並び、展開時はページが折り返し） */}
                              <div className="chapter-blocks-flow">
                                {chapterGroups.map((group) => {
                                  const isCollapsed = previewCollapsedChapters.has(group.chapter.id);
                                  const firstPage = group.pages[0];

                                  // ページ一覧を作成（折りたたみ時は先頭のみ、展開時は全て）
                                  const pagesToShow = isCollapsed ? (firstPage ? [firstPage] : []) : group.pages;

                                  return (
                                    <div key={group.chapter.id} className="chapter-flow-group">
                                      {/* ページなしの場合 */}
                                      {group.pages.length === 0 ? (
                                        <div className="chapter-page-wrapper">
                                          {/* ヘッダー */}
                                          <div
                                            className={`chapter-underline-header ${fileDropMode === 'append-chapter' && fileDropTargetChapterId === group.chapter.id ? 'drop-target' : ''}`}
                                            data-chapter-id={group.chapter.id}
                                          >
                                            <span
                                              className="chapter-block-badge"
                                              style={{ backgroundColor: CHAPTER_TYPE_COLORS[group.chapter.type] }}
                                            >
                                              {CHAPTER_TYPE_LABELS[group.chapter.type]}
                                            </span>
                                            <span className="chapter-block-name">{group.chapter.name}</span>
                                          </div>
                                          {/* 空のページ */}
                                          <div
                                            className="chapter-block-empty"
                                            style={{ width: thumbnailSizeValue, height: thumbnailSizeValue * 1.4 }}
                                          >
                                            <span>ページなし</span>
                                          </div>
                                          {/* アンダーライン */}
                                          <div
                                            className="chapter-underline"
                                            style={{ backgroundColor: CHAPTER_TYPE_COLORS[group.chapter.type] }}
                                          />
                                        </div>
                                      ) : (
                                        // ページがある場合：各ページにヘッダーとアンダーラインを付ける
                                        pagesToShow.map((item, idx) => (
                                          <div key={item.page.id} className="chapter-page-wrapper">
                                            {/* 最初のページのみヘッダーを表示 */}
                                            {idx === 0 && (
                                              <div
                                                className={`chapter-underline-header ${fileDropMode === 'append-chapter' && fileDropTargetChapterId === group.chapter.id ? 'drop-target' : ''}`}
                                                data-chapter-id={group.chapter.id}
                                                onClick={() => group.pages.length > 1 && togglePreviewChapterCollapse(group.chapter.id)}
                                                style={{ cursor: group.pages.length > 1 ? 'pointer' : 'default' }}
                                              >
                                                {group.pages.length > 1 && (
                                                  <span className="chapter-block-collapse-btn">{isCollapsed ? '▶' : '▼'}</span>
                                                )}
                                                <span
                                                  className="chapter-block-badge"
                                                  style={{ backgroundColor: CHAPTER_TYPE_COLORS[group.chapter.type] }}
                                                >
                                                  {CHAPTER_TYPE_LABELS[group.chapter.type]}
                                                </span>
                                                <span className="chapter-block-name">{group.chapter.name}</span>
                                              </div>
                                            )}
                                            {/* ページ */}
                                            <div className="thumbnail-wrapper-with-indicator chapter-flow-page">
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
                                                pageCount={isCollapsed ? group.pages.length : undefined}
                                                lastGlobalIndex={isCollapsed && group.pages.length > 1 ? group.pages[group.pages.length - 1].globalIndex : undefined}
                                              />
                                            </div>
                                            {/* アンダーライン */}
                                            <div
                                              className="chapter-underline"
                                              style={{ backgroundColor: CHAPTER_TYPE_COLORS[group.chapter.type] }}
                                            />
                                          </div>
                                        ))
                                      )}
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
                            <span className="new-chapter-icon"><PlusIcon size={16} /></span>
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
          </div>

        </main>
      </div>

      <DragOverlay>
        {activeId && activeDragType === 'chapter' ? (
          (() => {
            const chapter = chapters.find((c) => c.id === activeId);
            if (!chapter) return null;
            return <DragOverlayChapterItem chapter={chapter} />;
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
                  <span className="missing-file-icon"><AlertTriangleIcon size={16} /></span>
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

      {/* ドロップインジケーターバー（外部ファイル・ページドラッグのみ、チャプタードラッグは除外） */}
      {(isDraggingFiles || (activeDragType && activeDragType !== 'chapter')) && (
        <div className={`drop-indicator-bar ${isDraggingFiles ? 'file-drop' : 'internal-drop'}`}>
          <div className="drop-indicator-content">
            <span className="drop-indicator-icon">
              {isDraggingFiles ? <FolderIcon size={18} /> : (activeDragType === 'chapter' ? <BooksIcon size={18} /> : <FileIcon size={18} />)}
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
