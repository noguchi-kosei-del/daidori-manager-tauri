import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useTauriFileDrop } from './hooks/useTauriFileDrop';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useStore, FileInfo, THUMBNAIL_SIZES, ThumbnailSize } from './store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useWindowCloseHandler, useKeyboardShortcuts, useDragHandlers, useExport } from './hooks';
import {
  Chapter,
  ChapterType,
  CHAPTER_TYPE_LABELS,
  CHAPTER_TYPE_COLORS,
  Page,
  PageType,
  DaidoriProjectFile,
  SavedChapter,
  SavedPage,
  SavedFileReference,
  FileValidationResult,
} from './types';
import {
  FolderIcon,
  PlusIcon,
  PlusCircleIcon,
  AlertTriangleIcon,
  SunIcon,
  MoonIcon,
  ExportIcon,
  MonitorIcon,
  TrashIcon,
  EyeIcon,
  EyeOffIcon,
  BookIcon,
  ZoomInIcon,
  ZoomOutIcon,
  HamburgerIcon,
  FlipIcon,
  SettingsIcon,
  CloseIcon,
  GridViewIcon,
  BookOpenIcon,
  BindingRightIcon,
  BindingLeftIcon,
  CheckIcon2,
  NoPageIcon,
  SaveIcon,
} from './icons';

// 抽出したコンポーネント
import { SpreadViewer } from './components/preview/SpreadViewer';
import { ThumbnailCard } from './components/preview/ThumbnailCard';
import { ChapterItem } from './components/sidebar';
import {
  DragOverlayThumbnail,
  DragOverlaySidebarItem,
  DragOverlayChapterItem,
  SidebarNewChapterDropZone,
  SidebarChapterReorderDropZone,
} from './components/dnd';
import { ExportModal, EpubMetadataModal, BleedEditorModal } from './components/modals';
import { EpubMakerView } from './components/epub';
import { EpubMetadata, EpubPage, EpubGenerateResponse } from './types';
import {
  SIDEBAR_PREFIX,
} from './constants/dnd';



// メインApp
function App() {
  const {
    chapters,
    selectedChapterId,
    selectedPageId,
    selectedPageIds,
    thumbnailSize,
    // プロジェクト状態
    currentProjectPath,
    projectName,
    isModified,
    // チャプター管理
    addChapter,
    removeChapter,
    clearChapters,
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
    movePages,
    selectChapter,
    selectPage,
    togglePageSelection,
    selectPageRange,
    clearPageSelection,
    removeSelectedPages,
    setThumbnailSize,
    undo,
    redo,
    // プロジェクト管理
    markAsSaved,
    resetProject,
    loadProjectState,
    // EPUB_maker
    loadEpubFromDaidori,
    epubPages,
    epubSelectedPageId,
  } = useStore();

  const [isEpubModalOpen, setIsEpubModalOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'grid' | 'spread' | 'epub'>('grid');
  const [isViewerMode, setIsViewerMode] = useState(false);
  const [spreadZoom, setSpreadZoom] = useState(100);
  const [isPageBarVisible, setIsPageBarVisible] = useState(() => {
    // 初期状態をlocalStorageから復元（デフォルトは表示）
    const saved = localStorage.getItem('daidori_pagebar_visible');
    return saved !== 'false';
  });
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'view' | 'size' | 'binding' | null>(null);
  const viewDropdownRef = useRef<HTMLDivElement>(null);
  const sizeDropdownRef = useRef<HTMLDivElement>(null);
  const bindingDropdownRef = useRef<HTMLDivElement>(null);
  const [isSidebarFlipped, setIsSidebarFlipped] = useState(() => {
    const saved = localStorage.getItem('daidori_sidebar_flipped');
    return saved === 'true';
  });
  const [bindingDirection, setBindingDirection] = useState<'rtl' | 'ltr'>(() => {
    const saved = localStorage.getItem('daidori_binding_direction');
    return saved === 'ltr' ? 'ltr' : 'rtl';
  });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // 初期状態をlocalStorageから復元（デフォルトはダークモード）
    const saved = localStorage.getItem('daidori_dark_mode');
    return saved !== 'false'; // 明示的にfalseでない限りダークモード
  });
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [fileDropTargetPageId, setFileDropTargetPageId] = useState<string | null>(null);
  const [fileDropMode, setFileDropMode] = useState<'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null>(null);
  const [fileDropTargetChapterId, setFileDropTargetChapterId] = useState<string | null>(null);
  const [insertPosition, setInsertPosition] = useState<'before' | 'after' | null>(null);
  // プレビューエリアのチャプター折りたたみ状態（チャプターID -> 折りたたみ状態）
  const [previewCollapsedChapters, setPreviewCollapsedChapters] = useState<Set<string>>(new Set());

  // プロジェクト名編集

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


  // プロジェクト関連のstate
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | 'close' | null>(null);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [missingFiles, setMissingFiles] = useState<FileValidationResult[]>([]);
  const [showMissingFilesDialog, setShowMissingFilesDialog] = useState(false);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    show: boolean;
    type: 'chapter' | 'all';
    chapterId?: string;
    chapterName?: string;
    pageCount?: number;
  }>({ show: false, type: 'chapter' });

  // スプラッシュウィンドウを閉じてメインウィンドウを表示
  useEffect(() => {
    invoke('close_splash').catch(console.error);
  }, []);

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

  const {
    isExportModalOpen,
    bleedEditorState,
    exportResultDialog,
    openExportModal,
    closeExportModal,
    handlePreExport,
    handleBleedApply,
    handleBleedSkip,
    handleBleedCancel,
    setExportResultDialog,
    closeExportResultDialog,
  } = useExport(chapters, allPages);

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

  // 現在の状態をプロジェクトファイル形式に変換（loadFromProjectFileの逆）
  const buildProjectFile = (savePath: string): DaidoriProjectFile => {
    const basePath = savePath.replace(/[\\\/][^\\\/]+$/, '');
    const savedChapters: SavedChapter[] = chapters.map(ch => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      folderPath: ch.folderPath,
      pages: ch.pages.map(page => {
        const savedPage: SavedPage = {
          id: page.id,
          pageType: page.pageType,
          label: page.label,
        };
        if (page.filePath && page.fileName) {
          // 相対パスを計算
          let relativePath = page.filePath;
          if (page.filePath.startsWith(basePath)) {
            relativePath = page.filePath.slice(basePath.length).replace(/^[\\\/]/, '');
          }
          const fileRef: SavedFileReference = {
            absolutePath: page.filePath,
            relativePath,
            fileName: page.fileName,
            fileType: page.fileType || 'png',
            fileSize: page.fileSize || 0,
            modifiedTime: page.modifiedTime || 0,
          };
          savedPage.file = fileRef;
        }
        return savedPage;
      }),
    }));

    return {
      version: '1.0',
      name: projectName,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      basePath,
      chapters: savedChapters,
      uiState: {
        selectedChapterId,
        selectedPageId,
        viewMode: 'all',
        thumbnailSize,
        collapsedChapterIds: chapters.filter(c => c.collapsed).map(c => c.id),
      },
    };
  };

  // プロジェクト保存
  const handleSaveProject = async () => {
    if (currentProjectPath) {
      try {
        const project = buildProjectFile(currentProjectPath);
        await invoke('save_project', { filePath: currentProjectPath, project });
        markAsSaved(currentProjectPath);
      } catch (error) {
        console.error('保存エラー:', error);
        alert(`保存に失敗しました: ${error}`);
      }
    } else {
      await handleSaveProjectAs();
    }
  };

  // 名前を付けて保存
  const handleSaveProjectAs = async () => {
    try {
      const filePath = await save({
        filters: [{ name: '台割プロジェクト', extensions: ['daidori'] }],
        defaultPath: currentProjectPath || `${projectName}.daidori`,
      });
      if (!filePath) return;

      const project = buildProjectFile(filePath);
      await invoke('save_project', { filePath, project });
      markAsSaved(filePath);
      const name = filePath.split(/[\\\/]/).pop()?.replace(/\.daidori$/, '') || projectName;
      await invoke('add_recent_file', { path: filePath, name });
    } catch (error) {
      console.error('保存エラー:', error);
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


  // 未保存確認後のアクション実行
  const handleUnsavedDialogAction = async (action: 'save' | 'discard' | 'cancel') => {
    setShowUnsavedDialog(false);
    if (action === 'cancel') {
      setPendingAction(null);
      setPendingOpenPath(null);
      return;
    }

    // 保存してから続行
    if (action === 'save') {
      await handleSaveProject();
    }

    if (pendingAction === 'new') {
      resetProject();
    } else if (pendingAction === 'open') {
      await handleOpenProject(pendingOpenPath || undefined);
    } else if (pendingAction === 'close') {
      await getCurrentWindow().destroy();
    }

    setPendingAction(null);
    setPendingOpenPath(null);
  };


  // ダークモード切替の適用
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
    localStorage.setItem('daidori_dark_mode', isDarkMode ? 'true' : 'false');
  }, [isDarkMode]);

  // サイドバー反転の適用
  useEffect(() => {
    if (isSidebarFlipped) {
      document.body.classList.add('sidebar-flipped');
    } else {
      document.body.classList.remove('sidebar-flipped');
    }
    localStorage.setItem('daidori_sidebar_flipped', isSidebarFlipped ? 'true' : 'false');
  }, [isSidebarFlipped]);

  // 綴じ方向の永続化
  useEffect(() => {
    localStorage.setItem('daidori_binding_direction', bindingDirection);
  }, [bindingDirection]);

  // ハンバーガーメニューのEscキー閉じ
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isMenuOpen]);

  // ヘッダードロップダウンの外側クリックで閉じる
  useEffect(() => {
    if (!openDropdown) return;
    const handleClick = (e: MouseEvent) => {
      const refs = { view: viewDropdownRef, size: sizeDropdownRef, binding: bindingDropdownRef };
      const ref = refs[openDropdown];
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openDropdown]);

  // 閲覧モード切替の適用（body classを追加/削除）
  useEffect(() => {
    if (isViewerMode) {
      document.body.classList.add('viewer-mode');
    } else {
      document.body.classList.remove('viewer-mode');
    }
    return () => {
      document.body.classList.remove('viewer-mode');
    };
  }, [isViewerMode]);

  // ダークモードトグル
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  // ウィンドウ終了時の未保存確認
  const handleWindowClose = useCallback(() => {
    setPendingAction('close');
    setShowUnsavedDialog(true);
  }, []);
  useWindowCloseHandler(isModified, handleWindowClose);

  // チャプター削除（確認ダイアログ付き）
  const handleDeleteChapter = useCallback((chapterId: string) => {
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;

    if (chapter.pages.length > 0) {
      // カスタム確認ダイアログを表示
      setDeleteConfirmDialog({
        show: true,
        type: 'chapter',
        chapterId,
        chapterName: chapter.name,
        pageCount: chapter.pages.length,
      });
      return;
    }
    removeChapter(chapterId);
  }, [chapters, removeChapter]);

  // EPUBモード中にchaptersが変更されたら自動同期
  useEffect(() => {
    if (previewMode === 'epub') {
      loadEpubFromDaidori();
    }
  }, [previewMode, chapters, loadEpubFromDaidori]);

  // キーボードショートカット
  useKeyboardShortcuts({
    selectedChapterId,
    selectedPageId,
    selectedPageIds,
    chapters,
    allPages,
    previewMode,
    isModified,
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
    setPendingAction,
    setShowUnsavedDialog,
    onSave: handleSaveProject,
    onSaveAs: handleSaveProjectAs,
  });

  const {
    sensors,
    activeId,
    activeDragType,
    dropTarget,
    draggedPageIds,
    customCollisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useDragHandlers({
    chapters,
    allPages,
    selectedPageIds,
    reorderChapters,
    reorderPages,
    movePage,
    movePages,
    addChapter,
    selectChapter,
  });

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
        // 複数フォルダ対応: フォルダごとにファイル情報を取得
        const folderSet = new Set<string>();
        for (const s of selected) {
          const folder = s.replace(/[^\\/]+$/, '');
          if (folder) folderSet.add(folder);
        }
        if (folderSet.size === 0) {
          console.error('Invalid folder path');
          return;
        }

        let allFiles: FileInfo[] = [];
        for (const folder of folderSet) {
          const files: FileInfo[] = await invoke('get_folder_contents', { folderPath: folder });
          allFiles.push(...files);
        }

        const selectedFiles = allFiles.filter((f) =>
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

  // EPUB生成ハンドラ
  const handleEpubGenerate = async (metadata: EpubMetadata, outputPath: string) => {
    try {
      // ページ情報を構築
      const epubPages: EpubPage[] = [];
      let pageNumber = 1;

      for (const chapter of chapters) {
        for (const page of chapter.pages) {
          // ファイルページのみ（白紙はスキップ）
          if (page.pageType === 'blank' || !page.filePath) {
            continue;
          }

          // 画像サイズを取得
          let width = metadata.viewportWidth;
          let height = metadata.viewportHeight;
          try {
            const dimensions = await invoke<[number, number]>('get_image_dimensions', {
              path: page.filePath,
            });
            width = dimensions[0];
            height = dimensions[1];
          } catch {
            console.warn(`画像サイズ取得失敗: ${page.filePath}`);
          }

          // ページIDを生成
          const pageId = page.pageType === 'cover'
            ? 'p-cover'
            : page.pageType === 'colophon'
            ? 'p-colophon'
            : `p-${String(pageNumber).padStart(3, '0')}`;

          // ファイル名を生成
          const ext = page.filePath.split('.').pop()?.toLowerCase() || 'jpg';
          const filename = page.pageType === 'cover'
            ? `cover.${ext}`
            : page.pageType === 'colophon'
            ? `colophon.${ext}`
            : `${String(pageNumber).padStart(4, '0')}.${ext}`;

          epubPages.push({
            id: pageId,
            filename,
            sourcePath: page.filePath,
            width,
            height,
            isCover: page.pageType === 'cover',
            isColophon: page.pageType === 'colophon',
          });

          if (page.pageType !== 'cover' && page.pageType !== 'colophon') {
            pageNumber++;
          }
        }
      }

      // EPUB生成
      const response = await invoke<EpubGenerateResponse>('generate_epub', {
        metadata,
        pages: epubPages,
        outputPath,
        customCss: null,
      });

      if (response.success) {
        // ファイルサイズを人間が読みやすい形式に
        const fileSizeMB = (response.fileSize / (1024 * 1024)).toFixed(2);
        setExportResultDialog({
          show: true,
          title: 'EPUB生成完了',
          message: `EPUBを生成しました\n${response.pageCount}ページ / ${fileSizeMB}MB`,
          outputDir: outputPath,
        });
        setIsEpubModalOpen(false);
      } else {
        setExportResultDialog({
          show: true,
          title: 'EPUB生成失敗',
          message: response.error || 'EPUB生成中にエラーが発生しました',
          isError: true,
        });
      }
    } catch (error) {
      console.error('EPUB生成エラー:', error);
      setExportResultDialog({
        show: true,
        title: 'EPUB生成失敗',
        message: `エラー: ${error}`,
        isError: true,
      });
    }
  };


  const displayPages = allPages;

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

      // ファイル情報を取得（複数フォルダ対応）
      const folderSet = new Set<string>();
      for (const p of imagePaths) {
        const folder = p.replace(/[^\\/]+$/, '');
        if (folder) folderSet.add(folder);
      }
      let allDropFiles: FileInfo[] = [];
      for (const folder of folderSet) {
        const files: FileInfo[] = await invoke('get_folder_contents', { folderPath: folder });
        allDropFiles.push(...files);
      }

      const droppedFiles = allDropFiles.filter((f) =>
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
  useTauriFileDrop();

  return (
    <>
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
            <div className="main-header-row" data-tauri-drag-region>
              {/* アプリアイコン */}
              <img src="/logo/daidori_icon.png" alt="台割マネージャー" className="app-icon" />

              {/* ハンバーガーメニューボタン */}
              <button
                className="hamburger-menu-btn"
                onClick={() => setIsMenuOpen(true)}
                title="メニュー"
              >
                <HamburgerIcon size={18} />
              </button>

              {/* ツールバー折りたたみボタン */}
              <button
                className="toolbar-collapse-btn"
                onClick={() => setIsToolbarCollapsed(!isToolbarCollapsed)}
                title={isToolbarCollapsed ? 'ツールバーを展開' : 'ツールバーを折りたたむ'}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" className={`collapse-icon ${isToolbarCollapsed ? 'collapsed' : ''}`}>
                  <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              <div className="header-divider" />
              {/* 表示モードドロップダウン */}
              <div className="header-popup-container" ref={viewDropdownRef}>
                <button
                  className={`header-popup-trigger ${openDropdown === 'view' ? 'open' : ''}`}
                  onClick={() => setOpenDropdown(openDropdown === 'view' ? null : 'view')}
                >
                  {previewMode === 'grid' ? <GridViewIcon size={14} /> : previewMode === 'spread' ? <BookOpenIcon size={14} /> : <BookIcon size={14} />}
                  <span>{previewMode === 'grid' ? 'リスト' : previewMode === 'spread' ? '見開き' : 'EPUB'}</span>
                  <svg className="header-popup-chevron" width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <div className={`header-popup-menu ${openDropdown === 'view' ? 'open' : ''}`}>
                  <div className="header-popup-header">表示</div>
                  <button className={`header-popup-item ${previewMode === 'grid' ? 'selected' : ''}`} onClick={() => { setPreviewMode('grid'); setOpenDropdown(null); }}>
                    <GridViewIcon size={16} />
                    <span>リスト</span>
                    {previewMode === 'grid' && <span className="header-popup-check"><CheckIcon2 /></span>}
                  </button>
                  <button className={`header-popup-item ${previewMode === 'spread' ? 'selected' : ''}`} onClick={() => { setPreviewMode('spread'); setOpenDropdown(null); }}>
                    <BookOpenIcon size={16} />
                    <span>見開き</span>
                    {previewMode === 'spread' && <span className="header-popup-check"><CheckIcon2 /></span>}
                  </button>
                  <button className={`header-popup-item ${previewMode === 'epub' ? 'selected' : ''}`} onClick={() => { loadEpubFromDaidori(); setPreviewMode('epub'); setOpenDropdown(null); }}>
                    <BookIcon size={16} />
                    <span>EPUB</span>
                    {previewMode === 'epub' && <span className="header-popup-check"><CheckIcon2 /></span>}
                  </button>
                </div>
              </div>

              <div className="header-divider" />
              {/* サイズドロップダウン */}
              <div className="header-popup-container" ref={sizeDropdownRef}>
                <button
                  className={`header-popup-trigger ${openDropdown === 'size' ? 'open' : ''}`}
                  onClick={() => setOpenDropdown(openDropdown === 'size' ? null : 'size')}
                  disabled={previewMode !== 'grid' || chapters.length === 0}
                >
                  <span>{THUMBNAIL_SIZES[thumbnailSize].label}</span>
                  <svg className="header-popup-chevron" width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <div className={`header-popup-menu ${openDropdown === 'size' ? 'open' : ''}`}>
                  <div className="header-popup-header">サイズ</div>
                  {(Object.keys(THUMBNAIL_SIZES) as ThumbnailSize[]).map((size) => (
                    <button key={size} className={`header-popup-item ${thumbnailSize === size ? 'selected' : ''}`} onClick={() => { setThumbnailSize(size); setOpenDropdown(null); }}>
                      <span>{THUMBNAIL_SIZES[size].label}</span>
                      {thumbnailSize === size && <span className="header-popup-check"><CheckIcon2 /></span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="header-divider" />
              {/* 綴じ方向ドロップダウン */}
              <div className="header-popup-container" ref={bindingDropdownRef}>
                <button
                  className={`header-popup-trigger ${openDropdown === 'binding' ? 'open' : ''}`}
                  onClick={() => setOpenDropdown(openDropdown === 'binding' ? null : 'binding')}
                  disabled={previewMode === 'grid'}
                >
                  {bindingDirection === 'rtl' ? <BindingRightIcon size={14} /> : <BindingLeftIcon size={14} />}
                  <span>{bindingDirection === 'rtl' ? '右綴じ' : '左綴じ'}</span>
                  <svg className="header-popup-chevron" width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <div className={`header-popup-menu ${openDropdown === 'binding' ? 'open' : ''}`}>
                  <div className="header-popup-header">綴じ方向</div>
                  <button className={`header-popup-item ${bindingDirection === 'rtl' ? 'selected' : ''}`} onClick={() => { setBindingDirection('rtl'); setOpenDropdown(null); }}>
                    <BindingRightIcon size={16} />
                    <span>右綴じ</span>
                    {bindingDirection === 'rtl' && <span className="header-popup-check"><CheckIcon2 /></span>}
                  </button>
                  <button className={`header-popup-item ${bindingDirection === 'ltr' ? 'selected' : ''}`} onClick={() => { setBindingDirection('ltr'); setOpenDropdown(null); }}>
                    <BindingLeftIcon size={16} />
                    <span>左綴じ</span>
                    {bindingDirection === 'ltr' && <span className="header-popup-check"><CheckIcon2 /></span>}
                  </button>
                </div>
              </div>

              <div className="header-divider" />
              <div className="zoom-controls">
                <button
                  className="btn-icon btn-small"
                  onClick={() => setSpreadZoom(Math.min(200, spreadZoom + 10))}
                  disabled={previewMode === 'grid' || spreadZoom >= 200}
                  title="ズームイン"
                >
                  <ZoomInIcon size={16} />
                </button>
                <span className={`zoom-value ${previewMode === 'grid' ? 'disabled' : ''}`}>{spreadZoom}%</span>
                <button
                  className="btn-icon btn-small"
                  onClick={() => setSpreadZoom(Math.max(50, spreadZoom - 10))}
                  disabled={previewMode === 'grid' || spreadZoom <= 50}
                  title="ズームアウト"
                >
                  <ZoomOutIcon size={16} />
                </button>
              </div>

              {/* ウィンドウコントロールボタン（右側） */}
              <div className="window-controls">
                <button
                  className="window-control-btn minimize"
                  onClick={async () => { await getCurrentWindow().minimize(); }}
                  title="最小化"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                </button>
                <button
                  className="window-control-btn maximize"
                  onClick={async () => { await getCurrentWindow().toggleMaximize(); }}
                  title="最大化"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  </svg>
                </button>
                <button
                  className="window-control-btn close"
                  onClick={async () => { await getCurrentWindow().close(); }}
                  title="閉じる"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5"/>
                    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className={`toolbar-content ${isToolbarCollapsed ? 'collapsed' : ''}`}>
              {selectedPageIds.length > 1 && (
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
              )}

              <button
                className="export-btn"
                onClick={handleSaveProject}
                title="保存 (Ctrl+S)"
                disabled={!isModified}
                style={{ width: 32, height: 32, border: '1px solid var(--color-border)', borderRadius: '25%' }}
              >
                <SaveIcon size={16} />
              </button>

              <button
                className="export-btn"
                onClick={() => openExportModal()}
                title="エクスポート"
                disabled={allPages.length === 0}
              >
                <ExportIcon size={18} />
              </button>

              <button
                className="btn-epub"
                onClick={() => setIsEpubModalOpen(true)}
                title="EPUBを生成"
                disabled={allPages.length === 0}
              >
                <BookIcon size={14} />
              </button>

              <button
                className="viewer-mode-btn"
                onClick={() => setIsViewerMode(true)}
                title="閲覧モード (F1)"
                disabled={previewMode === 'grid' || displayPages.length === 0}
              >
                <MonitorIcon size={14} />
              </button>
              <button
                className="viewer-mode-btn"
                onClick={() => {
                  const newValue = !isPageBarVisible;
                  setIsPageBarVisible(newValue);
                  localStorage.setItem('daidori_pagebar_visible', String(newValue));
                }}
                title={isPageBarVisible ? 'ページバーを隠す' : 'ページバーを表示'}
                disabled={previewMode === 'grid'}
              >
                {isPageBarVisible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
              </button>

              {/* Photoshopで開くボタン */}
              {(() => {
                // EPUBモード時はepubPagesから、それ以外はallPagesから選択ページを取得
                let psdPaths: string[] = [];

                if (previewMode === 'epub') {
                  const selected = epubSelectedPageId
                    ? epubPages.find(p => p.id === epubSelectedPageId)
                    : null;
                  if (selected?.sourcePath?.toLowerCase().endsWith('.psd')) {
                    psdPaths = [selected.sourcePath];
                  }
                } else {
                  const selectedPages = selectedPageIds.length > 0
                    ? allPages.filter(p => selectedPageIds.includes(p.page.id))
                    : selectedPageId
                      ? allPages.filter(p => p.page.id === selectedPageId)
                      : [];
                  const psdPages = selectedPages.filter(p => p.page.filePath?.toLowerCase().endsWith('.psd'));
                  if (psdPages.length > 0 && psdPages.length === selectedPages.length) {
                    psdPaths = psdPages.map(p => p.page.filePath!);
                  }
                }

                return (
                  <button
                    className="photoshop-btn"
                    onClick={async () => {
                      for (const path of psdPaths) {
                        try {
                          await invoke('open_file_with_default_app', { filePath: path });
                        } catch (error) {
                          console.error('ファイルを開けませんでした:', error);
                        }
                      }
                    }}
                    title={psdPaths.length > 1 ? `Photoshopで開く (${psdPaths.length})` : 'Photoshopで開く'}
                    disabled={psdPaths.length === 0}
                  >
                    <span className="photoshop-label">Ps</span>
                  </button>
                );
              })()}
            </div>
          </div>

          {/* モードに応じたコンテンツ表示 */}
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
                  {chapters.length === 0 ? (
                    <div className="sidebar-empty-state">
                      <PlusCircleIcon size={48} />
                      <p>チャプターをここで追加</p>
                    </div>
                  ) : (
                    <>
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
                          selectChapter(selectedChapterId === chapter.id ? null : chapter.id);
                          selectPage(null);
                        }}
                        onSelectPage={(pageId) => {
                          if (selectedPageId === pageId) {
                            selectPage(null);
                          } else {
                            selectChapter(chapter.id);
                            selectPage(pageId);
                          }
                        }}
                        onToggle={() => toggleChapterCollapsed(chapter.id)}
                        onRename={(name) => renameChapter(chapter.id, name)}
                        onDelete={() => handleDeleteChapter(chapter.id)}
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
                    </>
                  )}
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
                <button
                  className="btn-secondary btn-small btn-clear-all"
                  onClick={() => {
                    if (chapters.length === 0) return;
                    setDeleteConfirmDialog({
                      show: true,
                      type: 'all',
                      pageCount: allPages.length,
                    });
                  }}
                  disabled={chapters.length === 0}
                >
                  <TrashIcon size={14} />
                  すべてクリア
                </button>
              </div>
            </aside>

            {previewMode === 'epub' ? (
              <EpubMakerView
                zoom={spreadZoom}
                onZoomChange={setSpreadZoom}
                isViewerMode={isViewerMode}
                onExitViewerMode={() => setIsViewerMode(false)}
                isPageBarVisible={isPageBarVisible}
                bindingDirection={bindingDirection}
              />
            ) : (
            <div className="preview-area" ref={previewAreaRef}>
              {previewMode === 'spread' ? (
              <SpreadViewer
                key={displayPages.map(p => p.page.id).join(',')}
                pages={displayPages}
                selectedPageId={selectedPageId}
                onPageSelect={(chapterId, pageId) => {
                  if (selectedPageId === pageId) {
                    selectPage(null);
                  } else {
                    selectChapter(chapterId);
                    selectPage(pageId);
                  }
                }}
                isViewerMode={isViewerMode}
                onExitViewerMode={() => setIsViewerMode(false)}
                isPageBarVisible={isPageBarVisible}
                zoom={spreadZoom}
                onZoomChange={setSpreadZoom}
                bindingDirection={bindingDirection}
              />
            ) : (
              <div className="thumbnail-grid-container">
                {chapters.length === 0 ? (
                  <div className="spread-viewer-empty">
                    <NoPageIcon size={48} />
                    <p>ページがありません。チャプターを追加してください</p>
                  </div>
                ) : (
                <SortableContext
                  items={displayPages.map((p) => p.page.id)}
                  strategy={rectSortingStrategy}
                >
                  {/* 新規チャプター作成ゾーン（先頭・外部ファイルドラッグ時） */}
                  {isDraggingFiles && (
                    <div className={`new-chapter-drop-zone start ${fileDropMode === 'new-chapter-start' ? 'active' : ''}`}>
                      <div className="new-chapter-drop-content">
                        <span className="new-chapter-icon"><PlusIcon size={16} /></span>
                        <span className="new-chapter-text">先頭に新しいチャプターを作成</span>
                      </div>
                    </div>
                  )}
                      <div
                        className="thumbnail-grid-continuous"
                        onClick={(e) => {
                          // thumbnail-card以外の領域をクリックした場合は選択解除
                          const target = e.target as HTMLElement;
                          if (!target.closest('.thumbnail-card')) {
                            selectPage(null);
                          }
                        }}
                      >
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
                                                  if (selectedPageId === item.page.id) {
                                                    selectPage(null);
                                                  } else {
                                                    selectChapter(item.chapter.id);
                                                    selectPage(item.page.id);
                                                  }
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
                </SortableContext>
                )}
              </div>
            )}
            </div>
            )}
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
            <DragOverlaySidebarItem page={activePageData.page} dragCount={draggedPageIds.length} />
          ) : (
            <DragOverlayThumbnail
              page={activePageData.page}
              thumbnailSize={thumbnailSizeValue}
              dragCount={draggedPageIds.length}
            />
          )
        ) : null}
      </DragOverlay>

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={closeExportModal}
        onExport={handlePreExport}
        chapters={chapters}
      />

      {/* 断ち切りエディタ（表紙） */}
      <BleedEditorModal
        isOpen={bleedEditorState.currentStep === 'cover' && !!bleedEditorState.coverPsd}
        label="表紙"
        thumbnailPath={bleedEditorState.coverPsd?.thumbnailPath || ''}
        originalFilePath={bleedEditorState.coverPsd?.filePath || ''}
        onApply={handleBleedApply}
        onSkip={handleBleedSkip}
        onCancel={handleBleedCancel}
      />

      {/* 断ち切りエディタ（本文） */}
      <BleedEditorModal
        isOpen={bleedEditorState.currentStep === 'body' && !!bleedEditorState.bodyPsd}
        label="本文"
        thumbnailPath={bleedEditorState.bodyPsd?.thumbnailPath || ''}
        originalFilePath={bleedEditorState.bodyPsd?.filePath || ''}
        onApply={handleBleedApply}
        onSkip={handleBleedSkip}
        onCancel={handleBleedCancel}
      />

      <EpubMetadataModal
        isOpen={isEpubModalOpen}
        onClose={() => setIsEpubModalOpen(false)}
        onGenerate={handleEpubGenerate}
        chapters={chapters}
        projectName={projectName}
      />

      {/* 未保存確認ダイアログ */}
      {showUnsavedDialog && (
        <div className="modal-overlay">
          <div className="modal-content unsaved-dialog">
            <h2>未保存の変更があります</h2>
            <p>「{projectName}」への変更を保存しますか？</p>
            <div className="modal-footer">
              <button className="btn-secondary btn-small" onClick={() => handleUnsavedDialogAction('cancel')}>
                キャンセル
              </button>
              <button className="btn-danger btn-small" onClick={() => handleUnsavedDialogAction('discard')}>
                破棄する
              </button>
              <button className="btn-primary btn-small" onClick={() => handleUnsavedDialogAction('save')}>
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
              <button className="btn-primary btn-small" onClick={() => setShowMissingFilesDialog(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* エクスポート結果ダイアログ */}
      {exportResultDialog.show && (
        <div className="modal-overlay">
          <div className={`modal-content export-result-dialog ${exportResultDialog.isError ? 'has-error' : ''}`}>
            <h2>{exportResultDialog.title}</h2>
            <p className="export-result-message">{exportResultDialog.message}</p>
            {exportResultDialog.details && (
              <div className="export-result-details">
                <pre>{exportResultDialog.details}</pre>
              </div>
            )}
            {exportResultDialog.outputDir && (
              <p className="export-result-output">
                出力先: <span className="output-path">{exportResultDialog.outputDir}</span>
              </p>
            )}
            <div className="modal-footer">
              {exportResultDialog.outputDir && (
                <button
                  className="btn-secondary btn-small"
                  onClick={async () => {
                    try {
                      await invoke('open_file_with_default_app', { filePath: exportResultDialog.outputDir });
                    } catch (e) {
                      console.error('フォルダを開けませんでした:', e);
                    }
                  }}
                >
                  フォルダを開く
                </button>
              )}
              {exportResultDialog.outputDir && !exportResultDialog.isError && exportResultDialog.exportedPages && (
                <button
                  className="btn-epub btn-small"
                  onClick={() => {
                    closeExportResultDialog();
                    setIsEpubModalOpen(true);
                  }}
                >
                  <BookIcon size={14} />
                  EPUBを生成
                </button>
              )}
              <button
                className="btn-primary btn-small"
                onClick={closeExportResultDialog}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* チャプター削除確認ダイアログ */}
      {deleteConfirmDialog.show && (
        <div className="modal-overlay">
          <div className="modal-content delete-confirm-dialog">
            <h2>
              {deleteConfirmDialog.type === 'all' ? 'すべて削除' : 'チャプター削除'}
            </h2>
            <p>
              {deleteConfirmDialog.type === 'all'
                ? `すべてのチャプター（${chapters.length}件、${deleteConfirmDialog.pageCount}ページ）を削除しますか？`
                : `「${deleteConfirmDialog.chapterName}」（${deleteConfirmDialog.pageCount}ページ）を削除しますか？`
              }
            </p>
            <p className="delete-warning">この操作は取り消せます（Ctrl+Z）</p>
            <div className="modal-footer">
              <button
                className="btn-secondary btn-small"
                onClick={() => setDeleteConfirmDialog({ show: false, type: 'chapter' })}
              >
                キャンセル
              </button>
              <button
                className="btn-danger btn-small"
                onClick={() => {
                  if (deleteConfirmDialog.type === 'all') {
                    clearChapters();
                  } else if (deleteConfirmDialog.chapterId) {
                    removeChapter(deleteConfirmDialog.chapterId);
                  }
                  setDeleteConfirmDialog({ show: false, type: 'chapter' });
                }}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ドロップインジケーターバー（外部ファイルドラッグのみ） */}
      {isDraggingFiles && (
        <div className="drop-indicator-bar file-drop">
          <div className="drop-indicator-content">
            <span className="drop-indicator-icon">
              <FolderIcon size={18} />
            </span>
            <span className="drop-indicator-text">
              {fileDropMode === 'insert' && fileDropTargetPageId ? (
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
              )}
            </span>
          </div>
        </div>
      )}
    </DndContext>

    {/* ハンバーガーメニュー */}
    <div
      className={`hamburger-overlay ${isMenuOpen ? 'open' : ''}`}
      onClick={() => setIsMenuOpen(false)}
    />
    <div className={`hamburger-menu ${isMenuOpen ? 'open' : ''}`}>
      <div className="hamburger-menu-header">
        <span className="hamburger-menu-title">メニュー</span>
        <button className="hamburger-menu-close" onClick={() => setIsMenuOpen(false)} title="閉じる">
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="hamburger-menu-body">
      </div>
      <div className="hamburger-menu-footer">
        <button
          className="hamburger-footer-btn"
          onClick={() => setIsSidebarFlipped(!isSidebarFlipped)}
          title={isSidebarFlipped ? 'サイドバーを左に' : 'サイドバーを右に'}
        >
          <FlipIcon size={20} isFlipped={isSidebarFlipped} />
        </button>
        <button
          className="hamburger-footer-btn"
          onClick={toggleDarkMode}
          title={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
        >
          {isDarkMode ? <MoonIcon size={20} /> : <SunIcon size={20} />}
        </button>
        <button
          className="hamburger-footer-btn"
          onClick={() => {}}
          title="環境設定"
        >
          <SettingsIcon size={20} />
        </button>
      </div>
    </div>
    </>
  );
}

export default App;
