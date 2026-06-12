import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { desktopDir, join } from '@tauri-apps/api/path';
import { open, ask, save } from '@tauri-apps/plugin-dialog';
import { useTauriFileDrop } from './hooks/useTauriFileDrop';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { SortingStrategy } from '@dnd-kit/sortable';

// 他のカードを動かさない（自動シフトしない）並べ替えストラテジー
const noShiftStrategy: SortingStrategy = () => null;
import { useStore, FileInfo, THUMBNAIL_SIZES } from './store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useKeyboardShortcuts, useDragHandlers, useExport, resolveBleedRegion, buildProcessOptions, queueThumbnail, useAutoUpdate, scheduleStartupCheck, useModalAnimation, useSlidingIndicator } from './hooks';
import { getVersion } from '@tauri-apps/api/app';
import { describePhysicalSize, findPaperSize, pixelsToMm } from './utils/paperSize';
import { expandPdfFiles } from './utils/pdf';
import { computeSlideDirection } from './utils/slideDirection';
import {
  Chapter,
  ChapterType,
  CHAPTER_TYPE_LABELS,
  CHAPTER_TYPE_COLORS,
  Page,
  PageType,
  FileType,
  FileValidationStatus,
  DaidoriProjectFile,
  EpubMetadata,
  EpubPage,
  EpubGenerateResponse,
  EpubCheckResult,
  EpubInternalCheckResult,
  EpubSplitSettings,
  SavedEpubState,
  SavedEpubVolume,
} from './types';
import { splitVolumeKey } from './utils/epubState';
import {
  FolderIcon,
  PlusIcon,
  PlusCircleIcon,
  SunIcon,
  MoonIcon,
  TrashIcon,
  BookIcon,
  HamburgerIcon,
  FlipIcon,
  CloseIcon,
  GridViewIcon,
  BookOpenIcon,
  NoPageIcon,
  DownloadIcon,
  InfoIcon,
  CheckIcon2,
  AlertTriangleIcon,
  ScissorsIcon,
  ExportIcon,
  OpenProjectIcon,
  SaveIcon,
} from './icons';

// 抽出したコンポーネント
import { SpreadViewer } from './components/preview/SpreadViewer';
import { ViewerControls } from './components/preview/ViewerControls';
import { ThumbnailCard } from './components/preview/ThumbnailCard';
import { ChapterItem } from './components/sidebar';
import {
  DragOverlayThumbnail,
  DragOverlaySidebarItem,
  DragOverlayChapterItem,
  DropPlaceholder,
} from './components/dnd';
import { UpdateDialog, SplitFoldersDialog } from './components/modals';
import type { SplitFolderEntry, SplitFoldersDialogResult, ExportOptions } from './components/modals';
import { BleedTab } from './components/bleed';
import { OutputTab } from './components/output';
import { SlidingIndicator } from './components/SlidingIndicator';
import { useBleedStore } from './bleedStore';
import {
  SIDEBAR_PREFIX,
} from './constants/dnd';



const DRAWN_EXTRA_FOLDER_NAMES = new Set(['全書店', 'シーモア', 'Renta!', 'ebookjapan']);
const getFolderName = (folderPath: string): string => {
  const cleaned = folderPath.replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || folderPath;
};

const getDefaultNameForImportedFolder = (
  folderName: string,
  chapterType: ChapterType,
  fallbackName?: string
): string | undefined => {
  if (chapterType === 'chapter' && DRAWN_EXTRA_FOLDER_NAMES.has(folderName)) {
    return '描き下ろし';
  }
  return fallbackName;
};

const getSubtitleForImportedFolder = (
  folderName: string,
  chapterType: ChapterType
): string | undefined => {
  if (chapterType === 'chapter' && DRAWN_EXTRA_FOLDER_NAMES.has(folderName)) {
    return folderName;
  }
  return undefined;
};

const getChapterDisplayTitle = (
  chapter: Pick<Chapter, 'name' | 'subtitle'>
): { name: string; subtitle?: string } => {
  const inlineDrawnExtraMatch = chapter.name.match(/^描き下ろし（(.+)）$/);
  const inlineDrawnExtraSubtitle = inlineDrawnExtraMatch?.[1];
  const shouldSplitInlineDrawnExtra =
    !!inlineDrawnExtraSubtitle && DRAWN_EXTRA_FOLDER_NAMES.has(inlineDrawnExtraSubtitle);

  return {
    name: !chapter.subtitle && shouldSplitInlineDrawnExtra ? '描き下ろし' : chapter.name,
    subtitle: chapter.subtitle ?? (shouldSplitInlineDrawnExtra ? inlineDrawnExtraSubtitle : undefined),
  };
};

type RustSavedFileReference = {
  absolute_path: string;
  relative_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  modified_time: number;
};

type RustSavedPage = {
  id: string;
  page_type: PageType;
  file?: RustSavedFileReference;
  label?: string;
};

type RustSavedChapter = {
  id: string;
  name: string;
  subtitle?: string;
  type: ChapterType;
  pages: RustSavedPage[];
  folder_path?: string;
};

type RustSavedUiState = {
  selected_chapter_id: string | null;
  selected_page_id: string | null;
  view_mode: 'selection' | 'all';
  thumbnail_size: 'small' | 'medium' | 'large';
  collapsed_chapter_ids: string[];
};

type RustProjectFile = {
  version: '1.0';
  name: string;
  created_at: string;
  modified_at: string;
  base_path: string;
  chapters: RustSavedChapter[];
  ui_state?: RustSavedUiState;
  // EPUB設定（UUID/メタデータ/分割/ページ指定）。Rust側は不透明JSONとして素通しする
  epub_state?: SavedEpubState;
};

type ProjectSaveResult = {
  file_path: string;
  project_dir: string;
  copied_files: number;
};

const PROJECT_FILE_EXTENSION = 'daiw';
const DEFAULT_PROJECT_NAME = '新規プロジェクト';

const normalizeForPathCompare = (path: string): string =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const getParentPath = (filePath: string): string => {
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return index >= 0 ? filePath.slice(0, index) : '';
};

const ensureProjectExtension = (filePath: string): string =>
  filePath.toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`)
    ? filePath
    : `${filePath}.${PROJECT_FILE_EXTENSION}`;

const sanitizeFileName = (name: string): string =>
  (name.trim() || DEFAULT_PROJECT_NAME).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

const buildRelativePath = (absolutePath: string, basePath: string): string => {
  const normalizedAbsolute = normalizeForPathCompare(absolutePath);
  const normalizedBase = normalizeForPathCompare(basePath);
  const absoluteWithForwardSlashes = absolutePath.replace(/\\/g, '/');
  const baseWithForwardSlashes = basePath.replace(/\\/g, '/').replace(/\/+$/, '');

  if (normalizedAbsolute === normalizedBase) {
    return absoluteWithForwardSlashes.split('/').pop() ?? absolutePath;
  }
  if (normalizedAbsolute.startsWith(`${normalizedBase}/`)) {
    return absoluteWithForwardSlashes.slice(baseWithForwardSlashes.length + 1);
  }
  return absolutePath;
};

const resolveSavedPath = (absolutePath: string, relativePath: string, basePath: string): string => {
  if (absolutePath) return absolutePath;
  if (!relativePath) return '';
  if (/^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith('\\\\') || relativePath.startsWith('/')) {
    return relativePath;
  }
  const separator = basePath.includes('\\') ? '\\' : '/';
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${relativePath}`;
};

const readProjectField = <T,>(value: Record<string, unknown>, camelKey: string, snakeKey: string): T | undefined =>
  (value[camelKey] ?? value[snakeKey]) as T | undefined;

const createProjectStateSnapshot = (
  name: string,
  chapters: Chapter[],
  thumbnailSize: 'small' | 'medium' | 'large'
): string => {
  const persistentChapters = chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    subtitle: chapter.subtitle,
    type: chapter.type,
    collapsed: chapter.collapsed,
    folderPath: chapter.folderPath,
    pages: chapter.pages.map((page) => ({
      id: page.id,
      pageType: page.pageType,
      filePath: page.filePath,
      fileName: page.fileName,
      fileType: page.fileType,
      fileSize: page.fileSize,
      modifiedTime: page.modifiedTime,
      label: page.label,
    })),
  }));

  return JSON.stringify({
    name,
    thumbnailSize,
    chapters: persistentChapters,
  });
};

const createEmptyProjectSnapshot = (): string =>
  createProjectStateSnapshot(DEFAULT_PROJECT_NAME, [], 'medium');

const buildProjectFile = (
  filePath: string,
  name: string,
  createdAt: string,
  chapters: Chapter[],
  selectedChapterId: string | null,
  selectedPageId: string | null,
  thumbnailSize: 'small' | 'medium' | 'large',
  epubState: SavedEpubState | null
): RustProjectFile => {
  const basePath = getParentPath(filePath);

  return {
    version: '1.0',
    name: name || DEFAULT_PROJECT_NAME,
    created_at: createdAt,
    modified_at: new Date().toISOString(),
    base_path: basePath,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      subtitle: chapter.subtitle,
      type: chapter.type,
      folder_path: chapter.folderPath,
      pages: chapter.pages.map((page) => ({
        id: page.id,
        page_type: page.pageType,
        label: page.label,
        file: page.filePath
          ? {
              absolute_path: page.filePath,
              relative_path: buildRelativePath(page.filePath, basePath),
              file_name: page.fileName ?? page.filePath.split(/[\\/]/).pop() ?? '',
              file_type: page.fileType ?? 'jpg',
              file_size: page.fileSize ?? 0,
              modified_time: page.modifiedTime ?? 0,
            }
          : undefined,
      })),
    })),
    ui_state: {
      selected_chapter_id: selectedChapterId,
      selected_page_id: selectedPageId,
      view_mode: 'all',
      thumbnail_size: thumbnailSize,
      collapsed_chapter_ids: chapters.filter((chapter) => chapter.collapsed).map((chapter) => chapter.id),
    },
    epub_state: epubState ?? undefined,
  };
};

const restoreProjectFromFile = (project: RustProjectFile | DaidoriProjectFile): {
  name: string;
  createdAt: string;
  basePath: string;
  chapters: Chapter[];
  selectedChapterId: string | null;
  selectedPageId: string | null;
  thumbnailSize: 'small' | 'medium' | 'large';
  collapsedChapterIds: string[];
  epubState: SavedEpubState | null;
} => {
  const rawProject = project as unknown as Record<string, unknown>;
  const epubState =
    (readProjectField<SavedEpubState>(rawProject, 'epubState', 'epub_state') ?? null);
  const name = readProjectField<string>(rawProject, 'name', 'name') ?? DEFAULT_PROJECT_NAME;
  const createdAt = readProjectField<string>(rawProject, 'createdAt', 'created_at') ?? new Date().toISOString();
  const basePath = readProjectField<string>(rawProject, 'basePath', 'base_path') ?? '';
  const rawUiState = (readProjectField<Record<string, unknown>>(rawProject, 'uiState', 'ui_state') ?? {}) as Record<string, unknown>;
  const collapsedChapterIds =
    readProjectField<string[]>(rawUiState, 'collapsedChapterIds', 'collapsed_chapter_ids') ?? [];
  const rawChapters = (readProjectField<Record<string, unknown>[]>(rawProject, 'chapters', 'chapters') ?? []);

  const chapters = rawChapters.map((rawChapter) => {
    const rawPages = (readProjectField<Record<string, unknown>[]>(rawChapter, 'pages', 'pages') ?? []);
    const chapterId = readProjectField<string>(rawChapter, 'id', 'id') ?? crypto.randomUUID();
    const chapter: Chapter = {
      id: chapterId,
      name: readProjectField<string>(rawChapter, 'name', 'name') ?? 'Chapter',
      subtitle: readProjectField<string>(rawChapter, 'subtitle', 'subtitle'),
      type: (readProjectField<ChapterType>(rawChapter, 'type', 'type') ?? 'chapter') as ChapterType,
      collapsed: collapsedChapterIds.includes(chapterId),
      folderPath: readProjectField<string>(rawChapter, 'folderPath', 'folder_path'),
      pages: rawPages.map((rawPage) => {
        const rawFile = readProjectField<Record<string, unknown>>(rawPage, 'file', 'file');
        const filePath = rawFile
          ? resolveSavedPath(
              readProjectField<string>(rawFile, 'absolutePath', 'absolute_path') ?? '',
              readProjectField<string>(rawFile, 'relativePath', 'relative_path') ?? '',
              basePath
            )
          : undefined;

        const page: Page = {
          id: readProjectField<string>(rawPage, 'id', 'id') ?? crypto.randomUUID(),
          pageType: (readProjectField<PageType>(rawPage, 'pageType', 'page_type') ?? 'file') as PageType,
          label: readProjectField<string>(rawPage, 'label', 'label'),
          filePath,
          fileName: rawFile ? readProjectField<string>(rawFile, 'fileName', 'file_name') : undefined,
          fileType: rawFile ? (readProjectField<FileType>(rawFile, 'fileType', 'file_type') as FileType | undefined) : undefined,
          fileSize: rawFile ? readProjectField<number>(rawFile, 'fileSize', 'file_size') : undefined,
          modifiedTime: rawFile ? readProjectField<number>(rawFile, 'modifiedTime', 'modified_time') : undefined,
          thumbnailStatus: filePath ? 'pending' : undefined,
        };
        return page;
      }),
    };
    return chapter;
  });

  const savedThumbnailSize = readProjectField<'small' | 'medium' | 'large'>(rawUiState, 'thumbnailSize', 'thumbnail_size');

  return {
    name,
    createdAt,
    basePath,
    chapters,
    selectedChapterId: readProjectField<string | null>(rawUiState, 'selectedChapterId', 'selected_chapter_id') ?? null,
    selectedPageId: readProjectField<string | null>(rawUiState, 'selectedPageId', 'selected_page_id') ?? null,
    thumbnailSize: savedThumbnailSize ?? 'medium',
    collapsedChapterIds,
    epubState,
  };
};

type ImageSizeGroupInfo = {
  key: string;
  paperLabel: string;
  pixelLabel: string;
  dpiLabel: string;
  physicalLabel: string;
  isException: boolean;
  isStorageSize: boolean;
};

const STORAGE_IMAGE_WIDTH = 1280;
const STORAGE_IMAGE_HEIGHT = 1818;

const getImageSizeGroupInfo = (page: Page): ImageSizeGroupInfo | null => {
  const width = page.imageWidth;
  const height = page.imageHeight;
  const dpi = page.imageDpi;
  if (!width || !height) return null;

  const pixelLabel = `${width}×${height}px`;
  const dpiLabel = dpi && dpi > 0 ? `${dpi}dpi` : 'dpi不明';
  let paperLabel = '例外サイズ';
  let physicalLabel = '実寸不明';
  let isException = true;
  const isStorageSize = width === STORAGE_IMAGE_WIDTH && height === STORAGE_IMAGE_HEIGHT;

  if (dpi && dpi > 0) {
    const { wMm, hMm } = pixelsToMm(width, height, dpi);
    const wMmRound = Math.round(wMm);
    const hMmRound = Math.round(hMm);
    const matched = findPaperSize(wMm, hMm);
    physicalLabel = `${wMmRound}×${hMmRound}mm`;
    if (matched) {
      paperLabel = matched;
      isException = false;
    }
  }

  if (isStorageSize) {
    paperLabel = '格納サイズ';
    isException = false;
  }

  return {
    key: isStorageSize ? `storage-size|${pixelLabel}` : isException ? 'exception-size' : `${paperLabel}|${pixelLabel}|${dpiLabel}`,
    paperLabel,
    pixelLabel,
    dpiLabel,
    physicalLabel,
    isException,
    isStorageSize,
  };
};

// 例外サイズのジャンル分け用カラーパレット（同じ例外サイズには同色を割り当てる）
const EXCEPTION_SIZE_COLORS = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ffa726', '#ab47bc',
  '#26c6da', '#ec407a', '#8d6e63', '#78909c', '#9ccc65',
];

// メインApp
function App() {
  const {
    chapters,
    selectedChapterId,
    selectedPageId,
    selectedPageIds,
    thumbnailSize,
    activeTab,
    setActiveTab,
    // プロジェクト状態
    projectName,
    // チャプター管理
    addChapter,
    removeChapter,
    clearChapters,
    renameChapter,
    updateChapterSubtitle,
    toggleChapterCollapsed,
    reorderChapters,
    duplicateChapter,
    addPagesToChapter,
    replacePagesInChapter,
    addPagesToChapterAt,
    insertChaptersFromFolders,
    addSpecialPage,
    setPageFile,
    refreshPagesLinks,
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
    // ファイル検証
    updatePagesValidation,
    // プロジェクト管理
    resetProject,
    // EPUB生成（handleEpubGenerate がプレビュー上書き情報を参照）
    epubPages,
  } = useStore();

  const [previewMode, setPreviewMode] = useState<'grid' | 'spread'>('grid');
  const [isViewerMode, setIsViewerMode] = useState(false);
  const [spreadZoom, setSpreadZoom] = useState(100);
  const [isPageBarVisible, setIsPageBarVisible] = useState(() => {
    // 初期状態をlocalStorageから復元（デフォルトは表示）
    const saved = localStorage.getItem('daidori_pagebar_visible');
    return saved !== 'false';
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // 断ち切りタブで範囲設定（BleedEditorModal）を開いている間は左の台割ツリーを隠す
  const [isBleedEditing, setIsBleedEditing] = useState(false);
  // セグメント型トグルのスライドインジケーター（工程タブ／台割の表示切替をヌルッと移動）
  const { containerRef: viewTabsRef, rect: tabIndicator } = useSlidingIndicator<HTMLDivElement>(activeTab);
  const { containerRef: composeViewToggleRef, rect: composeViewIndicator } = useSlidingIndicator<HTMLDivElement>(previewMode);
  // 画面遷移の向き: 工程タブが右へ移動したら右から、左へ移動したら左からスライドフェード
  const [screenSlideFrom, setScreenSlideFrom] = useState('0px');
  // 台割のリスト/見開き切替時のスライド方向
  const [composeSlideFrom, setComposeSlideFrom] = useState('0px');
  const handleTabChange = useCallback((tab: typeof activeTab) => {
    if (tab === activeTab) return;
    setScreenSlideFrom(computeSlideDirection(tab, activeTab, ['compose', 'bleed', 'output']));
    setActiveTab(tab);
  }, [activeTab, setActiveTab]);
  // チャプター削除はふわっと退場アニメーションさせてから実際に削除する
  const [exitingChapterIds, setExitingChapterIds] = useState<Set<string>>(new Set());
  const animateRemoveChapter = useCallback((chapterId: string) => {
    setExitingChapterIds((prev) => new Set(prev).add(chapterId));
    window.setTimeout(() => {
      removeChapter(chapterId);
      setExitingChapterIds((prev) => {
        const next = new Set(prev);
        next.delete(chapterId);
        return next;
      });
    }, 230);
  }, [removeChapter]);
  const [isInfoSidebarCollapsed, setIsInfoSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('daidori_info_sidebar_collapsed');
    return saved === 'true';
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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
  const [splitFoldersDialog, setSplitFoldersDialog] = useState<{
    folders: SplitFolderEntry[];
    targetChapterId: string;
    open: boolean;
  } | null>(null);
  const closeSplitFoldersDialog = () => {
    setSplitFoldersDialog((prev) => (prev ? { ...prev, open: false } : null));
    setTimeout(() => setSplitFoldersDialog(null), 300);
  };
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [fileDropTargetPageId, setFileDropTargetPageId] = useState<string | null>(null);
  const [fileDropMode, setFileDropMode] = useState<'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null>(null);
  const [fileDropTargetChapterId, setFileDropTargetChapterId] = useState<string | null>(null);
  const [insertPosition, setInsertPosition] = useState<'before' | 'after' | null>(null);
  // プレビューエリアのチャプター折りたたみ状態（チャプターID -> 折りたたみ状態）
  const [previewCollapsedChapters, setPreviewCollapsedChapters] = useState<Set<string>>(new Set());

  // カラーモードサマリー: ホバー中のカラーモード（非該当ページはdim表示）
  const [hoveredColorMode, setHoveredColorMode] = useState<string | null>(null);
  const [hoveredImageSizeKey, setHoveredImageSizeKey] = useState<string | null>(null);
  // カラーモードサマリー展開状態（localStorage永続化）
  const [isColorSummaryExpanded, setIsColorSummaryExpanded] = useState(() => {
    const saved = localStorage.getItem('daidori_color_summary_expanded');
    return saved !== 'false';
  });
  useEffect(() => {
    localStorage.setItem('daidori_color_summary_expanded', String(isColorSummaryExpanded));
  }, [isColorSummaryExpanded]);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const cancelHoverClose = useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);
  const scheduleHoverClose = useCallback(() => {
    cancelHoverClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setHoveredColorMode(null);
      setHoveredImageSizeKey(null);
      hoverCloseTimerRef.current = null;
    }, 180);
  }, [cancelHoverClose]);
  const handleBadgeEnter = useCallback((mode: string) => {
    cancelHoverClose();
    setHoveredImageSizeKey(null);
    setHoveredColorMode(mode);
  }, [cancelHoverClose]);
  const handleImageSizeBadgeEnter = useCallback((key: string) => {
    cancelHoverClose();
    setHoveredColorMode(null);
    setHoveredImageSizeKey(key);
  }, [cancelHoverClose]);

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
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    show: boolean;
    type: 'chapter' | 'all' | 'pages';
    chapterId?: string;
    chapterName?: string;
    pageCount?: number;
  }>({ show: false, type: 'chapter' });
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [projectCreatedAt, setProjectCreatedAt] = useState(() => new Date().toISOString());
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
  const projectStateSnapshot = useMemo(
    () => createProjectStateSnapshot(projectName, chapters, thumbnailSize),
    [projectName, chapters, thumbnailSize]
  );
  const isProjectDirty = lastSavedSnapshot === null
    ? chapters.length > 0
    : projectStateSnapshot !== lastSavedSnapshot;
  const hasUnsavedProjectContent = currentProjectPath === null && chapters.length > 0;
  const shouldConfirmUnsavedChanges = chapters.length > 0 && (isProjectDirty || hasUnsavedProjectContent);

  useEffect(() => {
    if (lastSavedSnapshot === null) {
      setLastSavedSnapshot(projectStateSnapshot);
    }
  }, [lastSavedSnapshot, projectStateSnapshot]);

  // ウィンドウ終了確認ダイアログ
  const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false);
  const closeConfirmAnim = useModalAnimation(showCloseConfirmDialog);
  const deleteConfirmAnim = useModalAnimation(deleteConfirmDialog.show);
  // 「開く / 新規」で未保存変更を破棄するか確認するカスタムダイアログ（Promiseでインラインawaitに対応）
  const [showDiscardConfirmDialog, setShowDiscardConfirmDialog] = useState(false);
  const discardConfirmAnim = useModalAnimation(showDiscardConfirmDialog);
  const discardConfirmResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const resolveDiscardConfirm = useCallback((ok: boolean) => {
    setShowDiscardConfirmDialog(false);
    const resolve = discardConfirmResolveRef.current;
    discardConfirmResolveRef.current = null;
    resolve?.(ok);
  }, []);
  // exportResultDialog はuseExport フック内で管理されているので useModalAnimation 適用は後で（ローカル useEffect で）

  // ウィンドウクローズ要求のインターセプト
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;
    (async () => {
      try {
        const win = getCurrentWindow();
        const fn = await win.onCloseRequested((event) => {
          if (shouldConfirmUnsavedChanges) {
            event.preventDefault();
            setShowCloseConfirmDialog(true);
          }
        });
        if (mounted) {
          unlisten = fn;
        } else {
          fn();
        }
      } catch (e) {
        console.error('ウィンドウクローズ監視の登録に失敗:', e);
      }
    })();
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [shouldConfirmUnsavedChanges]);

  const handleConfirmClose = async () => {
    setShowCloseConfirmDialog(false);
    try {
      // destroy() は onCloseRequested を発火させずに即座に閉じる
      await getCurrentWindow().destroy();
    } catch (e) {
      console.error('ウィンドウクローズ失敗:', e);
    }
  };

  // スプラッシュウィンドウを閉じてメインウィンドウを表示
  useEffect(() => {
    invoke('close_splash').catch(console.error);
  }, []);

  // 現在のアプリバージョン（ハンバーガーメニュー表示用）
  const [currentAppVersion, setCurrentAppVersion] = useState<string>('');
  useEffect(() => {
    getVersion()
      .then((v) => setCurrentAppVersion(v))
      .catch((err) => console.warn('[App] getVersion failed:', err));
  }, []);

  // 自動更新
  const autoUpdate = useAutoUpdate();
  const autoUpdateRef = useRef(autoUpdate);
  autoUpdateRef.current = autoUpdate;
  useEffect(() => {
    const cancel = scheduleStartupCheck(() => {
      autoUpdateRef.current.checkForUpdate({ silent: true });
    }, 2000);
    return cancel;
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

  // 情報サイドバー用: 選択中のページ
  const selectedPageInfo = useMemo(() => {
    if (!selectedPageId) return null;
    return allPages.find((p) => p.page.id === selectedPageId) ?? null;
  }, [allPages, selectedPageId]);

  // カラーモード集計（ファイルページのみ対象）
  const colorModeGroups = useMemo(() => {
    const groups: Record<string, { id: string; name: string }[]> = {
      Bitmap: [], Grayscale: [], RGB: [], CMYK: [],
    };
    for (const { page } of allPages) {
      if (page.pageType !== 'file') continue;
      const mode = page.imageColorMode;
      if (mode === 'Bitmap' || mode === 'Grayscale' || mode === 'RGB' || mode === 'CMYK') {
        groups[mode].push({ id: page.id, name: page.fileName || '(名称未設定)' });
      }
    }
    return groups;
  }, [allPages]);
  const colorModeCounts = useMemo(() => ({
    Bitmap: colorModeGroups.Bitmap.length,
    Grayscale: colorModeGroups.Grayscale.length,
    RGB: colorModeGroups.RGB.length,
    CMYK: colorModeGroups.CMYK.length,
  }), [colorModeGroups]);
  const colorModeTotalCount =
    colorModeCounts.Bitmap + colorModeCounts.Grayscale + colorModeCounts.RGB + colorModeCounts.CMYK;
  const imageSizeGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      paperLabel: string;
      pixelLabel: string;
      dpiLabel: string;
      physicalLabel: string;
      isException: boolean;
      isStorageSize: boolean;
      files: {
        id: string;
        name: string;
        pixelLabel: string;
        dpiLabel: string;
        physicalLabel: string;
      }[];
      // 例外サイズのみ: 同一サイズごとにジャンル分け（同色）したサブグループ
      exceptionSubGroups?: {
        sizeKey: string;
        pixelLabel: string;
        dpiLabel: string;
        physicalLabel: string;
        color: string;
        files: { id: string; name: string }[];
      }[];
    }>();

    for (const { page } of allPages) {
      if (page.pageType !== 'file') continue;
      const info = getImageSizeGroupInfo(page);
      if (!info) continue;

      const existing = groups.get(info.key);
      const fileInfo = {
        id: page.id,
        name: page.fileName || '(名称未設定)',
        pixelLabel: info.pixelLabel,
        dpiLabel: info.dpiLabel,
        physicalLabel: info.physicalLabel,
      };
      if (existing) {
        existing.files.push(fileInfo);
      } else {
        groups.set(info.key, {
          ...info,
          files: [fileInfo],
        });
      }
    }

    // 例外サイズグループを「同じ例外サイズ」ごとにサブグループ化し、
    // サブグループごとに固定色を割り当てる（同じ例外サイズ＝同色）
    const exceptionGroup = groups.get('exception-size');
    if (exceptionGroup) {
      const subMap = new Map<string, {
        sizeKey: string;
        pixelLabel: string;
        dpiLabel: string;
        physicalLabel: string;
        color: string;
        files: { id: string; name: string }[];
      }>();
      for (const file of exceptionGroup.files) {
        const sizeKey = `${file.pixelLabel}|${file.dpiLabel}`;
        const existing = subMap.get(sizeKey);
        if (existing) {
          existing.files.push({ id: file.id, name: file.name });
        } else {
          subMap.set(sizeKey, {
            sizeKey,
            pixelLabel: file.pixelLabel,
            dpiLabel: file.dpiLabel,
            physicalLabel: file.physicalLabel,
            color: '',
            files: [{ id: file.id, name: file.name }],
          });
        }
      }
      // サイズキー順（昇順・数値考慮）で安定ソートしてから色を割り当て
      const sorted = Array.from(subMap.values()).sort((a, b) =>
        a.sizeKey.localeCompare(b.sizeKey, 'ja', { numeric: true })
      );
      sorted.forEach((sg, i) => {
        sg.color = EXCEPTION_SIZE_COLORS[i % EXCEPTION_SIZE_COLORS.length];
      });
      exceptionGroup.exceptionSubGroups = sorted;
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.isException !== b.isException) return a.isException ? 1 : -1;
      return a.paperLabel.localeCompare(b.paperLabel, 'ja', { numeric: true });
    });
  }, [allPages]);
  const hasSummaryItems = colorModeTotalCount > 0 || imageSizeGroups.length > 0;

  // 例外サイズ sizeKey → グループ色 のマップ（カードのアラートアイコンと色をリンク）
  const exceptionColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const exc = imageSizeGroups.find((g) => g.isException);
    exc?.exceptionSubGroups?.forEach((sg) => map.set(sg.sizeKey, sg.color));
    return map;
  }, [imageSizeGroups]);

  // ページが例外サイズなら、その例外サイズグループの色を返す（非例外/規格内は undefined）
  const getPageExceptionColor = useCallback(
    (page: Page): string | undefined => {
      const info = getImageSizeGroupInfo(page);
      if (!info || !info.isException) return undefined;
      return exceptionColorMap.get(`${info.pixelLabel}|${info.dpiLabel}`);
    },
    [exceptionColorMap]
  );

  // サマリーバーのツールチップでファイル名をクリック → 該当カードを選択しスクロール
  const selectPageFromSummary = useCallback(
    (pageId: string) => {
      selectPage(pageId);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-page-id="${pageId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      });
    },
    [selectPage]
  );

  // PDF展開時のエラーがあればまとめてダイアログ表示
  const notifyPdfExpansionErrors = (errors: { pdfName: string; message: string }[]) => {
    if (errors.length === 0) return;
    setExportResultDialog({
      show: true,
      title: 'PDFの読み込みに失敗',
      message: `${errors.length} 件のPDFを読み込めませんでした。`,
      details: errors.map((e) => `${e.pdfName}: ${e.message}`).join('\n'),
      isError: true,
    });
  };

  // CMYKチェック: エクスポート/EPUB生成前のガード。CMYKがあれば警告ダイアログを出してブロックする。
  // 戻り値: true=ブロック(中断), false=続行可
  const blockIfCmyk = (action: 'export' | 'epub') => {
    if (colorModeCounts.CMYK === 0) return false;
    const fileList = colorModeGroups.CMYK.slice(0, 20).map((f) => f.name).join('\n');
    const more = colorModeGroups.CMYK.length > 20
      ? `\n…他${colorModeGroups.CMYK.length - 20}件`
      : '';
    setExportResultDialog({
      show: true,
      title: 'CMYKファイルが含まれています',
      message:
        action === 'export'
          ? `CMYKカラーモードのファイルが${colorModeCounts.CMYK}件含まれているため、エクスポートできません。\nRGB/グレースケールに変換してから再度お試しください。`
          : `CMYKカラーモードのファイルが${colorModeCounts.CMYK}件含まれているため、EPUBを生成できません。\nRGB/グレースケールに変換してから再度お試しください。`,
      details: fileList + more,
      isError: true,
    });
    return true;
  };
  const colorModeSummaryBar = hasSummaryItems ? (
    <div className={`color-mode-summary-container ${isColorSummaryExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        type="button"
        className="toolbar-collapse-btn color-mode-summary-toggle"
        onClick={() => setIsColorSummaryExpanded((v) => !v)}
        title={isColorSummaryExpanded ? 'カラーモードを非表示' : 'カラーモードを表示'}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className={`collapse-icon ${!isColorSummaryExpanded ? 'collapsed' : ''}`}
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isColorSummaryExpanded && (
        <div className="color-mode-summary">
          {(['Bitmap', 'Grayscale', 'RGB', 'CMYK'] as const).map((mode) => {
            if (colorModeCounts[mode] === 0) return null;
            const label = mode === 'Bitmap' ? 'モノクロ' : mode === 'Grayscale' ? 'グレー' : mode;
            const swatch = mode === 'Bitmap' ? '#000000'
              : mode === 'Grayscale' ? '#808080'
              : mode === 'RGB' ? '#0078d4'
              : '#dc2626';
            const isCmyk = mode === 'CMYK';
            return (
              <div
                key={mode}
                className={`color-mode-badge ${hoveredColorMode === mode ? 'active' : ''} ${isCmyk ? 'color-mode-badge-warning' : ''}`}
                onMouseEnter={() => handleBadgeEnter(mode)}
                onMouseLeave={scheduleHoverClose}
                title={isCmyk ? 'CMYK画像はEPUBで正しく表示されない可能性があります' : undefined}
              >
                <span className="color-mode-swatch" style={{ background: swatch }} />
                <span className="color-mode-label">{label}</span>
                <span className="color-mode-count">{colorModeCounts[mode]}</span>
                {hoveredColorMode === mode && colorModeGroups[mode].length > 0 && (
                  <div
                    className="color-mode-badge-tooltip"
                    onMouseEnter={cancelHoverClose}
                    onMouseLeave={scheduleHoverClose}
                  >
                    {colorModeGroups[mode].map((file, i) => (
                      <div
                        key={i}
                        className="color-mode-badge-tooltip-item color-mode-tooltip-clickable"
                        title={file.name}
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectPageFromSummary(file.id);
                        }}
                      >
                        {file.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {imageSizeGroups.length > 0 && (
            <div className="image-size-summary-group" aria-label="画像サイズ">
              {imageSizeGroups.map((group) => (
                <div
                  key={group.key}
                  className={`image-size-badge ${hoveredImageSizeKey === group.key ? 'active' : ''} ${group.isException ? 'image-size-badge-exception' : ''} ${group.isStorageSize ? 'image-size-badge-storage' : ''}`}
                  onMouseEnter={() => handleImageSizeBadgeEnter(group.key)}
                  onMouseLeave={scheduleHoverClose}
                >
                  <span className="image-size-paper">
                    {group.isException ? '例外サイズ' : group.paperLabel.replace(/（.*$/, '')}
                  </span>
                  <span className="color-mode-count">{group.files.length}</span>
                  {hoveredImageSizeKey === group.key && (
                    <div
                      className="color-mode-badge-tooltip image-size-badge-tooltip"
                      onMouseEnter={cancelHoverClose}
                      onMouseLeave={scheduleHoverClose}
                    >
                      {group.isException && group.exceptionSubGroups ? (
                        group.exceptionSubGroups.map((sg) => (
                          <div key={sg.sizeKey} className="image-size-exception-subgroup">
                            <div
                              className="image-size-exception-subhead"
                              style={{ color: sg.color }}
                            >
                              <span
                                className="image-size-exception-swatch"
                                style={{ backgroundColor: sg.color }}
                              />
                              <span className="image-size-exception-sizelabel">
                                {sg.pixelLabel} / {sg.dpiLabel} / 実寸 {sg.physicalLabel}
                              </span>
                              <span className="color-mode-count">{sg.files.length}</span>
                            </div>
                            {sg.files.map((file, i) => (
                              <div
                                key={i}
                                className="color-mode-badge-tooltip-item image-size-tooltip-file image-size-exception-file color-mode-tooltip-clickable"
                                style={{ borderLeftColor: sg.color }}
                                title={file.name}
                                role="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectPageFromSummary(file.id);
                                }}
                              >
                                <span className="image-size-tooltip-filename">{file.name}</span>
                              </div>
                            ))}
                          </div>
                        ))
                      ) : (
                        group.files.map((file, i) => (
                          <div
                            key={i}
                            className="color-mode-badge-tooltip-item image-size-tooltip-file color-mode-tooltip-clickable"
                            title={file.name}
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectPageFromSummary(file.id);
                            }}
                          >
                            <span className="image-size-tooltip-filename">{file.name}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  const {
    exportResultDialog,
    handleExport,
    setExportResultDialog,
    closeExportResultDialog,
  } = useExport(chapters, allPages);

  const showProjectResult = useCallback((title: string, message: string, isError = false) => {
    setExportResultDialog({
      show: true,
      title,
      message,
      isError,
    });
  }, [setExportResultDialog]);

  const confirmDiscardUnsavedChanges = useCallback((): Promise<boolean> => {
    if (!shouldConfirmUnsavedChanges) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      discardConfirmResolveRef.current = resolve;
      setShowDiscardConfirmDialog(true);
    });
  }, [shouldConfirmUnsavedChanges]);

  const saveProjectToPath = useCallback(async (targetPath: string): Promise<boolean> => {
    const filePath = ensureProjectExtension(targetPath);
    const projectFile = buildProjectFile(
      filePath,
      projectName,
      projectCreatedAt,
      chapters,
      selectedChapterId,
      selectedPageId,
      thumbnailSize,
      useStore.getState().epubState
    );

    try {
      const result = await invoke<ProjectSaveResult>('save_project', { filePath, project: projectFile });
      await invoke('add_recent_file', { path: result.file_path, name: projectFile.name }).catch((error) => {
        console.warn('最近使ったファイルへの追加に失敗:', error);
      });
      setCurrentProjectPath(result.file_path);
      setProjectCreatedAt(projectFile.created_at);
      setLastSavedSnapshot(projectStateSnapshot);
      showProjectResult(
        'プロジェクトを保存しました',
        `${result.project_dir} に保存しました。\nリンクファイル: ${result.copied_files}件`
      );
      return true;
    } catch (error) {
      const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '保存に失敗しました。';
      showProjectResult('プロジェクト保存に失敗', message, true);
      return false;
    }
  }, [
    chapters,
    projectCreatedAt,
    projectName,
    projectStateSnapshot,
    selectedChapterId,
    selectedPageId,
    showProjectResult,
    thumbnailSize,
  ]);

  const handleSaveProjectAs = useCallback(async (): Promise<boolean> => {
    const fallbackDir = await desktopDir();
    const defaultPath = currentProjectPath ?? await join(
      fallbackDir,
      `${sanitizeFileName(projectName || DEFAULT_PROJECT_NAME)}.${PROJECT_FILE_EXTENSION}`
    );
    const selected = await save({
      title: 'プロジェクトを保存',
      defaultPath,
      filters: [
        {
          name: '台割マネージャー プロジェクト',
          extensions: [PROJECT_FILE_EXTENSION],
        },
      ],
    });

    if (!selected) return false;
    return saveProjectToPath(selected);
  }, [currentProjectPath, projectName, saveProjectToPath]);

  const handleSaveProject = useCallback(async (): Promise<boolean> => {
    if (currentProjectPath) {
      return saveProjectToPath(currentProjectPath);
    }
    return handleSaveProjectAs();
  }, [currentProjectPath, handleSaveProjectAs, saveProjectToPath]);

  const loadProjectFromPath = useCallback(async (filePath: string): Promise<boolean> => {
    try {
      const loadedProject = await invoke<RustProjectFile>('load_project', { filePath });
      const restored = restoreProjectFromFile(loadedProject);
      useStore.setState({
        chapters: restored.chapters,
        projectName: restored.name,
        history: [],
        future: [],
        selectedChapterId: restored.selectedChapterId,
        selectedPageId: restored.selectedPageId,
        selectedPageIds: restored.selectedPageId ? [restored.selectedPageId] : [],
        thumbnailSize: restored.thumbnailSize,
        viewMode: 'all',
        epubState: restored.epubState,
      });
      useBleedStore.getState().reset();
      setPreviewCollapsedChapters(new Set(restored.collapsedChapterIds));
      setCurrentProjectPath(filePath);
      setProjectCreatedAt(restored.createdAt);
      setLastSavedSnapshot(createProjectStateSnapshot(restored.name, restored.chapters, restored.thumbnailSize));
      await invoke('add_recent_file', { path: filePath, name: restored.name }).catch((error) => {
        console.warn('最近使ったファイルへの追加に失敗:', error);
      });
      return true;
    } catch (error) {
      const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '読み込みに失敗しました。';
      showProjectResult('プロジェクト読込に失敗', message, true);
      return false;
    }
  }, [showProjectResult]);

  const handleOpenProject = useCallback(async (): Promise<boolean> => {
    if (!(await confirmDiscardUnsavedChanges())) return false;
    const selected = await open({
      title: 'プロジェクトを開く',
      multiple: false,
      directory: false,
      filters: [
        {
          name: '台割マネージャー プロジェクト',
          extensions: [PROJECT_FILE_EXTENSION],
        },
      ],
    });

    if (!selected || typeof selected !== 'string') return false;
    return loadProjectFromPath(selected);
  }, [confirmDiscardUnsavedChanges, loadProjectFromPath]);

  const handleSaveAndClose = useCallback(async () => {
    const saved = await handleSaveProject();
    if (saved) {
      await handleConfirmClose();
    }
  }, [handleSaveProject]);

  // .daiw ファイル関連付け（ダブルクリック）でのコールドスタート起動時、
  // バックエンドが保持した起動ファイルパスを取得して読み込む。
  // take_pending_open_path は取得と同時にクリアするため二重読込は起きない。
  useEffect(() => {
    (async () => {
      try {
        const path = await invoke<string | null>('take_pending_open_path');
        if (path) await loadProjectFromPath(path);
      } catch (e) {
        console.warn('起動ファイルの取得に失敗:', e);
      }
    })();
  }, [loadProjectFromPath]);

  // すでにアプリが開いている状態で .daiw をダブルクリックした場合（ウォームスタート）、
  // single-instance プラグインが発火する open-project-file イベントを購読して読み込む。
  useEffect(() => {
    const pending = listen<string>('open-project-file', (event) => {
      void loadProjectFromPath(event.payload);
    });
    return () => {
      pending.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [loadProjectFromPath]);

  const exportResultAnim = useModalAnimation(exportResultDialog.show);
  const [tachimiPdfProgress, setTachimiPdfProgress] = useState<{
    phase: string;
    message: string;
    current: number;
    total: number;
    indeterminate: boolean;
  } | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;
    listen<{
      phase: string;
      message: string;
      current: number;
      total: number;
      indeterminate: boolean;
    }>('tachimi-pdf-progress', (event) => {
      if (mounted) setTachimiPdfProgress(event.payload);
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    }).catch((err) => console.warn('[App] Tachimi PDF progress listener failed:', err));
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // PDFラスタライズ進捗
  const [pdfRasterizeProgress, setPdfRasterizeProgress] = useState<{
    phase: string;
    current: number;
    total: number;
    pdfName: string;
  } | null>(null);
  const pdfProgressClearRef = useRef<number | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;
    listen<{
      phase: string;
      current: number;
      total: number;
      pdfName: string;
    }>('pdf-rasterize-progress', (event) => {
      if (!mounted) return;
      if (pdfProgressClearRef.current !== null) {
        window.clearTimeout(pdfProgressClearRef.current);
        pdfProgressClearRef.current = null;
      }
      setPdfRasterizeProgress(event.payload);
      if (event.payload.phase === 'done') {
        // 800ms 後に自動的に閉じる
        pdfProgressClearRef.current = window.setTimeout(() => {
          setPdfRasterizeProgress(null);
          pdfProgressClearRef.current = null;
        }, 800);
      }
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    }).catch((err) => console.warn('[App] PDF rasterize progress listener failed:', err));
    return () => {
      mounted = false;
      unlisten?.();
      if (pdfProgressClearRef.current !== null) {
        window.clearTimeout(pdfProgressClearRef.current);
      }
    };
  }, []);

  // Tachimi 連携: 全チャプターのファイルを Tachimi に渡して PDF 化フローへ移行する
  const TACHIMI_EXE_STORAGE_KEY = 'daidori_tachimi_exe_path';

  // tachimi.exe を自動検出。前回成功パスを hint として優先し、無ければ既知の候補を探索する。
  const detectTachimiExe = useCallback(async (): Promise<string | null> => {
    const hint = localStorage.getItem(TACHIMI_EXE_STORAGE_KEY);
    const found = await invoke<string | null>('detect_tachimi_exe', {
      hint: hint ?? null,
    }).catch(() => null);
    if (found) {
      localStorage.setItem(TACHIMI_EXE_STORAGE_KEY, found);
      return found;
    }
    localStorage.removeItem(TACHIMI_EXE_STORAGE_KEY);
    return null;
  }, []);

  // PDF生成（出力タブ）。断ち切りは断ち切りタブで設定した内容（bleedStore）を適用する。
  const handleGeneratePdf = useCallback(async () => {
    const hasPdfPages = chapters.some(
      (chapter) => chapter.pages.length > 0 || chapter.type === 'blank'
    );
    if (!hasPdfPages) {
      setExportResultDialog({
        show: true,
        title: 'ファイルがありません',
        message: 'PDF化できるページが追加されたチャプターがありません。',
        isError: true,
      });
      return;
    }

    const exe = await detectTachimiExe();
    if (!exe) {
      setExportResultDialog({
        show: true,
        title: 'Tachimi が見つかりません',
        message:
          'tachimi.exe を自動検出できませんでした。\nTachimi をインストールするか、開発ビルド（Desktop\\Tachimi_開発\\Tachimi-_Standalone\\src-tauri\\target\\release\\tachimi.exe など）を配置してください。',
        isError: true,
      });
      return;
    }

    // 出力先はデスクトップの Script_Output/台割pdf に固定（フォルダ選択なし）
    const desktop = await desktopDir();
    const pdfOutputDir = await join(desktop, 'Script_Output', '台割pdf');

    // 断ち切りタブで設定した内容を適用（未設定なら断ち切りなし）
    const bleedSettings = useBleedStore.getState().getBleedSettings();

    try {
      // 各ページに ProcessOptions（断ち切り）を付与。サイズ統一はバックエンドが担当
      const pdfChapters = chapters
        .map((chapter) => {
          const region = resolveBleedRegion(bleedSettings, chapter.type, chapter.id);
          const options = buildProcessOptions(region, {
            resizeMode: 'none',
            resizePercent: 50,
            jpgQuality: 100,
          });
          return {
            name: chapter.name,
            chapter_type: chapter.type,
            pages: chapter.pages.map((page) => ({
              source_path: page.filePath ?? null,
              page_type: page.pageType,
              options: page.filePath ? options : null,
            })),
          };
        })
        .filter((chapter) => chapter.pages.length > 0 || chapter.chapter_type === 'blank');

      setExportResultDialog({
        show: true,
        title: 'チャプターPDF生成中',
        message:
          'JPEG化 → サイズ統一 → 断ち切り → PDF化 の順で処理しています。完了まで少しお待ちください。',
        isError: false,
      });
      setTachimiPdfProgress({
        phase: 'prepare',
        message: 'Tachimi PDFジョブを準備しています',
        current: 0,
        total: pdfChapters.length || 1,
        indeterminate: false,
      });

      const result = await invoke<{
        generated: number;
        output_dir: string;
        results: { output_path: string; success: boolean; error?: string | null }[];
      }>('generate_tachimi_chapter_pdfs', {
        exePath: exe,
        outputDir: pdfOutputDir,
        outputName: projectName || '台割PDF',
        chapters: pdfChapters,
        isSpread: false,
      });

      const errors = result.results.filter((r) => !r.success);
      const details = [
        ...result.results.filter((r) => r.success).map((r) => r.output_path),
        ...errors.map((r) => `${r.output_path || 'PDF生成'}: ${r.error ?? '不明なエラー'}`),
      ].join('\n');

      setExportResultDialog({
        show: true,
        title: errors.length > 0 ? 'チャプターPDF生成完了（一部エラー）' : 'チャプターPDF生成完了',
        message: '全チャプターを1つのPDFにまとめました。',
        details: details || undefined,
        outputDir: result.output_dir,
        isError: errors.length > 0,
      });
      setTachimiPdfProgress(null);
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : '不明なエラーが発生しました');
      setExportResultDialog({
        show: true,
        title: 'チャプターPDF生成に失敗',
        message: msg,
        isError: true,
      });
      setTachimiPdfProgress(null);
    }
  }, [chapters, detectTachimiExe, projectName, setExportResultDialog]);

  // 画像出力（出力タブ）。CMYK ガード後、断ち切りタブの設定を注入して handleExport を実行。
  // CMYK判定を最新に保つため非メモ化。
  const handleExportImages = (options: ExportOptions) => {
    if (blockIfCmyk('export')) return;
    const bleedSettings = useBleedStore.getState().getBleedSettings();
    void handleExport({ ...options, bleedSettings });
  };

  const handlePreviewModeChange = useCallback((mode: 'grid' | 'spread') => {
    // 見開き（spread）はリスト（grid）の右側のトグル → 右へ移動なら右から、左なら左からスライド
    setComposeSlideFrom(computeSlideDirection(mode, previewMode, ['grid', 'spread']));
    if (mode === 'grid') {
      setIsViewerMode(false);
    }
    setPreviewMode(mode);
  }, [previewMode]);

  // ページバー表示切替（ビューアオーバーレイから呼ぶ。localStorageへ永続化）
  const togglePageBar = useCallback(() => {
    setIsPageBarVisible((prev) => {
      const next = !prev;
      localStorage.setItem('daidori_pagebar_visible', String(next));
      return next;
    });
  }, []);
  const enterViewerMode = useCallback(() => setIsViewerMode(true), []);

  // 新規プロジェクト
  const handleNewProject = async () => {
    if (!(await confirmDiscardUnsavedChanges())) return;
    resetProject();
    useBleedStore.getState().reset();
    const createdAt = new Date().toISOString();
    setCurrentProjectPath(null);
    setProjectCreatedAt(createdAt);
    setPreviewCollapsedChapters(new Set());
    setLastSavedSnapshot(createEmptyProjectSnapshot());
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

  // 情報サイドバー折りたたみ状態の永続化
  useEffect(() => {
    localStorage.setItem('daidori_info_sidebar_collapsed', isInfoSidebarCollapsed ? 'true' : 'false');
  }, [isInfoSidebarCollapsed]);

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

  // ファイル検証（移動・リネーム・日時変更 + カラーモード/サイズ/DPI差異）
  // マウント時、ウィンドウフォーカス時、chapters内のfilePath変化時(debounce)に実行
  useEffect(() => {
    let cancelled = false;
    let debounceTimer: number | undefined;

    const runValidation = async () => {
      const targets: { page_id: string; file_path: string; modified_time: number | null; file_size: number | null }[] = [];
      for (const c of useStore.getState().chapters) {
        for (const p of c.pages) {
          if (p.filePath) {
            targets.push({
              page_id: p.id,
              file_path: p.filePath,
              modified_time: p.modifiedTime ?? null,
              file_size: p.fileSize ?? null,
            });
          }
        }
      }
      if (targets.length === 0) return;
      try {
        type RustResult = {
          page_id: string;
          status: FileValidationStatus;
          width: number | null;
          height: number | null;
          color_mode: string | null;
          dpi: number | null;
        };
        const results = await invoke<RustResult[]>('validate_pages', { pages: targets });
        if (cancelled) return;
        updatePagesValidation(
          results.map((r) => ({
            pageId: r.page_id,
            status: r.status,
            width: r.width,
            height: r.height,
            colorMode: r.color_mode,
            dpi: r.dpi,
          }))
        );
      } catch (error) {
        console.error('ファイル検証エラー:', error);
      }
    };

    const scheduleValidation = () => {
      if (debounceTimer !== undefined) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        runValidation();
      }, 300);
    };

    // 初回実行
    runValidation();

    // フォーカス時に再検証
    const handleFocus = () => { runValidation(); };
    window.addEventListener('focus', handleFocus);

    // chaptersの変化を監視（ページ追加/差し替え時に自動再検証）
    let lastFingerprint = '';
    const unsubscribe = useStore.subscribe((state) => {
      const fingerprint = state.chapters
        .flatMap((c) => c.pages.map((p) => `${p.id}:${p.filePath ?? ''}:${p.modifiedTime ?? ''}`))
        .join('|');
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        scheduleValidation();
      }
    });

    return () => {
      cancelled = true;
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      window.removeEventListener('focus', handleFocus);
      unsubscribe();
    };
  }, [updatePagesValidation]);

  // ダークモードトグル
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

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
    animateRemoveChapter(chapterId);
  }, [chapters, animateRemoveChapter]);

  // チャプター複製（読み込み済みファイルごと）
  const handleDuplicateChapter = useCallback((chapterId: string) => {
    const newId = duplicateChapter(chapterId);
    if (newId) {
      selectChapter(newId);
      selectPage(null);
    }
  }, [duplicateChapter, selectChapter, selectPage]);

  // 見開き表示・断ち切りタブ・出力タブでは表示対象の全ページのサムネイルを先行生成
  // （台割タブのリスト表示ではIntersectionObserverで遅延生成するが、他には仕組みが無い）
  useEffect(() => {
    if (activeTab === 'compose' && previewMode === 'grid') return;
    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        if (
          page.filePath &&
          page.modifiedTime &&
          (page.thumbnailStatus === 'pending' || page.thumbnailStatus === undefined)
        ) {
          queueThumbnail(page.id, page.filePath, page.modifiedTime);
        }
      }
    }
  }, [activeTab, previewMode, chapters]);

  // キーボードショートカット
  useKeyboardShortcuts({
    selectedChapterId,
    selectedPageId,
    selectedPageIds,
    chapters,
    allPages,
    allowViewer: (activeTab === 'compose' && previewMode === 'spread') || activeTab === 'output',
    removePage,
    removeSelectedPages,
    selectChapter,
    selectPage,
    handleDeleteChapter,
    handleNewProject,
    handleOpenProject,
    handleSaveProject,
    handleSaveProjectAs,
    setIsViewerMode,
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
            name: '画像・PDFファイル',
            extensions: ['jpg', 'jpeg', 'png', 'psd', 'tif', 'tiff', 'pdf'],
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
          const expanded = await expandPdfFiles(selectedFiles);
          notifyPdfExpansionErrors(expanded.errors);
          if (expanded.files.length > 0) {
            addPagesToChapter(chapterId, expanded.files);
          }
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
        multiple: true,
      });

      if (!selected) return;
      const rawPaths = Array.isArray(selected) ? selected : [selected];
      const folderPaths: string[] = rawPaths.filter(
        (p): p is string => typeof p === 'string' && p.trim().length > 0
      );

      if (folderPaths.length === 0) return;

      // フォルダごとに内容を取得（PDF はラスタライズ展開）
      const folderEntries: SplitFolderEntry[] = [];
      const allErrors: { pdfName: string; message: string }[] = [];
      for (const folderPath of folderPaths) {
        try {
          const files: FileInfo[] = await invoke('get_folder_contents', { folderPath });
          const expanded = await expandPdfFiles(files);
          if (expanded.errors.length > 0) allErrors.push(...expanded.errors);
          if (expanded.files.length > 0) {
            folderEntries.push({
              folderPath,
              folderName: getFolderName(folderPath),
              files: expanded.files,
            });
          }
        } catch (e) {
          console.error('フォルダ読み取りエラー:', folderPath, e);
        }
      }
      notifyPdfExpansionErrors(allErrors);

      if (folderEntries.length === 0) return;

      // 複数フォルダ選択 + 白紙以外 → 分割ダイアログ
      const targetChapter = chapters.find(c => c.id === chapterId);
      if (folderEntries.length >= 2 && targetChapter && targetChapter.type !== 'blank') {
        setSplitFoldersDialog({
          folders: folderEntries,
          targetChapterId: chapterId,
          open: true,
        });
        return;
      }

      // 単一フォルダまたは白紙チャプターは従来通り全ファイル追加
      const allFiles = folderEntries.flatMap(e => e.files);
      if (allFiles.length > 0) {
        if (targetChapter?.type === 'chapter' && folderEntries.length === 1) {
          const importedName = getDefaultNameForImportedFolder(folderEntries[0].folderName, targetChapter.type);
          const importedSubtitle = getSubtitleForImportedFolder(folderEntries[0].folderName, targetChapter.type);
          if (importedName && importedName !== targetChapter.name) {
            renameChapter(chapterId, importedName);
          }
          if (importedSubtitle && importedSubtitle !== targetChapter.subtitle) {
            updateChapterSubtitle(chapterId, importedSubtitle);
          }
        }
        addPagesToChapter(chapterId, allFiles);
      }
    } catch (error) {
      console.error('フォルダ追加エラー:', error);
    }
  };

  const handleInsertFile = async (chapterId: string, afterPageId: string) => {
    try {
      const selected = await open({
        title: 'フォルダから1ファイルを選択',
        multiple: false,
        directory: false,
        filters: [
          {
            name: '画像・PDFファイル',
            extensions: ['jpg', 'jpeg', 'png', 'psd', 'tif', 'tiff', 'pdf'],
          },
        ],
      });
      if (!selected || typeof selected !== 'string' || selected.trim().length === 0) return;
      const folder = selected.replace(/[^\\/]+$/, '');
      if (!folder) return;
      const files: FileInfo[] = await invoke('get_folder_contents', { folderPath: folder });
      const target = files.find((f) => f.path === selected);
      if (!target) return;
      const chapter = chapters.find((c) => c.id === chapterId);
      if (!chapter) return;
      const afterIndex = chapter.pages.findIndex((p) => p.id === afterPageId);
      const insertIndex = afterIndex >= 0 ? afterIndex + 1 : chapter.pages.length;
      const expanded = await expandPdfFiles([target]);
      notifyPdfExpansionErrors(expanded.errors);
      if (expanded.files.length > 0) {
        addPagesToChapterAt(chapterId, expanded.files, insertIndex);
      }
    } catch (error) {
      console.error('ファイル挿入エラー:', error);
    }
  };

  const handleReplacePages = async (chapterId: string) => {
    try {
      const chapter = chapters.find((c) => c.id === chapterId);
      if (chapter && chapter.pages.length > 0) {
        const confirmed = await ask(
          `「${chapter.name}」の既存ページ${chapter.pages.length}枚を、選択するフォルダの内容で差し替えます。よろしいですか？`,
          { title: 'ページを差し替え', kind: 'warning' }
        );
        if (!confirmed) return;
      }
      const selected = await open({
        title: '差し替え元フォルダを選択',
        directory: true,
      });
      if (selected && typeof selected === 'string' && selected.trim().length > 0) {
        const files: FileInfo[] = await invoke('get_folder_contents', {
          folderPath: selected,
        });
        const expanded = await expandPdfFiles(files);
        notifyPdfExpansionErrors(expanded.errors);
        if (expanded.files.length > 0) {
          replacePagesInChapter(chapterId, expanded.files);
        }
      }
    } catch (error) {
      console.error('差し替えエラー:', error);
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
            name: '画像・PDFファイル',
            extensions: ['jpg', 'jpeg', 'png', 'psd', 'tif', 'tiff', 'pdf'],
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
          // 特殊ページは1ファイルのみ。PDFが選ばれた場合は1ページ目のみ採用
          const expanded = await expandPdfFiles([fileInfo]);
          notifyPdfExpansionErrors(expanded.errors);
          const firstFile = expanded.files[0];
          if (firstFile) {
            setPageFile(pageId, firstFile);
          }
        }
      }
    } catch (error) {
      console.error('ファイル選択エラー:', error);
    }
  };

  // リンク更新: 同じパスのファイルを再読込してメタデータ・サムネイルを更新（InDesign風）
  const handleRefreshFile = async (pageId: string) => {
    const target = allPages.find((p) => p.page.id === pageId)?.page;
    if (!target || !target.filePath) return;
    try {
      const folderPath = target.filePath.replace(/[^\\/]+$/, '');
      if (!folderPath) return;
      const files: FileInfo[] = await invoke('get_folder_contents', { folderPath });
      const fileInfo = files.find((f) => f.path === target.filePath);
      if (fileInfo) {
        setPageFile(pageId, fileInfo);
      }
    } catch (error) {
      console.error('リンク更新エラー:', error);
    }
  };

  const formatEpubCheckDetails = (result: EpubCheckResult): string | undefined => {
    if (!result.available) {
      return result.error;
    }
    if (result.messages.length === 0) {
      return undefined;
    }

    return result.messages
      .map((item, index) => {
        const severityLabel =
          item.severity === 'FATAL' ? '致命的エラー' :
          item.severity === 'ERROR' ? 'エラー' :
          item.severity === 'WARNING' ? '警告' :
          item.severity === 'USAGE' ? '仕様上の注意' :
          item.severity === 'HINT' ? 'ヒント' :
          '情報';
        const code = item.code ? `（${item.code}）` : '';
        const location = item.path
          ? `\n  場所: ${item.path}${item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : ''}`
          : '';
        return `${index + 1}. ${severityLabel}${code}: ${item.message}${location}`;
      })
      .join('\n\n');
  };

  const buildEpubCheckMessage = (result: EpubCheckResult): string => {
    if (!result.available) {
      return 'EPUBCheckを実行できなかったため、生成後チェックは完了していません。';
    }

    const status = result.isValid ? 'EPUBCheck: 問題なし' : 'EPUBCheck: 要確認';
    const version = result.checkerVersion ? ` / v${result.checkerVersion}` : '';
    return `${status}${version}\n致命的エラー ${result.fatalCount}件 / エラー ${result.errorCount}件 / 警告 ${result.warningCount}件 / 仕様上の注意 ${result.usageCount}件 / 情報 ${result.infoCount}件`;
  };

  // チャプター内の全ファイルページのリンクを一括更新
  const handleRefreshChapterLinks = useCallback(async (chapterId: string) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) return;
    const filePages = chapter.pages.filter((p) => p.pageType === 'file' && !!p.filePath);
    if (filePages.length === 0) {
      setExportResultDialog({
        show: true,
        title: 'リンクを更新',
        message: '更新対象のファイルページがありません。',
        isError: true,
      });
      return;
    }
    // フォルダ単位でグループ化して get_folder_contents の呼び出し回数を減らす
    const folderGroups = new Map<string, typeof filePages>();
    for (const page of filePages) {
      const folder = page.filePath!.replace(/[^\\/]+$/, '');
      if (!folder) continue;
      const group = folderGroups.get(folder);
      if (group) {
        group.push(page);
      } else {
        folderGroups.set(folder, [page]);
      }
    }
    const updates: { pageId: string; file: FileInfo }[] = [];
    const missing: string[] = [];
    try {
      for (const [folder, pagesInFolder] of folderGroups) {
        const files: FileInfo[] = await invoke('get_folder_contents', { folderPath: folder });
        const byPath = new Map(files.map((f) => [f.path, f]));
        for (const page of pagesInFolder) {
          const f = byPath.get(page.filePath!);
          if (f) {
            updates.push({ pageId: page.id, file: f });
          } else {
            missing.push(page.fileName || page.filePath!);
          }
        }
      }
    } catch (error) {
      console.error('リンク更新エラー:', error);
      setExportResultDialog({
        show: true,
        title: 'リンク更新失敗',
        message: 'フォルダの読み込み中にエラーが発生しました。',
        details: String(error),
        isError: true,
      });
      return;
    }
    if (updates.length > 0) {
      refreshPagesLinks(updates);
    }
    const missingDetails = missing.length > 0
      ? missing.slice(0, 20).join('\n') + (missing.length > 20 ? `\n…他${missing.length - 20}件` : '')
      : undefined;
    setExportResultDialog({
      show: true,
      title: 'リンクを更新',
      message:
        `「${chapter.name}」の${updates.length}件のページのリンクを更新しました。` +
        (missing.length > 0 ? `\n${missing.length}件は元のファイルが見つかりませんでした。` : ''),
      details: missingDetails,
      isError: updates.length === 0,
    });
  }, [chapters, refreshPagesLinks, setExportResultDialog]);

  const buildSplitOutputPath = (templatePath: string, splitSettings: EpubSplitSettings, index: number) => {
    const slashIndex = Math.max(templatePath.lastIndexOf('/'), templatePath.lastIndexOf('\\'));
    const directory = slashIndex >= 0 ? templatePath.slice(0, slashIndex + 1) : '';
    const suffixNumber = splitSettings.suffixStart + index;
    const suffix = String(suffixNumber).padStart(splitSettings.suffixDigits, '0');
    return `${directory}${splitSettings.baseName}${splitSettings.suffixSeparator}${suffix}.epub`;
  };

  // 内部整合性チェック（OPF/XHTML参照とZIP実体の突き合わせ）。EPUBCheck失敗とは独立に動く
  const runInternalVerify = async (
    epubPath: string,
  ): Promise<{ summary: string; failed: boolean }> => {
    try {
      const result = await invoke<EpubInternalCheckResult>('verify_epub_internal', { epubPath });
      const lines: string[] = [];
      if (result.isValid) {
        lines.push('内部整合性チェック: 問題なし');
      } else {
        lines.push(`内部整合性チェック: エラー ${result.errors.length}件`);
        lines.push(...result.errors.slice(0, 10).map((e) => `  ・${e}`));
        if (result.errors.length > 10) lines.push(`  …他${result.errors.length - 10}件`);
      }
      if (result.warnings.length > 0) {
        lines.push(...result.warnings.map((w) => `  注意: ${w}`));
      }
      lines.push(...result.info.map((i) => `  ${i}`));
      return { summary: lines.join('\n'), failed: !result.isValid };
    } catch (e) {
      return { summary: `内部整合性チェックを実行できませんでした: ${e}`, failed: false };
    }
  };

  const buildSplitVolumePages = (pages: EpubPage[]) => {
    const hasExplicitCover = pages.some((page) => page.isCover);
    const hasExplicitColophon = pages.some((page) => page.isColophon);
    return pages.map((page, index) => {
      const ext = page.filename.split('.').pop()?.toLowerCase() || 'jpg';
      const isCover = page.isCover || (!hasExplicitCover && index === 0);
      const isColophon = page.isColophon || (!hasExplicitColophon && index === pages.length - 1);
      return {
        ...page,
        id: isCover ? 'p-cover' : isColophon ? 'p-colophon' : `p-${String(index).padStart(3, '0')}`,
        filename: isCover ? `cover.${ext}` : isColophon ? `colophon.${ext}` : `${String(index).padStart(4, '0')}.${ext}`,
        isCover,
        isColophon,
      };
    });
  };

  // EPUB生成ハンドラ
  const handleEpubGenerate = async (metadata: EpubMetadata, outputPath: string, splitSettings?: EpubSplitSettings) => {
    try {
      const isLegacyHybrid =
        metadata.outputFormat === 'hybrid' && metadata.hybridCssProfile === 'legacy';
      const generateMetadata: EpubMetadata = {
        ...metadata,
        allowMissingColophon: isLegacyHybrid ? true : metadata.allowMissingColophon,
      };
      const epubPreviewPageByOriginalId = new Map(
        epubPages
          .filter((p) => p.originalPageId)
          .map((p) => [p.originalPageId!, p])
      );

      // === PSDが含まれていれば自動的にJPEG化（Photoshop経由） ===
      const psdToJpegMap = new Map<string, string>();
      // 19.3: 実際に使った変換エンジン（preNormalized 付与・完了ダイアログの注記に使用）
      let psdEngineUsed: 'native' | 'photoshop' = 'native';
      let psdEngineFellBack = false;
      const psdSourcePaths: string[] = [];
      // 断ち切り(内蔵比率クロップ)用に、各ユニークPSDが最初に現れたチャプター種別/IDを記録
      const psdChapterInfo = new Map<string, { type: string; id: string }>();
      for (const chapter of chapters) {
        for (const page of chapter.pages) {
          if (page.fileType === 'psd' && page.filePath) {
            // 同一PSDが複数ページから参照される可能性もあるので、ユニーク化
            if (!psdSourcePaths.includes(page.filePath)) {
              psdSourcePaths.push(page.filePath);
              psdChapterInfo.set(page.filePath, { type: chapter.type, id: chapter.id });
            }
          }
        }
      }

      // 断ち切りは「断ち切り」タブ(bleedStore)に一本化。method で出し分け:
      //  - 'region'      : 描いた範囲（PSDのチャプター種別で表紙/本文）
      //  - 'action-ratio': アクション矩形の比率（全PSD共通・中央揃え）
      //  - 'action'      : 後段で runAction（cropBounds は使わない）
      //  - 'none'        : 断ち切らない
      // region/action-ratio は srgb_convert.jsx の比率方式クロップで各PSDの実サイズに追従。
      const bleedState = useBleedStore.getState();
      const bleedMethod = bleedState.method;
      const epubBleedSettings =
        bleedMethod === 'region' ? bleedState.getBleedSettings() : undefined;
      const actionRatioBounds =
        bleedMethod === 'action-ratio' ? bleedState.getActionRatioCropBounds() : undefined;
      const cropBoundsForPsd = (srcPath: string) => {
        if (actionRatioBounds) return actionRatioBounds;
        if (!epubBleedSettings) return undefined;
        const info = psdChapterInfo.get(srcPath);
        if (!info) return undefined;
        const region = resolveBleedRegion(epubBleedSettings, info.type, info.id);
        if (!region || region.tachikiriType === 'none') return undefined;
        return {
          left: Math.max(0, Math.round(region.left)),
          top: Math.max(0, Math.round(region.top)),
          right: Math.max(0, Math.round(region.right)),
          bottom: Math.max(0, Math.round(region.bottom)),
          refWidth: Math.round(region.refWidth),
          refHeight: Math.round(region.refHeight),
          isProportional: true,
        };
      };

      if (psdSourcePaths.length > 0) {
        // モーダルへPSD変換フェーズを通知（タイマー込みで listener 起動を待つ）
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        await emit('epub-progress', { phase: 'psd-to-jpeg', current: 0, total: psdSourcePaths.length });

        // Script_Output 配下にJPEG変換出力（同名フォルダが既にあれば Rust 側で連番付与）
        const desktop = await desktopDir();
        const epubJpegDir = await join(desktop, 'Script_Output', `EPUB用JPEG_${projectName || '台割'}`);

        // 19.3 実験: 変換エンジンを選択。
        //  - 'photoshop': Photoshopの「プロファイル変換」で厳密にsRGB化（高品質）
        //  - 'native'(既定): image クレートで高速変換（ICC埋め込みのみ）
        // Photoshop未インストール時はネイティブにフォールバック。
        const wantPhotoshop = metadata.colorEngine === 'photoshop';
        const photoshopAvailable = wantPhotoshop
          ? await invoke<boolean>('check_photoshop_installed').catch(() => false)
          : false;
        const usePhotoshop = wantPhotoshop && photoshopAvailable;
        psdEngineUsed = usePhotoshop ? 'photoshop' : 'native';
        psdEngineFellBack = wantPhotoshop && !photoshopAvailable;

        let convertResponse: {
          results: { fileName: string; success: boolean; outputPath?: string; error?: string }[];
          outputDir: string;
        };
        try {
          if (usePhotoshop) {
            // Photoshop: プロファイル変換(sRGB / 相対比色＋黒点補正) → JPEG
            const psConfig = {
              files: psdSourcePaths.map((path, i) => ({
                path,
                outputPath: epubJpegDir,
                outputName: `psd_${String(i).padStart(4, '0')}.jpg`,
                // 内蔵・比率方式の断ち切り範囲（tachikiriMode==='bleed' 時のみ）
                ...(cropBoundsForPsd(path) ? { cropBounds: cropBoundsForPsd(path) } : {}),
              })),
              // jpegQuality 11: Photoshop の最高画質帯（10-12 は 4:4:4 サブサンプリング）。
              // preNormalized コピー経路ではこれが最終EPUB画質になるため、
              // q12 だと容量が倍近くなる一方で画質差はわずか → 11 をバランス点とする。
              // dither / maxPixels は Rust 側の既定（true / 5.6MP）を使用。
              // 断ち切り方式='action' のとき断ち切りアクションを各PSDに実行（色変換より前）。
              globalSettings: {
                jpegQuality: 11,
                intent: 'relative',
                blackPointCompensation: true,
                ...(bleedMethod === 'action' && bleedState.actionName
                  ? {
                      runAction: true,
                      actionSetPath: bleedState.actionSetPath,
                      actionName: bleedState.actionName,
                    }
                  : {}),
              },
            };
            convertResponse = await invoke('run_photoshop_srgb_convert', {
              config: psConfig,
              outputDir: epubJpegDir,
            });
          } else {
            // ネイティブ: 断ち切りなし・原寸・高品質（Photoshop不要）
            const config = {
              files: psdSourcePaths.map((path, i) => ({
                path,
                outputPath: epubJpegDir,
                outputName: `psd_${String(i).padStart(4, '0')}.jpg`,
                options: {
                  cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
                  tachikiriType: 'none',
                  strokeColor: 'black',
                  fillColor: 'white',
                  fillOpacity: 50,
                  referenceWidth: 0, referenceHeight: 0,
                  resizeMode: 'none',
                  resizePercent: 50,
                  jpegQuality: 95,
                },
              })),
            };
            convertResponse = await invoke('run_native_jpeg_convert', {
              config,
              outputDir: epubJpegDir,
            });
          }
        } catch (e) {
          setExportResultDialog({
            show: true,
            title: 'PSD→JPEG変換失敗',
            message: `PSDのJPEG変換中にエラーが発生しました: ${e}`,
            isError: true,
          });
          return;
        }

        const failedResults = convertResponse.results.filter((r) => !r.success);
        if (failedResults.length > 0) {
          const errMsg = failedResults.map((r) => `${r.fileName}: ${r.error ?? '不明なエラー'}`).join('\n');
          setExportResultDialog({
            show: true,
            title: 'PSD→JPEG変換失敗',
            message: `${failedResults.length}件のPSDをJPEGに変換できませんでした`,
            details: errMsg,
            isError: true,
          });
          return;
        }

        // マップ構築（PSD元パス → 生成されたJPEGパス）
        psdSourcePaths.forEach((srcPath, i) => {
          const result = convertResponse.results[i];
          if (result?.success) {
            const jpegPath = result.outputPath ?? `${convertResponse.outputDir}\\psd_${String(i).padStart(4, '0')}.jpg`;
            psdToJpegMap.set(srcPath, jpegPath);
          }
        });

        // フェーズをEPUB側に戻す
        await emit('epub-progress', { phase: 'images', current: 0, total: 0 });
      }

      // ページ情報を構築
      const epubGeneratePages: EpubPage[] = [];
      let pageNumber = 1;
      let coverAssigned = false;
      let colophonAssignedFromChapter = false;
      let nonBlankCount = 0;
      const hasExplicitCover = chapters.some((chapter) =>
        chapter.pages.some((page) => {
          const isBlankPage =
            page.pageType === 'blank' || (chapter.type === 'blank' && !page.filePath);
          if (isBlankPage || !page.filePath) return false;
          const previewPage = epubPreviewPageByOriginalId.get(page.id);
          return !!previewPage?.isCover || chapter.type === 'cover' || page.pageType === 'cover';
        })
      );
      const eligibleImagePageIds = chapters.flatMap((chapter) =>
        chapter.pages
          .filter((page) => {
            const isBlankPage =
              page.pageType === 'blank' || (chapter.type === 'blank' && !page.filePath);
            if (isBlankPage || !page.filePath) return false;
            return !(isLegacyHybrid && (chapter.type === 'colophon' || page.pageType === 'colophon'));
          })
          .map((page) => page.id)
      );
      const fallbackColophonPageId = eligibleImagePageIds[eligibleImagePageIds.length - 1];
      const hasExplicitColophon = chapters.some((chapter) =>
        chapter.pages.some((page) => {
          const isBlankPage =
            page.pageType === 'blank' || (chapter.type === 'blank' && !page.filePath);
          if (isBlankPage || !page.filePath) return false;
          if (isLegacyHybrid && (chapter.type === 'colophon' || page.pageType === 'colophon')) return false;
          const previewPage = epubPreviewPageByOriginalId.get(page.id);
          return !!previewPage?.isColophon || chapter.type === 'colophon' || page.pageType === 'colophon';
        })
      );

      for (const chapter of chapters) {
        for (const page of chapter.pages) {
          const isBlankPage =
            page.pageType === 'blank' || (chapter.type === 'blank' && !page.filePath);
          // ファイルがなく白紙でもないページは除外
          if (!isBlankPage && !page.filePath) {
            continue;
          }
          if (isLegacyHybrid && (chapter.type === 'colophon' || page.pageType === 'colophon')) {
            continue;
          }
          const previewPage = epubPreviewPageByOriginalId.get(page.id);

          const canBeCover = !isBlankPage && !!page.filePath;
          const isCover =
            !coverAssigned &&
            canBeCover &&
            (previewPage?.isCover ||
              chapter.type === 'cover' ||
              page.pageType === 'cover' ||
              (!hasExplicitCover && canBeCover));
          if (isCover) {
            coverAssigned = true;
          }

          const isColophon =
            canBeCover &&
            !isCover &&
            (previewPage?.isColophon ||
              page.pageType === 'colophon' ||
              (!colophonAssignedFromChapter && chapter.type === 'colophon') ||
              (!hasExplicitColophon && page.id === fallbackColophonPageId));
          if ((chapter.type === 'colophon' || previewPage?.isColophon) && isColophon) {
            colophonAssignedFromChapter = true;
          }

          // PSDが含まれていればJPEG変換後のパスに置き換える
          const isPsdConverted = !!(page.filePath && psdToJpegMap.has(page.filePath));
          const resolvedFilePath = isPsdConverted
            ? psdToJpegMap.get(page.filePath!)!
            : page.filePath;

          // 画像サイズを取得（白紙はバックエンドで多数派サイズに置換される）
          let width = 0;
          let height = 0;
          if (!isBlankPage && resolvedFilePath) {
            try {
              const dimensions = await invoke<[number, number]>('get_image_dimensions', {
                path: resolvedFilePath,
              });
              width = dimensions[0];
              height = dimensions[1];
            } catch {
              console.warn(`画像サイズ取得失敗: ${resolvedFilePath}`);
              width = generateMetadata.viewportWidth;
              height = generateMetadata.viewportHeight;
            }
            nonBlankCount++;
          }

          // ページIDを生成
          const pageId = isCover
            ? 'p-cover'
            : isColophon
            ? 'p-colophon'
            : `p-${String(pageNumber).padStart(3, '0')}`;

          // ファイル名を生成（白紙・PSD変換後は .jpg 固定）
          const ext = isBlankPage || isPsdConverted
            ? 'jpg'
            : resolvedFilePath?.split('.').pop()?.toLowerCase() || 'jpg';
          const filename = isCover
            ? `cover.${ext}`
            : isColophon
            ? `colophon.${ext}`
            : `${String(pageNumber).padStart(4, '0')}.${ext}`;

          epubGeneratePages.push({
            id: pageId,
            filename,
            sourcePath: isBlankPage ? '' : resolvedFilePath || '',
            width,
            height,
            isCover,
            isColophon,
            isBlank: isBlankPage,
            sourceColorMode: page.imageColorMode,
            imageProfileOverride: previewPage?.imageProfileOverride,
            // 19.3: Photoshopエンジンで sRGB 変換済みのページは builder の再エンコードを回避
            preNormalized: isPsdConverted && psdEngineUsed === 'photoshop' ? true : undefined,
          });

          if (!isCover && !isColophon) {
            pageNumber++;
          }
        }
      }

      if (nonBlankCount === 0) {
        setExportResultDialog({
          show: true,
          title: 'EPUB生成失敗',
          message: '白紙ページのみではEPUBを生成できません。画像ページを追加してください',
          isError: true,
        });
        return;
      }

      // 19.3: Photoshopエンジン指定だが未インストールでフォールバックした場合の注記
      const engineNote = psdEngineFellBack
        ? '\n\n※Photoshopが見つからなかったため、PSD変換は高速（ネイティブ）エンジンで実行しました'
        : '';

      if (splitSettings?.enabled) {
        const splitMetadata: EpubMetadata = {
          ...generateMetadata,
          allowMissingColophon: true,
        };
        const outputs: string[] = [];
        const failures: string[] = [];
        const checkSummaries: string[] = [];
        let hasCheckIssue = false;
        let totalFileSize = 0;
        let totalPageCount = 0;

        // 保存済みの巻情報（安定キー → UUID）。再生成時に同じ巻へ同じUUIDを使い回す
        const savedVolumes = useStore.getState().epubState?.split?.volumes ?? [];
        const savedVolumeByKey = new Map(savedVolumes.map((v) => [v.key, v]));
        const usedVolumes: SavedEpubVolume[] = [];

        for (let i = 0; i < splitSettings.ranges.length; i++) {
          const range = splitSettings.ranges[i];
          const volumePages = epubGeneratePages.slice(range.startIndex, range.endIndex + 1);
          const volumeNonBlankCount = volumePages.filter((page) => !page.isBlank).length;
          if (volumePages.length === 0 || volumeNonBlankCount === 0) {
            failures.push(`分割 ${i + 1}: 画像ページがありません`);
            continue;
          }

          const volumeOutputPath = buildSplitOutputPath(outputPath, splitSettings, i);
          const volumeTitle = splitSettings.titles?.[i]?.trim() || splitMetadata.title;
          const volumeTitleFileAs =
            splitSettings.titleFileAsList?.[i]?.trim() ||
            splitMetadata.titleFileAs;
          // 巻UUID: 保存値があれば再利用（電子書店側で「同じ巻の更新版」と認識させる）
          const volumeKey = splitVolumeKey(
            splitSettings.baseName,
            splitSettings.suffixSeparator,
            splitSettings.suffixStart,
            splitSettings.suffixDigits,
            i,
          );
          const volumeBookUuid =
            savedVolumeByKey.get(volumeKey)?.bookUuid ??
            (await invoke<string>('generate_book_uuid'));
          usedVolumes.push({
            key: volumeKey,
            title: volumeTitle,
            titleFileAs: volumeTitleFileAs,
            bookUuid: volumeBookUuid,
          });
          const volumeMetadata: EpubMetadata = {
            ...splitMetadata,
            title: volumeTitle,
            titleFileAs: volumeTitleFileAs,
            bookUuid: volumeBookUuid,
          };
          const response = await invoke<EpubGenerateResponse>('generate_epub', {
            metadata: volumeMetadata,
            pages: buildSplitVolumePages(volumePages),
            outputPath: volumeOutputPath,
            customCss: null,
          });

          if (!response.success) {
            failures.push(`分割 ${i + 1}: ${response.error || 'EPUB生成中にエラーが発生しました'}`);
            continue;
          }

          outputs.push(response.outputPath || volumeOutputPath);
          totalFileSize += response.fileSize;
          totalPageCount += response.pageCount;

          try {
            await emit('epub-progress', { phase: 'epubcheck', current: 0, total: 0 });
            const epubCheckResult = await invoke<EpubCheckResult>('validate_epub_with_epubcheck', {
              epubPath: response.outputPath || volumeOutputPath,
            });
            const message = buildEpubCheckMessage(epubCheckResult);
            const details = formatEpubCheckDetails(epubCheckResult);
            checkSummaries.push(`分割 ${i + 1}: ${message}${details ? `\n${details}` : ''}`);
            if (!epubCheckResult.isValid || !epubCheckResult.available) {
              hasCheckIssue = true;
            }
          } catch (epubCheckError) {
            hasCheckIssue = true;
            checkSummaries.push(`分割 ${i + 1}: EPUBCheckを実行できませんでした\n${epubCheckError}`);
          }

          // 自前の内部整合性チェック（EPUBCheckが使えない環境でも参照切れを検出）
          const internal = await runInternalVerify(response.outputPath || volumeOutputPath);
          checkSummaries.push(`分割 ${i + 1}: ${internal.summary}`);
          if (internal.failed) hasCheckIssue = true;
        }

        // 巻情報を永続化（今回使った巻を優先しつつ、過去の未使用キーも温存して範囲編集に備える）
        {
          const prevState = useStore.getState().epubState;
          const retained = (prevState?.split?.volumes ?? []).filter(
            (v) => !usedVolumes.some((u) => u.key === v.key),
          );
          useStore.getState().updateEpubState({
            split: {
              enabled: true,
              baseName: splitSettings.baseName,
              suffixStart: splitSettings.suffixStart,
              suffixDigits: splitSettings.suffixDigits,
              suffixSeparator: splitSettings.suffixSeparator,
              ranges: splitSettings.ranges,
              volumes: [...usedVolumes, ...retained],
            },
          });
        }

        const checkDetailsText = checkSummaries.length > 0
          ? `EPUBCheck結果:\n${checkSummaries.join('\n\n')}`
          : '';
        const outputDetailsText = outputs.length > 0
          ? `出力:\n${outputs.join('\n')}`
          : '';

        if (failures.length > 0) {
          setExportResultDialog({
            show: true,
            title: outputs.length > 0 ? '分割EPUB生成完了（一部失敗）' : '分割EPUB生成失敗',
            message: `${outputs.length}件のEPUBを生成しました / ${failures.length}件失敗しました`,
            details: [`失敗:\n${failures.join('\n')}`, checkDetailsText, outputDetailsText].filter(Boolean).join('\n\n') || undefined,
            outputDir: outputs[0],
            isError: true,
          });
          return;
        }

        const fileSizeMB = (totalFileSize / (1024 * 1024)).toFixed(2);
        setExportResultDialog({
          show: true,
          title: hasCheckIssue ? '分割EPUB生成完了（チェック要確認）' : '分割EPUB生成完了',
          message: `${outputs.length}件のEPUBを生成しました\n合計 ${totalPageCount}ページ / ${fileSizeMB}MB${engineNote}`,
          details: [checkDetailsText, outputDetailsText].filter(Boolean).join('\n\n') || undefined,
          outputDir: outputs[0],
          isError: hasCheckIssue,
        });
        return;
      }

      // EPUB生成
      const response = await invoke<EpubGenerateResponse>('generate_epub', {
        metadata: generateMetadata,
        pages: epubGeneratePages,
        outputPath,
        customCss: null,
      });

      if (response.success) {
        // ファイルサイズを人間が読みやすい形式に
        const fileSizeMB = (response.fileSize / (1024 * 1024)).toFixed(2);
        const profileSummary = response.imageProfileSummary;
        const profileMessage = profileSummary
          ? `\n\n画像プロファイル: sRGB ${profileSummary.rgbSrgbCount}件 / Adobe RGB ${profileSummary.adobeRgbCount}件 / グレーDot Gain ${profileSummary.grayscaleDotGainCount}件 / ICCなし ${profileSummary.noIccCount}件 / グレーICC未設定 ${profileSummary.grayscaleNoProfileCount}件 / 原本維持 ${profileSummary.preservedOriginalCount}件`
          : '';
        const profileWarnings = profileSummary?.warnings?.length
          ? profileSummary.warnings.join('\n')
          : undefined;
        let epubCheckMessage = '';
        let epubCheckDetails: string | undefined;
        let epubCheckFailed = false;
        try {
          await emit('epub-progress', { phase: 'epubcheck', current: 0, total: 0 });
          const epubCheckResult = await invoke<EpubCheckResult>('validate_epub_with_epubcheck', {
            epubPath: response.outputPath || outputPath,
          });
          epubCheckMessage = `\n\n${buildEpubCheckMessage(epubCheckResult)}`;
          epubCheckDetails = formatEpubCheckDetails(epubCheckResult);
          epubCheckFailed = epubCheckResult.available && !epubCheckResult.isValid;
        } catch (epubCheckError) {
          epubCheckMessage = '\n\nEPUBCheckを実行できなかったため、生成後チェックは完了していません。';
          epubCheckDetails = `${epubCheckError}`;
          epubCheckFailed = false;
        }
        // 自前の内部整合性チェック（OPF/XHTML参照とZIP実体の突き合わせ）
        const internal = await runInternalVerify(response.outputPath || outputPath);
        if (internal.failed) epubCheckFailed = true;
        const details = [profileWarnings, epubCheckDetails, internal.summary].filter(Boolean).join('\n\n');
        setExportResultDialog({
          show: true,
          title: epubCheckFailed ? 'EPUB生成完了（チェック要確認）' : 'EPUB生成完了',
          message: `EPUBを生成しました\n${response.pageCount}ページ / ${fileSizeMB}MB${profileMessage}${engineNote}${epubCheckMessage}`,
          details: details || undefined,
          outputDir: response.outputPath || outputPath,
          isError: epubCheckFailed,
        });
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

    // サイドバーのチャプターアイテム上 → そのチャプターの末尾に追加
    if (element) {
      const sidebarChapter = element.closest('.chapter-item[data-chapter-id]');
      if (sidebarChapter) {
        const chapterId = sidebarChapter.getAttribute('data-chapter-id');
        if (chapterId) {
          return { pageId: null, chapterId, mode: 'append-chapter' as const, insertPosition: null };
        }
      }
    }

    // プレビューエリアのチャプターヘッダー上 → そのチャプターの末尾に追加
    if (element) {
      const previewChapterHeader = element.closest('.chapter-underline-header[data-chapter-id]');
      if (previewChapterHeader) {
        const chapterId = previewChapterHeader.getAttribute('data-chapter-id');
        if (chapterId) {
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
      // 画像ファイル / PDF / フォルダ候補に分類
      const imageExtensions = ['jpg', 'jpeg', 'png', 'psd', 'tif', 'tiff'];
      const imagePaths: string[] = [];
      const pdfPaths: string[] = [];
      const folderCandidates: string[] = [];
      for (const p of paths) {
        const ext = p.split('.').pop()?.toLowerCase();
        if (ext === 'pdf') {
          pdfPaths.push(p);
        } else if (ext && imageExtensions.includes(ext)) {
          imagePaths.push(p);
        } else {
          folderCandidates.push(p);
        }
      }

      // フォルダ単位で取り込み内容をまとめる（後で分割ダイアログ判定にも利用）
      const folderEntries: SplitFolderEntry[] = [];
      const pdfErrors: { pdfName: string; message: string }[] = [];
      // 個別ファイル: 親フォルダ単位でグルーピング
      const parentFolderSet = new Set<string>();
      for (const p of imagePaths) {
        const folder = p.replace(/[^\\/]+$/, '');
        if (folder) parentFolderSet.add(folder);
      }
      for (const folder of parentFolderSet) {
        try {
          const files: FileInfo[] = await invoke('get_folder_contents', { folderPath: folder });
          const matched = files.filter(f => imagePaths.includes(f.path));
          if (matched.length > 0) {
            folderEntries.push({
              folderPath: folder,
              folderName: getFolderName(folder),
              files: matched,
            });
          }
        } catch (e) {
          console.error('Failed to read folder:', folder, e);
        }
      }

      // 個別 PDF: それぞれを独立した folderEntry として追加（複数 PDF→分割ダイアログ）
      for (const pdfPath of pdfPaths) {
        const pdfName = pdfPath.split(/[\\/]/).pop() ?? pdfPath;
        const stem = pdfName.replace(/\.pdf$/i, '');
        const parentFolder = pdfPath.replace(/[^\\/]+$/, '');
        const pdfEntry: FileInfo = {
          path: pdfPath, name: pdfName, size: 0, modified_time: 0, file_type: 'pdf',
        };
        const expanded = await expandPdfFiles([pdfEntry]);
        if (expanded.errors.length > 0) pdfErrors.push(...expanded.errors);
        if (expanded.files.length > 0) {
          folderEntries.push({
            folderPath: parentFolder,
            folderName: stem,
            files: expanded.files,
          });
        }
      }

      // フォルダ候補: 直接 get_folder_contents を試行（成功したらフォルダごとにエントリ追加。PDF を含めば展開）
      for (const candidate of folderCandidates) {
        try {
          const files: FileInfo[] = await invoke('get_folder_contents', { folderPath: candidate });
          const expanded = await expandPdfFiles(files);
          if (expanded.errors.length > 0) pdfErrors.push(...expanded.errors);
          if (expanded.files.length > 0) {
            folderEntries.push({
              folderPath: candidate,
              folderName: getFolderName(candidate),
              files: expanded.files,
            });
          }
        } catch {
          // フォルダではない or 読み取り不可はスキップ
        }
      }

      notifyPdfExpansionErrors(pdfErrors);

      const droppedFiles: FileInfo[] = folderEntries.flatMap(e => e.files);

      if (droppedFiles.length === 0) {
        return;
      }

      // 最新の状態を取得（ハンドラー定義時の古い値ではなく）
      const currentState = useStore.getState();
      const currentChapters = currentState.chapters;
      const currentSelectedChapterId = currentState.selectedChapterId;

      // 2 個以上のフォルダがチャプターにドロップされた場合は分割ダイアログを表示
      // （白紙はファイルを持たないため除外。他のすべてのチャプタータイプで対応）
      if (mode === 'append-chapter' && targetChapterId && folderEntries.length >= 2) {
        const targetChapter = currentChapters.find(c => c.id === targetChapterId);
        if (targetChapter && targetChapter.type !== 'blank') {
          setSplitFoldersDialog({
            folders: folderEntries,
            targetChapterId,
            open: true,
          });
          return;
        }
      }

      // モードに応じて処理
      if (mode === 'new-chapter-start') {
        // 先頭に新しいチャプターを作成してそこに追加
        const folderName = folderEntries.length === 1 ? folderEntries[0].folderName : '';
        const chapterSubtitle = getSubtitleForImportedFolder(folderName, 'chapter');
        const newChapterId = addChapter(
          'chapter',
          getDefaultNameForImportedFolder(folderName, 'chapter'),
          false,
          0
        );
        if (chapterSubtitle) {
          updateChapterSubtitle(newChapterId, chapterSubtitle);
        }
        selectChapter(newChapterId);
        addPagesToChapter(newChapterId, droppedFiles);
      } else if (mode === 'new-chapter') {
        // 末尾に新しいチャプターを作成してそこに追加
        const folderName = folderEntries.length === 1 ? folderEntries[0].folderName : '';
        const chapterSubtitle = getSubtitleForImportedFolder(folderName, 'chapter');
        const newChapterId = addChapter(
          'chapter',
          getDefaultNameForImportedFolder(folderName, 'chapter')
        );
        if (chapterSubtitle) {
          updateChapterSubtitle(newChapterId, chapterSubtitle);
        }
        selectChapter(newChapterId);
        addPagesToChapter(newChapterId, droppedFiles);
      } else if (mode === 'append-chapter' && targetChapterId) {
        // 指定チャプターの末尾に追加
        const targetChapter = currentChapters.find(c => c.id === targetChapterId);
        if (targetChapter?.type === 'chapter' && folderEntries.length === 1) {
          const importedName = getDefaultNameForImportedFolder(folderEntries[0].folderName, targetChapter.type);
          const importedSubtitle = getSubtitleForImportedFolder(folderEntries[0].folderName, targetChapter.type);
          if (importedName && importedName !== targetChapter.name) {
            renameChapter(targetChapterId, importedName);
          }
          if (importedSubtitle && importedSubtitle !== targetChapter.subtitle) {
            updateChapterSubtitle(targetChapterId, importedSubtitle);
          }
        }
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
          const folderName = folderEntries.length === 1 ? folderEntries[0].folderName : '';
          const chapterSubtitle = getSubtitleForImportedFolder(folderName, 'chapter');
          chapterId = addChapter(
            'chapter',
            getDefaultNameForImportedFolder(folderName, 'chapter')
          );
          if (chapterSubtitle) {
            updateChapterSubtitle(chapterId, chapterSubtitle);
          }
          selectChapter(chapterId);
        } else {
          const targetChapter = currentChapters.find(c => c.id === chapterId);
          if (targetChapter?.type === 'chapter' && folderEntries.length === 1) {
            const importedName = getDefaultNameForImportedFolder(folderEntries[0].folderName, targetChapter.type);
            const importedSubtitle = getSubtitleForImportedFolder(folderEntries[0].folderName, targetChapter.type);
            if (importedName && importedName !== targetChapter.name) {
              renameChapter(chapterId, importedName);
            }
            if (importedSubtitle && importedSubtitle !== targetChapter.subtitle) {
              updateChapterSubtitle(chapterId, importedSubtitle);
            }
          }
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
          <div className="main-header">
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

              <div className="header-divider" />
              {/* 工程タブ（台割 / 断ち切り / 出力） */}
              <div className="view-tabs" ref={viewTabsRef}>
                <SlidingIndicator rect={tabIndicator} className="view-tab-indicator" />
                <button
                  type="button"
                  className={`view-tab ${activeTab === 'compose' ? 'active' : ''}`}
                  onClick={() => handleTabChange('compose')}
                >
                  <GridViewIcon size={15} />
                  台割
                </button>
                <button
                  type="button"
                  className={`view-tab ${activeTab === 'bleed' ? 'active' : ''}`}
                  onClick={() => handleTabChange('bleed')}
                  disabled={allPages.length === 0}
                >
                  <ScissorsIcon size={15} />
                  断ち切り
                </button>
                <button
                  type="button"
                  className={`view-tab ${activeTab === 'output' ? 'active' : ''}`}
                  onClick={() => handleTabChange('output')}
                  disabled={allPages.length === 0}
                >
                  <ExportIcon size={15} />
                  出力
                </button>
              </div>

              <div className="header-divider" />
              {/* プロジェクト操作（開く / 保存） */}
              <div className="header-project-actions">
                <button
                  className="header-project-btn"
                  onClick={() => void handleOpenProject()}
                  title="プロジェクトを開く (Ctrl+O)"
                >
                  <OpenProjectIcon size={18} />
                  <span>開く</span>
                </button>
                <button
                  className="header-project-btn"
                  onClick={() => void handleSaveProject()}
                  title={currentProjectPath ? `保存: ${currentProjectPath}` : 'プロジェクトを保存 (Ctrl+S)'}
                >
                  <SaveIcon size={18} />
                  <span>保存</span>
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
          </div>

          {/* 工程タブに応じたコンテンツ表示 */}
          <div className="preview-container" style={{ '--screen-slide-from': screenSlideFrom } as CSSProperties}>
            {/* 左スパイン: 台割ツリー（台割・出力タブと、断ち切りの一覧表示時に表示。範囲設定中は非表示） */}
            {(activeTab === 'compose' || activeTab === 'output' || (activeTab === 'bleed' && !isBleedEditing)) && (
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
                  <SortableContext
                    items={chapters.map((c) => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {chapters.map((chapter) => (
                      <ChapterItem
                        key={chapter.id}
                        chapter={chapter}
                        isExiting={exitingChapterIds.has(chapter.id)}
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
                        onDuplicate={() => handleDuplicateChapter(chapter.id)}
                        onDeletePage={(pageId) => removePage(chapter.id, pageId)}
                        onAddFiles={() => handleAddPages(chapter.id)}
                        onAddFolder={() => handleAddFolder(chapter.id)}
                        onReplacePages={() => handleReplacePages(chapter.id)}
                        onRefreshChapterLinks={() => handleRefreshChapterLinks(chapter.id)}
                        onAddSpecialPage={(pageType, afterPageId) => addSpecialPage(chapter.id, pageType, afterPageId)}
                        onInsertFile={(afterPageId) => handleInsertFile(chapter.id, afterPageId)}
                        onSelectFile={handleSelectFile}
                        onRefreshFile={handleRefreshFile}
                        dropTarget={dropTarget}
                        isFileDropTarget={fileDropMode === 'append-chapter' && fileDropTargetChapterId === chapter.id}
                      />
                    ))}
                  </SortableContext>
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
                    onClick={() => handleAddChapter('title')}
                  >
                    +総扉
                  </button>
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => handleAddChapter('blank')}
                  >
                    +白紙
                  </button>
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => handleAddChapter('toc')}
                  >
                    +目次
                  </button>
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => handleAddChapter('chapter')}
                  >
                    +本文
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
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => handleAddChapter('ad')}
                  >
                    +AD
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
            )}

            {/* 中央＋右パネル: 工程タブで切替（左スパインは台割タブのみ） */}
            {activeTab === 'compose' ? (
            <>
            <div className="compose-center">
            <div className="compose-top-bar">
              <div className="compose-view-toggle" ref={composeViewToggleRef}>
                <SlidingIndicator rect={composeViewIndicator} className="compose-view-indicator" />
                <button
                  type="button"
                  className={`compose-view-btn ${previewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => handlePreviewModeChange('grid')}
                >
                  <GridViewIcon size={14} />
                  <span>リスト</span>
                </button>
                <button
                  type="button"
                  className={`compose-view-btn ${previewMode === 'spread' ? 'active' : ''}`}
                  onClick={() => handlePreviewModeChange('spread')}
                >
                  <BookOpenIcon size={14} />
                  <span>見開き</span>
                </button>
              </div>
              {/* 綴じ方向・ズーム・閲覧モード: トグルの反対側（右）。見開き以外・チャプター未読込時はグレーアウト */}
              <div className={`compose-viewer-controls ${previewMode === 'spread' && displayPages.length > 0 ? '' : 'disabled'}`}>
                <ViewerControls
                  bindingDirection={bindingDirection}
                  onBindingChange={setBindingDirection}
                  zoom={spreadZoom}
                  onZoomChange={setSpreadZoom}
                  onEnterViewerMode={enterViewerMode}
                  canEnterViewerMode={previewMode === 'spread' && displayPages.length > 0}
                />
              </div>
            </div>
            <div className="preview-area" ref={previewAreaRef}>
              {colorModeSummaryBar}
              {selectedPageIds.length > 1 && (
                <div className="selection-bar selection-bar-floating">
                  <span className="selection-count">{selectedPageIds.length}件選択中</span>
                  <button
                    className="btn-secondary btn-small"
                    onClick={clearPageSelection}
                  >
                    選択解除
                  </button>
                  <button
                    className="btn-primary btn-small btn-danger"
                    onClick={() => setDeleteConfirmDialog({
                      show: true,
                      type: 'pages',
                      pageCount: selectedPageIds.length,
                    })}
                  >
                    削除
                  </button>
                </div>
              )}
              {/* リスト/見開き切替時に、トグルの移動方向へスライドフェード（keyで再マウント。サマリ帯は外側なので影響なし） */}
              <div className="compose-stage" key={previewMode} style={{ '--compose-slide-from': composeSlideFrom } as CSSProperties}>
              {previewMode === 'spread' ? (
              <SpreadViewer
                key={displayPages.map(p => p.page.id).join(',')}
                pages={displayPages}
                selectedPageId={selectedPageId}
                selectedPageIds={selectedPageIds}
                onPageSelect={(chapterId, pageId, e) => {
                  if (e.ctrlKey || e.metaKey) {
                    selectChapter(chapterId);
                    togglePageSelection(pageId);
                    return;
                  }
                  if (e.shiftKey && selectedPageId) {
                    selectPageRange(selectedPageId, pageId);
                    return;
                  }
                  if (selectedPageId === pageId && selectedPageIds.length <= 1) {
                    selectPage(null);
                  } else {
                    selectChapter(chapterId);
                    selectPage(pageId);
                  }
                }}
                onReplaceFile={handleRefreshFile}
                isViewerMode={isViewerMode}
                onExitViewerMode={() => setIsViewerMode(false)}
                isPageBarVisible={isPageBarVisible}
                zoom={spreadZoom}
                onZoomChange={setSpreadZoom}
                bindingDirection={bindingDirection}
                onTogglePageBar={togglePageBar}
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
                  strategy={noShiftStrategy}
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
                                  const chapterDisplayTitle = getChapterDisplayTitle(group.chapter);

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
                                            <span className="chapter-block-title-stack">
                                              <span className="chapter-block-name">{chapterDisplayTitle.name}</span>
                                              {chapterDisplayTitle.subtitle && (
                                                <span className="chapter-block-subtitle">{chapterDisplayTitle.subtitle}</span>
                                              )}
                                            </span>
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
                                      ) : (() => {
                                        // 単一ドラッグ時のソース位置を取得（no-op判定用）
                                        const singleDraggedId = draggedPageIds.length === 1 ? draggedPageIds[0] : null;
                                        const sourceChapter = singleDraggedId
                                          ? chapters.find(c => c.pages.some(p => p.id === singleDraggedId))
                                          : null;
                                        const sourceChapterId = sourceChapter?.id ?? null;
                                        const sourceIdx = sourceChapter?.pages.findIndex(p => p.id === singleDraggedId) ?? -1;
                                        // ページがある場合：各ページにヘッダーとアンダーラインを付ける
                                        return pagesToShow.map((item, idx) => {
                                          // この対象ページのチャプター内インデックス
                                          const targetIdxInChapter = group.chapter.pages.findIndex(p => p.id === item.page.id);
                                          const isSameChapterDrag = singleDraggedId !== null && sourceChapterId === group.chapter.id;
                                          // no-op: 同チャプター内で隣接位置 or 自分自身へのドロップ
                                          const isNoopBefore = isSameChapterDrag && (sourceIdx === targetIdxInChapter || sourceIdx === targetIdxInChapter - 1);
                                          const isNoopAfter = isSameChapterDrag && (sourceIdx === targetIdxInChapter || sourceIdx === targetIdxInChapter + 1);
                                          const isInternalBefore = !!(dropTarget?.pageId === item.page.id && activeId && dropTarget?.type === 'page-before' && !isNoopBefore);
                                          const isInternalAfter = !!(dropTarget?.pageId === item.page.id && activeId && dropTarget?.type === 'page-after' && !isNoopAfter);
                                          const isFileBefore = !!(fileDropTargetPageId === item.page.id && isDraggingFiles && insertPosition === 'before');
                                          const isFileAfter = !!(fileDropTargetPageId === item.page.id && isDraggingFiles && insertPosition === 'after');
                                          const showBeforePlaceholder = isInternalBefore || isFileBefore;
                                          const showAfterPlaceholder = isInternalAfter || isFileAfter;
                                          const placeholderVariant = (isFileBefore || isFileAfter) ? 'file-drop' : '';
                                          return (
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
                                                <span className="chapter-block-title-stack">
                                                  <span className="chapter-block-name">{chapterDisplayTitle.name}</span>
                                                  {chapterDisplayTitle.subtitle && (
                                                    <span className="chapter-block-subtitle">{chapterDisplayTitle.subtitle}</span>
                                                  )}
                                                </span>
                                              </div>
                                            )}
                                            {/* ページ */}
                                            <div className="thumbnail-wrapper-with-indicator chapter-flow-page">
                                              {showBeforePlaceholder && (
                                                <DropPlaceholder
                                                  id={`ph:before:${item.page.id}`}
                                                  width={thumbnailSizeValue}
                                                  height={thumbnailSizeValue * 1.4}
                                                  side="before"
                                                  variant={placeholderVariant || undefined}
                                                />
                                              )}
                                              {showAfterPlaceholder && (
                                                <DropPlaceholder
                                                  id={`ph:after:${item.page.id}`}
                                                  width={thumbnailSizeValue}
                                                  height={thumbnailSizeValue * 1.4}
                                                  side="after"
                                                  variant={placeholderVariant || undefined}
                                                />
                                              )}
                                              <ThumbnailCard
                                                page={item.page}
                                                globalIndex={item.globalIndex}
                                                thumbnailSize={thumbnailSizeValue}
                                                isHighlighted={item.page.id === highlightedPageId}
                                                isSelected={item.page.id === selectedPageId}
                                                isMultiSelected={selectedPageIds.includes(item.page.id)}
                                                isDimmed={
                                                  item.page.pageType === 'file' &&
                                                  (
                                                    (hoveredColorMode !== null && item.page.imageColorMode !== hoveredColorMode) ||
                                                    (hoveredImageSizeKey !== null && getImageSizeGroupInfo(item.page)?.key !== hoveredImageSizeKey)
                                                  )
                                                }
                                                alertColor={getPageExceptionColor(item.page)}
                                                chapterType={item.chapter.type}
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
                                                onReplaceFile={() => handleRefreshFile(item.page.id)}
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
                                          );
                                        });
                                      })()}
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
            </div>
            </div>

            {/* 右: 選択ページ情報パネル（台割タブ） */}
            <aside className={`sidebar sidebar-right ${isInfoSidebarCollapsed ? 'collapsed' : ''}`}>
              <div className="sidebar-header">
                <button
                  className="sidebar-toggle-btn"
                  onClick={() => setIsInfoSidebarCollapsed(!isInfoSidebarCollapsed)}
                  title={isInfoSidebarCollapsed ? '情報パネルを展開' : '情報パネルを折り畳む'}
                >
                  {isInfoSidebarCollapsed ? '«' : '»'}
                </button>
              </div>
              <div className="sidebar-content">
                {/* 選択中PSDをPhotoshopで開く（選択がすべてPSDのとき） */}
                {(() => {
                  const selectedPages = selectedPageIds.length > 0
                    ? allPages.filter(p => selectedPageIds.includes(p.page.id))
                    : selectedPageId
                      ? allPages.filter(p => p.page.id === selectedPageId)
                      : [];
                  const psdPages = selectedPages.filter(p => p.page.filePath?.toLowerCase().endsWith('.psd'));
                  if (psdPages.length === 0 || psdPages.length !== selectedPages.length) return null;
                  const psdPaths = psdPages.map(p => p.page.filePath!);
                  return (
                    <button
                      className="info-photoshop-btn"
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
                    >
                      <span className="photoshop-label">Ps</span>
                      <span>{psdPaths.length > 1 ? `Photoshopで開く (${psdPaths.length})` : 'Photoshopで開く'}</span>
                    </button>
                  );
                })()}
                {selectedPageInfo ? (
                  <div className="info-panel">
                    {selectedPageInfo.page.thumbnailStatus === 'ready' && selectedPageInfo.page.thumbnailCachePath ? (
                      <div className="info-thumbnail">
                        <img
                          src={convertFileSrc(selectedPageInfo.page.thumbnailCachePath)}
                          alt={selectedPageInfo.page.fileName ?? ''}
                          draggable={false}
                        />
                      </div>
                    ) : (
                      <div className="info-thumbnail info-thumbnail-empty">
                        <span>プレビューなし</span>
                      </div>
                    )}
                    {selectedPageInfo.page.fileName && (
                      <div className="info-filename" title={selectedPageInfo.page.fileName}>
                        {selectedPageInfo.page.fileName}
                      </div>
                    )}
                    <dl className="info-meta">
                      <dt>サイズ</dt>
                      <dd>
                        {selectedPageInfo.page.imageWidth && selectedPageInfo.page.imageHeight ? (
                          <>
                            {selectedPageInfo.page.imageWidth} × {selectedPageInfo.page.imageHeight} px
                            {(() => {
                              const desc = describePhysicalSize(
                                selectedPageInfo.page.imageWidth,
                                selectedPageInfo.page.imageHeight,
                                selectedPageInfo.page.imageDpi
                              );
                              return desc ? <div className="info-meta-sub">{desc}</div> : null;
                            })()}
                          </>
                        ) : (
                          '—'
                        )}
                      </dd>
                      <dt>カラーモード</dt>
                      <dd>
                        {(() => {
                          const labels: Record<string, string> = {
                            RGB: 'RGB',
                            Grayscale: 'グレースケール',
                            CMYK: 'CMYK',
                            Bitmap: 'ビットマップ',
                            Indexed: 'インデックスカラー',
                            Multichannel: 'マルチチャンネル',
                            Duotone: 'ダブルトーン',
                            Lab: 'Lab',
                          };
                          const m = selectedPageInfo.page.imageColorMode;
                          return m ? labels[m] ?? m : '—';
                        })()}
                      </dd>
                      <dt>解像度</dt>
                      <dd>{selectedPageInfo.page.imageDpi !== undefined ? `${selectedPageInfo.page.imageDpi} dpi` : '—'}</dd>
                      <dt>形式</dt>
                      <dd>{selectedPageInfo.page.fileType ? selectedPageInfo.page.fileType.toUpperCase() : '—'}</dd>
                      <dt>ファイルサイズ</dt>
                      <dd>
                        {selectedPageInfo.page.fileSize !== undefined
                          ? selectedPageInfo.page.fileSize >= 1024 * 1024
                            ? `${(selectedPageInfo.page.fileSize / 1024 / 1024).toFixed(2)} MB`
                            : `${(selectedPageInfo.page.fileSize / 1024).toFixed(1)} KB`
                          : '—'}
                      </dd>
                      <dt>チャプター</dt>
                      <dd>{selectedPageInfo.chapter.name}</dd>
                    </dl>
                  </div>
                ) : (
                  <div className="info-panel-empty">
                    <InfoIcon size={48} />
                    <p>ページを選択すると<br />ここに情報が表示されます</p>
                  </div>
                )}
              </div>
            </aside>
            </>
            ) : activeTab === 'bleed' ? (
              <BleedTab
                isInfoSidebarCollapsed={isInfoSidebarCollapsed}
                setIsInfoSidebarCollapsed={setIsInfoSidebarCollapsed}
                onEditingChange={setIsBleedEditing}
                topBar={colorModeSummaryBar}
              />
            ) : (
              <OutputTab
                chapters={chapters}
                projectName={projectName}
                onExportImages={handleExportImages}
                onGenerateEpub={async (metadata, outputPath, splitSettings) => {
                  if (blockIfCmyk('epub')) return;
                  await handleEpubGenerate(metadata, outputPath, splitSettings);
                }}
                onGeneratePdf={handleGeneratePdf}
                zoom={spreadZoom}
                onZoomChange={setSpreadZoom}
                isViewerMode={isViewerMode}
                onExitViewerMode={() => setIsViewerMode(false)}
                isPageBarVisible={isPageBarVisible}
                bindingDirection={bindingDirection}
                onReplaceFile={handleRefreshFile}
                onBindingChange={setBindingDirection}
                onEnterViewerMode={enterViewerMode}
                onTogglePageBar={togglePageBar}
                topBar={colorModeSummaryBar}
              />
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
              thumbnailSize={80}
              dragCount={draggedPageIds.length}
            />
          )
        ) : null}
      </DragOverlay>

      {/* 複数フォルダ → チャプター分割ダイアログ */}
      {splitFoldersDialog && (() => {
        const currentChapters = useStore.getState().chapters;
        const targetChapter = currentChapters.find(c => c.id === splitFoldersDialog.targetChapterId);
        const targetType = targetChapter?.type ?? 'chapter';
        const typeLabel = CHAPTER_TYPE_LABELS[targetType];

        // 番号の若い順に並べ替え（自然順 / 全角数字も考慮）
        const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
        const sortedFolders = [...splitFoldersDialog.folders].sort((a, b) =>
          collator.compare(a.folderName, b.folderName)
        );

        // フォルダ名から番号を抽出して「N話」形式で命名（番号がなければ通し番号）
        const extractFolderNumber = (name: string): number | null => {
          const normalized = name.replace(/[０-９]/g, (c) =>
            String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
          );
          const m = normalized.match(/(\d+)/);
          return m ? parseInt(m[1], 10) : null;
        };
        const defaultNames = sortedFolders.map((folder, i) => {
          const num = extractFolderNumber(folder.folderName);
          const fallbackName = num !== null ? `${num}話` : `${i + 1}話`;
          return getDefaultNameForImportedFolder(folder.folderName, targetType, fallbackName) ?? fallbackName;
        });
        const defaultSubtitles = sortedFolders.map((folder) =>
          getSubtitleForImportedFolder(folder.folderName, targetType)
        );
        const rowAnnotations = sortedFolders.map((_, i) =>
          i === 0 ? '（ドロップ先）' : null
        );
        return (
          <SplitFoldersDialog
            isOpen={splitFoldersDialog.open}
            folders={sortedFolders}
            defaultNames={defaultNames}
            defaultSubtitles={defaultSubtitles}
            rowAnnotations={rowAnnotations}
            chapterTypeLabel={typeLabel}
            onCancel={closeSplitFoldersDialog}
            onConfirm={(selected: SplitFoldersDialogResult[]) => {
              if (!splitFoldersDialog) return;
              const latestChapters = useStore.getState().chapters;
              const targetIdx = latestChapters.findIndex(c => c.id === splitFoldersDialog.targetChapterId);
              const targetId = splitFoldersDialog.targetChapterId;
              const insertType = latestChapters[targetIdx]?.type ?? targetType;

              // 先頭行（ソート後の最初のフォルダ = ドロップ先に反映）が選択されているか
              const firstRowEnabled =
                sortedFolders.length > 0 &&
                selected.length > 0 &&
                selected[0].files === sortedFolders[0].files;

              if (firstRowEnabled && targetIdx >= 0) {
                // 1) ドロップ先チャプターをリネーム + 先頭フォルダの内容を追加
                const first = selected[0];
                if (first.name !== latestChapters[targetIdx].name) {
                  renameChapter(targetId, first.name);
                }
                if (first.subtitle && first.subtitle !== latestChapters[targetIdx].subtitle) {
                  updateChapterSubtitle(targetId, first.subtitle);
                }
                addPagesToChapter(targetId, first.files);

                // 2) 残りのフォルダはドロップ先の直後に新規チャプター（同じタイプ）として挿入
                const rest = selected.slice(1);
                if (rest.length > 0) {
                  insertChaptersFromFolders(targetIdx + 1, insertType, rest);
                }
                selectChapter(targetId);
              } else {
                // 先頭行が未選択 or ターゲットが見つからない: すべて新規挿入
                const insertAt = targetIdx >= 0 ? targetIdx + 1 : latestChapters.length;
                const newIds = insertChaptersFromFolders(insertAt, insertType, selected);
                if (newIds.length > 0) {
                  selectChapter(newIds[0]);
                }
              }
              closeSplitFoldersDialog();
            }}
          />
        );
      })()}

      {/* 自動更新ダイアログ */}
      <UpdateDialog
        state={autoUpdate.state}
        onInstall={autoUpdate.installPending}
        onDismiss={autoUpdate.dismiss}
      />

      {/* エクスポート結果ダイアログ */}
      {exportResultAnim.shouldRender && !tachimiPdfProgress && (
        <div className={`modal-overlay ${exportResultAnim.isClosing ? 'closing' : ''}`}>
          <div className={`modal-content export-result-dialog ${exportResultDialog.isError ? 'has-error' : ''} ${exportResultAnim.isClosing ? 'closing' : ''}`}>
            <div className={`result-icon ${exportResultDialog.isError ? 'error' : 'success'}`}>
              {exportResultDialog.isError ? <AlertTriangleIcon size={28} /> : <CheckIcon2 />}
            </div>
            <h2>{exportResultDialog.title}</h2>
            <p className="export-result-message">{exportResultDialog.message}</p>
            {exportResultDialog.details && (
              <div className="export-result-details">
                <pre>{exportResultDialog.details}</pre>
              </div>
            )}
            {exportResultDialog.outputDir && (
              <div className="export-result-output">
                <FolderIcon size={14} />
                <span className="output-path">{exportResultDialog.outputDir}</span>
              </div>
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
                    handleTabChange('output');
                  }}
                >
                  <BookIcon size={14} />
                  出力タブへ
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

      {/* チャプターPDF生成 進捗（独立した処理中ダイアログ） */}
      {tachimiPdfProgress && (() => {
        const percent = tachimiPdfProgress.indeterminate || tachimiPdfProgress.total <= 0
          ? 0
          : Math.min(100, Math.round((tachimiPdfProgress.current / tachimiPdfProgress.total) * 100));
        const phaseLabel =
          tachimiPdfProgress.phase === 'prepare' ? '準備中'
          : tachimiPdfProgress.phase === 'stage' ? 'ページ整理中'
          : tachimiPdfProgress.phase === 'generate' ? 'PDF生成中'
          : tachimiPdfProgress.phase === 'finalize' ? '確認中'
          : '完了';
        return (
          <div className="modal-overlay epub-progress-overlay">
            <div className="epub-progress-dialog">
              <div className="epub-progress-title">PDFを生成中</div>
              <div className="epub-progress-phase">{phaseLabel}</div>
              <div className="epub-progress-bar-track">
                <div
                  className={`epub-progress-bar-fill ${tachimiPdfProgress.indeterminate ? 'indeterminate' : ''}`}
                  style={tachimiPdfProgress.indeterminate ? undefined : { width: `${percent}%` }}
                />
              </div>
              <div className="epub-progress-meta">
                {tachimiPdfProgress.indeterminate || tachimiPdfProgress.total <= 0 ? (
                  <span>{tachimiPdfProgress.message}</span>
                ) : (
                  <>
                    <span>{tachimiPdfProgress.current} / {tachimiPdfProgress.total} ページ</span>
                    <span>{percent}%</span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* PDFラスタライズ進捗オーバーレイ */}
      {pdfRasterizeProgress && (() => {
        const total = pdfRasterizeProgress.total || 0;
        const cur = pdfRasterizeProgress.current || 0;
        const phase = pdfRasterizeProgress.phase;
        const isFetchPhase = phase === 'fetching' || phase === 'fetched';
        const isIndeterminate = phase === 'loading' || phase === 'fetching' || total === 0;
        const percent = isIndeterminate ? 0 : Math.min(100, Math.round((cur / total) * 100));
        const phaseLabel =
          phase === 'fetching' ? 'pdfium.dll を G:\\共有ドライブ から取得中…'
          : phase === 'fetched' ? 'pdfium.dll を配置しました'
          : phase === 'loading' ? 'PDFを読み込んでいます…'
          : phase === 'rendering' ? 'ページをレンダリング中'
          : phase === 'encoding' ? 'JPEGに書き出し中'
          : phase === 'done' ? '完了'
          : phase;
        const title = isFetchPhase
          ? 'PDFエンジン (pdfium.dll) のセットアップ'
          : `PDFを取り込み中: ${pdfRasterizeProgress.pdfName}`;
        return (
          <div className="modal-overlay epub-progress-overlay">
            <div className="epub-progress-dialog">
              <div className="epub-progress-title">{title}</div>
              <div className="epub-progress-phase">{phaseLabel}</div>
              <div className="epub-progress-bar-track">
                <div
                  className={`epub-progress-bar-fill ${isIndeterminate ? 'indeterminate' : ''}`}
                  style={isIndeterminate ? undefined : { width: `${percent}%` }}
                />
              </div>
              <div className="epub-progress-meta">
                {!isIndeterminate && !isFetchPhase && (
                  <span>{cur} / {total} ページ ({percent}%)</span>
                )}
                {isFetchPhase && (
                  <span className="output-path">{pdfRasterizeProgress.pdfName}</span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 削除確認ダイアログ */}
      {deleteConfirmAnim.shouldRender && (
        <div className={`modal-overlay ${deleteConfirmAnim.isClosing ? 'closing' : ''}`}>
          <div className={`modal-content delete-confirm-dialog ${deleteConfirmAnim.isClosing ? 'closing' : ''}`}>
            <div className="dialog-icon danger"><TrashIcon size={26} /></div>
            <h2>
              {deleteConfirmDialog.type === 'all'
                ? 'すべて削除'
                : deleteConfirmDialog.type === 'pages'
                ? 'ページ削除'
                : 'チャプター削除'}
            </h2>
            <p>
              {deleteConfirmDialog.type === 'all'
                ? `すべてのチャプター（${chapters.length}件、${deleteConfirmDialog.pageCount}ページ）を削除しますか？`
                : deleteConfirmDialog.type === 'pages'
                ? `選択中の${deleteConfirmDialog.pageCount}ページを削除しますか？`
                : `「${deleteConfirmDialog.chapterName}」（${deleteConfirmDialog.pageCount}ページ）を削除しますか？`
              }
            </p>
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
                    // 全チャプターをふわっと退場させてからクリア
                    const ids = chapters.map((c) => c.id);
                    setExitingChapterIds(new Set(ids));
                    window.setTimeout(() => {
                      clearChapters();
                      setExitingChapterIds(new Set());
                    }, 230);
                  } else if (deleteConfirmDialog.type === 'pages') {
                    removeSelectedPages();
                  } else if (deleteConfirmDialog.chapterId) {
                    animateRemoveChapter(deleteConfirmDialog.chapterId);
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

      {/* ウィンドウ終了確認ダイアログ */}
      {closeConfirmAnim.shouldRender && (
        <div className={`modal-overlay ${closeConfirmAnim.isClosing ? 'closing' : ''}`} onClick={() => setShowCloseConfirmDialog(false)}>
          <div
            className={`modal-content unsaved-dialog ${closeConfirmAnim.isClosing ? 'closing' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-icon warning"><AlertTriangleIcon size={26} /></div>
            <h2>アプリを終了しますか？</h2>
            <p>
              プロジェクトに未保存の変更があります。
              <br />
              保存してから終了できます。
            </p>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowCloseConfirmDialog(false)}
              >
                キャンセル
              </button>
              <button
                className="btn-primary"
                onClick={() => void handleSaveAndClose()}
              >
                保存して終了
              </button>
              <button
                className="btn-danger"
                onClick={handleConfirmClose}
              >
                保存せず終了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 未保存変更の破棄確認（プロジェクトを開く / 新規作成） */}
      {discardConfirmAnim.shouldRender && (
        <div
          className={`modal-overlay ${discardConfirmAnim.isClosing ? 'closing' : ''}`}
          onClick={() => resolveDiscardConfirm(false)}
        >
          <div
            className={`modal-content unsaved-dialog ${discardConfirmAnim.isClosing ? 'closing' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-icon warning"><AlertTriangleIcon size={26} /></div>
            <h2>未保存の変更があります</h2>
            <p>
              保存していない変更があります。
              <br />
              保存せずに続行しますか？
            </p>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => resolveDiscardConfirm(false)}>
                キャンセル
              </button>
              <button className="btn-danger" onClick={() => resolveDiscardConfirm(true)}>
                保存せず続行
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
        <div className="hamburger-update-section">
          <div className="hamburger-update-row">
            <span className="hamburger-update-label">バージョン</span>
            <span className="hamburger-update-version">
              {currentAppVersion ? `v${currentAppVersion}` : '—'}
            </span>
          </div>
          <button
            className="hamburger-update-btn"
            onClick={() => autoUpdate.checkForUpdate({ silent: false })}
            disabled={autoUpdate.state.state === 'checking' || autoUpdate.state.state === 'downloading' || autoUpdate.state.state === 'installing'}
          >
            <DownloadIcon size={16} />
            {autoUpdate.state.state === 'checking' ? '確認中…' : '更新を確認'}
          </button>
        </div>
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
      </div>
    </div>
    </>
  );
}

export default App;
