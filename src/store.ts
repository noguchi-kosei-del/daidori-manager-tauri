import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  Chapter,
  ChapterType,
  Page,
  PageType,
  PAGE_TYPE_LABELS,
  FileValidationStatus,
  SavedUiState,
  ValidationContext,
  ValidationGroupContext,

  EpubPageInfo,
  EpubMetadata,
  EPUB_FORMAT_VIEWPORTS,
} from './types';

// Tauri用のファイル情報型
export interface FileInfo {
  path: string;
  name: string;
  size: number;
  modified_time: number;
  file_type: string;
}

export type ThumbnailSize = 'small' | 'medium' | 'large';

export const THUMBNAIL_SIZES: Record<ThumbnailSize, { value: number; label: string }> = {
  small: { value: 100, label: '小' },
  medium: { value: 140, label: '中' },
  large: { value: 180, label: '大' },
};

// 履歴の最大サイズ
const MAX_HISTORY_SIZE = 50;

interface AppState {
  // プロジェクトデータ
  chapters: Chapter[];

  // プロジェクト状態
  currentProjectPath: string | null;
  projectName: string;
  isModified: boolean;
  lastSavedAt: Date | null;

  // 履歴管理
  history: Chapter[][];
  future: Chapter[][];

  // UI状態
  selectedChapterId: string | null;
  selectedPageId: string | null;
  selectedPageIds: string[];  // 複数選択
  viewMode: 'selection' | 'all';
  thumbnailSize: ThumbnailSize;

  // 検証コンテキスト（mismatch tooltip 表示用の最頻値情報）
  validationContext: ValidationContext;

  // EPUB_maker状態
  epubPages: EpubPageInfo[];
  epubMetadata: EpubMetadata | null;
  epubCustomCss: string;
  epubCurrentSpread: number;
  epubImageFolder: string | null;
  epubSelectedPageId: string | null;
  epubSelectedPageIds: string[];  // EPUB複数選択
  isEpubModified: boolean;

  // アクション: チャプター管理
  addChapter: (type: ChapterType, name?: string, skipInitialPage?: boolean, insertAt?: number) => string;
  removeChapter: (id: string) => void;
  clearChapters: () => void;
  renameChapter: (id: string, name: string) => void;
  updateChapterSubtitle: (id: string, subtitle?: string) => void;
  toggleChapterCollapsed: (id: string) => void;
  reorderChapters: (fromIndex: number, toIndex: number) => void;
  duplicateChapter: (id: string) => string | null;

  // アクション: ページ管理
  addPagesToChapter: (chapterId: string, files: FileInfo[]) => void;
  addPagesToChapterAt: (chapterId: string, files: FileInfo[], atIndex: number) => void;
  replacePagesInChapter: (chapterId: string, files: FileInfo[]) => void;
  insertChaptersFromFolders: (
    insertAt: number,
    type: ChapterType,
    folders: { name: string; subtitle?: string; files: FileInfo[] }[]
  ) => string[];
  addSpecialPage: (chapterId: string, pageType: PageType, afterPageId?: string) => void;
  setPageFile: (pageId: string, file: FileInfo | null) => void;
  removePage: (chapterId: string, pageId: string) => void;
  reorderPages: (chapterId: string, fromIndex: number, toIndex: number) => void;
  movePage: (fromChapterId: string, toChapterId: string, pageId: string, toIndex: number) => void;
  movePages: (pageIds: string[], toChapterId: string, toIndex: number) => void;

  // アクション: 選択
  selectChapter: (id: string | null) => void;
  selectPage: (id: string | null) => void;
  togglePageSelection: (pageId: string) => void;  // Ctrl+クリック用
  selectPageRange: (fromPageId: string, toPageId: string) => void;  // Shift+クリック用
  clearPageSelection: () => void;
  removeSelectedPages: () => void;  // 一括削除
  setThumbnailSize: (size: ThumbnailSize) => void;

  // アクション: サムネイル
  updatePageThumbnail: (pageId: string, cacheKey: string, cachePath: string) => void;
  setPageThumbnailError: (pageId: string) => void;

  // アクション: ファイル検証
  updatePagesValidation: (
    results: {
      pageId: string;
      status: FileValidationStatus;
      width?: number | null;
      height?: number | null;
      colorMode?: string | null;
      dpi?: number | null;
    }[]
  ) => void;

  // アクション: 履歴
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // アクション: プロジェクト管理
  setProjectPath: (path: string | null) => void;
  setProjectName: (name: string) => void;
  markAsModified: () => void;
  markAsSaved: (path: string) => void;
  resetProject: () => void;
  loadProjectState: (chapters: Chapter[], uiState?: SavedUiState) => void;

  // ヘルパー
  getAllPages: () => { page: Page; chapter: Chapter; globalIndex: number }[];
  getTotalPageCount: () => number;

  // アクション: EPUB_maker
  setEpubPages: (pages: EpubPageInfo[]) => void;
  setEpubMetadata: (metadata: EpubMetadata | null) => void;
  updateEpubMetadata: (updates: Partial<EpubMetadata>) => void;
  setEpubCustomCss: (css: string) => void;
  setEpubCurrentSpread: (index: number) => void;
  setEpubImageFolder: (folder: string | null) => void;
  setEpubSelectedPageId: (id: string | null) => void;
  toggleEpubPageSelection: (pageId: string) => void;
  selectEpubPageRange: (fromPageId: string, toPageId: string) => void;
  clearEpubPageSelection: () => void;
  reorderEpubPage: (fromIndex: number, toIndex: number) => void;
  setEpubPageAsCover: (pageId: string) => void;
  setEpubPageAsColophon: (pageId: string) => void;
  clearEpubPageCover: () => void;
  clearEpubPageColophon: (pageId: string) => void;
  loadEpubFromDaidori: () => void;
  resetEpubState: () => void;
  markEpubAsModified: () => void;
}

// デフォルトのチャプター名
const getDefaultChapterName = (type: ChapterType, chapters: Chapter[]): string => {
  switch (type) {
    case 'chapter': {
      const chapterCount = chapters.filter((c) => c.type === 'chapter').length;
      return `本文${chapterCount + 1}`;
    }
    case 'cover':
      return '表紙';
    case 'blank':
      return '白紙';
    case 'intermission':
      return '幕間';
    case 'colophon':
      return '奥付';
    case 'ad':
      return 'AD';
    case 'title':
      return '総扉';
    case 'toc':
      return '目次';
    default:
      return '新規';
  }
};

// ===== mismatch検知ヘルパー =====

// グループ内で最頻値を求める。値の出現が単一・全件None・全件同一の場合はundefinedを返す
function computeMajority<T>(values: (T | undefined | null)[]): T | undefined {
  const counts = new Map<string, { value: T; count: number }>();
  let total = 0;
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const key = String(v);
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { value: v, count: 1 });
    }
    total += 1;
  }
  if (total < 2) return undefined; // 比較対象が1件以下なら判定しない
  if (counts.size < 2) return undefined; // 全件同じ → 外れ値なし

  // 最頻値（同数の場合は任意の1つ）
  let best: { value: T; count: number } | undefined;
  for (const e of counts.values()) {
    if (!best || e.count > best.count) best = e;
  }
  return best?.value;
}

interface MismatchPageRef {
  pageId: string;
  width?: number;
  height?: number;
  colorMode?: string;
  dpi?: number;
  baseStatus: FileValidationStatus;
}

// chapters から mismatch ステータスを計算し、各ページに反映 + 最頻値コンテキストを返す
function applyMismatchStatuses(chapters: Chapter[]): {
  chapters: Chapter[];
  context: ValidationContext;
} {
  // cover チャプター / それ以外で分けてページ参照を集める
  const coverRefs: MismatchPageRef[] = [];
  const bodyRefs: MismatchPageRef[] = [];

  for (const c of chapters) {
    const target = c.type === 'cover' ? coverRefs : bodyRefs;
    for (const p of c.pages) {
      if (p.pageType !== 'file') continue; // 白紙等はスキップ
      target.push({
        pageId: p.id,
        width: p.imageWidth,
        height: p.imageHeight,
        colorMode: p.imageColorMode,
        dpi: p.imageDpi,
        baseStatus: p.fileValidationStatus ?? 'ok',
      });
    }
  }

  const buildGroup = (refs: MismatchPageRef[]): {
    ctx: ValidationGroupContext;
    mismatch: Map<string, FileValidationStatus>;
  } => {
    const sizeKeys = refs.map((r) =>
      r.width !== undefined && r.height !== undefined ? `${r.width}x${r.height}` : undefined
    );
    const colorKeys = refs.map((r) => r.colorMode);
    const dpiKeys = refs.map((r) => r.dpi);

    const majoritySize = computeMajority(sizeKeys);
    const majorityColorMode = computeMajority(colorKeys);
    const majorityDpi = computeMajority(dpiKeys);

    const mismatch = new Map<string, FileValidationStatus>();
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i];
      // 既に missing/modified/meta_error の場合は mismatch で上書きしない
      if (r.baseStatus === 'missing' || r.baseStatus === 'modified' || r.baseStatus === 'meta_error') {
        continue;
      }
      // 優先順位: size_mismatch > color_mismatch > dpi_mismatch
      if (
        majoritySize !== undefined &&
        sizeKeys[i] !== undefined &&
        sizeKeys[i] !== majoritySize
      ) {
        mismatch.set(r.pageId, 'size_mismatch');
        continue;
      }
      if (
        majorityColorMode !== undefined &&
        colorKeys[i] !== undefined &&
        colorKeys[i] !== majorityColorMode
      ) {
        mismatch.set(r.pageId, 'color_mismatch');
        continue;
      }
      if (
        majorityDpi !== undefined &&
        dpiKeys[i] !== undefined &&
        dpiKeys[i] !== majorityDpi
      ) {
        mismatch.set(r.pageId, 'dpi_mismatch');
        continue;
      }
    }

    return {
      ctx: {
        majoritySize,
        majorityColorMode,
        majorityDpi,
      },
      mismatch,
    };
  };

  const cover = buildGroup(coverRefs);
  const body = buildGroup(bodyRefs);

  // 全ページを走査して mismatch ステータスを反映
  const finalChapters = chapters.map((c) => {
    const mismatchMap = c.type === 'cover' ? cover.mismatch : body.mismatch;
    return {
      ...c,
      pages: c.pages.map((p) => {
        if (p.pageType !== 'file') return p;
        const newStatus = mismatchMap.get(p.id);
        if (newStatus) {
          if (p.fileValidationStatus === newStatus) return p;
          return { ...p, fileValidationStatus: newStatus };
        }
        // mismatch解消: ベースが'ok'なら'ok'のまま、missing/modified等は維持
        const baseStatus = p.fileValidationStatus;
        if (
          baseStatus === 'size_mismatch' ||
          baseStatus === 'color_mismatch' ||
          baseStatus === 'dpi_mismatch'
        ) {
          return { ...p, fileValidationStatus: 'ok' as FileValidationStatus };
        }
        return p;
      }),
    };
  });

  return {
    chapters: finalChapters,
    context: {
      cover: cover.ctx,
      body: body.ctx,
    },
  };
}

export const useStore = create<AppState>((set, get) => {
  // 履歴に現在の状態を保存するヘルパー（変更フラグも設定）
  const saveHistory = () => {
    const { chapters, history } = get();
    const newHistory = [...history, JSON.parse(JSON.stringify(chapters))];
    // 履歴サイズを制限
    if (newHistory.length > MAX_HISTORY_SIZE) {
      newHistory.shift();
    }
    return { history: newHistory, future: [], isModified: true };
  };

  return {
  // 初期状態
  chapters: [],
  currentProjectPath: null,
  projectName: '新規プロジェクト',
  isModified: false,
  lastSavedAt: null,
  history: [],
  future: [],
  selectedChapterId: null,
  selectedPageId: null,
  selectedPageIds: [],
  viewMode: 'all',
  thumbnailSize: 'medium',

  validationContext: { cover: {}, body: {} },

  // EPUB_maker初期状態
  epubPages: [],
  epubMetadata: null,
  epubCustomCss: '',
  epubCurrentSpread: 0,
  epubImageFolder: null,
  epubSelectedPageId: null,
  epubSelectedPageIds: [],
  isEpubModified: false,

  // チャプター追加
  addChapter: (type, name, _skipInitialPage = false, insertAt) => {
    const id = uuidv4();
    const chapters = get().chapters;
    const chapterName = name || getDefaultChapterName(type, chapters);

    // 白紙チャプターは白紙ページ1枚で初期化（エクスポート時に白紙画像が生成される）
    // その他のチャプターは空状態で追加（ページは後から追加）
    const initialPages: Page[] = type === 'blank'
      ? [{ id: uuidv4(), pageType: 'blank' }]
      : [];

    const newChapter = {
      id,
      name: chapterName,
      type,
      pages: initialPages,
      collapsed: false,
    };

    set((state) => {
      const newChapters = [...state.chapters];
      if (insertAt !== undefined && insertAt >= 0) {
        // 指定位置に挿入
        newChapters.splice(insertAt, 0, newChapter);
      } else {
        // 末尾に追加
        newChapters.push(newChapter);
      }
      return {
        ...saveHistory(),
        chapters: newChapters,
      };
    });

    return id;
  },

  // チャプター削除
  removeChapter: (id) => {
    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.filter((c) => c.id !== id),
      selectedChapterId: state.selectedChapterId === id ? null : state.selectedChapterId,
    }));
  },

  // すべてのチャプターをクリア
  clearChapters: () => {
    set(() => ({
      ...saveHistory(),
      chapters: [],
      selectedChapterId: null,
      selectedPageId: null,
      selectedPageIds: [],
    }));
  },

  // チャプター名変更
  renameChapter: (id, name) => {
    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
  },

  updateChapterSubtitle: (id, subtitle) => {
    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) => (c.id === id ? { ...c, subtitle } : c)),
    }));
  },

  // チャプター折りたたみ切り替え
  toggleChapterCollapsed: (id) => {
    set((state) => ({
      chapters: state.chapters.map((c) =>
        c.id === id ? { ...c, collapsed: !c.collapsed } : c
      ),
    }));
  },

  // チャプター並べ替え
  reorderChapters: (fromIndex, toIndex) => {
    set((state) => {
      const historyUpdate = saveHistory();
      const chapters = [...state.chapters];
      const [removed] = chapters.splice(fromIndex, 1);
      chapters.splice(toIndex, 0, removed);
      return { ...historyUpdate, chapters };
    });
  },

  // チャプターを読み込み済みファイルごと複製（直後に挿入）
  duplicateChapter: (id) => {
    const state = get();
    const idx = state.chapters.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const source = state.chapters[idx];
    const newId = uuidv4();
    const cloned: Chapter = {
      ...source,
      id: newId,
      name: `${source.name} (コピー)`,
      // ページごとに新しい ID を振る（サムネイルキャッシュは同一ファイルなので共有）
      pages: source.pages.map((page) => ({
        ...page,
        id: uuidv4(),
      })),
    };
    set((s) => {
      const list = [...s.chapters];
      list.splice(idx + 1, 0, cloned);
      return { ...saveHistory(), chapters: list };
    });
    return newId;
  },

  // ファイルページ追加（末尾に追加）
  addPagesToChapter: (chapterId, files) => {
    const chapter = get().chapters.find((c) => c.id === chapterId);
    // 表紙チャプターは1ファイルのみ許可
    if (chapter?.type === 'cover') {
      const remaining = Math.max(0, 1 - chapter.pages.length);
      files = files.slice(0, remaining);
      if (files.length === 0) return;
    }
    const pages: Page[] = files.map((file) => ({
      id: uuidv4(),
      pageType: 'file' as PageType,
      filePath: file.path,
      fileName: file.name,
      fileType: file.file_type as Page['fileType'],
      fileSize: file.size,
      modifiedTime: file.modified_time,
      thumbnailStatus: 'pending',
    }));

    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, pages: [...c.pages, ...pages], folderPath: files[0]?.path.replace(/[^\\\/]+$/, '') }
          : c
      ),
    }));
  },

  // 複数フォルダを各々別チャプターとして指定位置に一括挿入（type を指定）
  insertChaptersFromFolders: (insertAt, type, folders) => {
    if (folders.length === 0) return [];
    // 表紙チャプターは1ファイルのみ許可
    const isCover = type === 'cover';
    const newChapters: Chapter[] = folders.map((folder) => {
      const useFiles = isCover ? folder.files.slice(0, 1) : folder.files;
      const pages: Page[] = useFiles.map((file) => ({
        id: uuidv4(),
        pageType: 'file' as PageType,
        filePath: file.path,
        fileName: file.name,
        fileType: file.file_type as Page['fileType'],
        fileSize: file.size,
        modifiedTime: file.modified_time,
        thumbnailStatus: 'pending',
      }));
      return {
        id: uuidv4(),
        name: folder.name,
        subtitle: folder.subtitle,
        type,
        pages,
        collapsed: false,
        folderPath: useFiles[0]?.path.replace(/[^\\\/]+$/, ''),
      };
    });
    set((state) => {
      const list = [...state.chapters];
      const idx = Math.max(0, Math.min(insertAt, list.length));
      list.splice(idx, 0, ...newChapters);
      return { ...saveHistory(), chapters: list };
    });
    return newChapters.map((c) => c.id);
  },

  // ページ一括差し替え（チャプター内の既存ページを全置換）
  replacePagesInChapter: (chapterId, files) => {
    const chapter = get().chapters.find((c) => c.id === chapterId);
    if (chapter?.type === 'cover') {
      files = files.slice(0, 1);
    }
    if (files.length === 0) return;
    const pages: Page[] = files.map((file) => ({
      id: uuidv4(),
      pageType: 'file' as PageType,
      filePath: file.path,
      fileName: file.name,
      fileType: file.file_type as Page['fileType'],
      fileSize: file.size,
      modifiedTime: file.modified_time,
      thumbnailStatus: 'pending',
    }));

    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, pages, folderPath: files[0]?.path.replace(/[^\\\/]+$/, '') }
          : c
      ),
    }));
  },

  // ファイルページ追加（指定位置に挿入）
  addPagesToChapterAt: (chapterId, files, atIndex) => {
    const chapter = get().chapters.find((c) => c.id === chapterId);
    // 表紙チャプターは1ファイルのみ許可
    if (chapter?.type === 'cover') {
      const remaining = Math.max(0, 1 - chapter.pages.length);
      files = files.slice(0, remaining);
      if (files.length === 0) return;
    }
    const pages: Page[] = files.map((file) => ({
      id: uuidv4(),
      pageType: 'file' as PageType,
      filePath: file.path,
      fileName: file.name,
      fileType: file.file_type as Page['fileType'],
      fileSize: file.size,
      modifiedTime: file.modified_time,
      thumbnailStatus: 'pending',
    }));

    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) => {
        if (c.id !== chapterId) return c;
        const newPages = [...c.pages];
        newPages.splice(atIndex, 0, ...pages);
        return { ...c, pages: newPages, folderPath: files[0]?.path.replace(/[^\\\/]+$/, '') };
      }),
    }));
  },

  // 特殊ページ追加（白紙・幕間・表紙・奥付）
  addSpecialPage: (chapterId, pageType, afterPageId) => {
    const newPage: Page = {
      id: uuidv4(),
      pageType,
      label: PAGE_TYPE_LABELS[pageType],
    };

    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) => {
        if (c.id !== chapterId) return c;

        if (afterPageId) {
          // 指定ページの後ろに挿入
          const index = c.pages.findIndex((p) => p.id === afterPageId);
          if (index !== -1) {
            const pages = [...c.pages];
            pages.splice(index + 1, 0, newPage);
            return { ...c, pages };
          }
        }
        // 末尾に追加
        return { ...c, pages: [...c.pages, newPage] };
      }),
    }));
  },

  // 特殊ページにファイルを設定（表紙・奥付用）
  setPageFile: (pageId, file) => {
    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) => ({
        ...c,
        pages: c.pages.map((p) => {
          if (p.id !== pageId) return p;
          if (file) {
            return {
              ...p,
              filePath: file.path,
              fileName: file.name,
              fileType: file.file_type as Page['fileType'],
              fileSize: file.size,
              modifiedTime: file.modified_time,
              thumbnailStatus: 'pending' as const,
              thumbnailCacheKey: undefined,
              thumbnailCachePath: undefined,
              fileValidationStatus: 'ok' as const,
            };
          } else {
            // ファイルをクリア
            return {
              ...p,
              filePath: undefined,
              fileName: undefined,
              fileType: undefined,
              fileSize: undefined,
              modifiedTime: undefined,
              thumbnailStatus: undefined,
              thumbnailCacheKey: undefined,
              thumbnailCachePath: undefined,
            };
          }
        }),
      })),
    }));
  },

  // ページ削除
  removePage: (chapterId, pageId) => {
    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, pages: c.pages.filter((p) => p.id !== pageId) }
          : c
      ),
      selectedPageId: state.selectedPageId === pageId ? null : state.selectedPageId,
    }));
  },

  // ページ並べ替え（同一チャプター内）
  reorderPages: (chapterId, fromIndex, toIndex) => {
    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) => {
        if (c.id !== chapterId) return c;
        const pages = [...c.pages];
        const [removed] = pages.splice(fromIndex, 1);
        pages.splice(toIndex, 0, removed);
        return { ...c, pages };
      }),
    }));
  },

  // ページ移動（チャプター間）
  movePage: (fromChapterId, toChapterId, pageId, toIndex) => {
    set((state) => {
      const historyUpdate = saveHistory();
      const fromChapter = state.chapters.find((c) => c.id === fromChapterId);
      const page = fromChapter?.pages.find((p) => p.id === pageId);
      if (!page || !fromChapter) return state;

      // 表紙チャプターには1ページまでしか移動できない
      const toChapter = state.chapters.find((c) => c.id === toChapterId);
      if (toChapter?.type === 'cover' && fromChapterId !== toChapterId && toChapter.pages.length >= 1) {
        return state;
      }

      // 特殊アイテム（file以外）で、チャプター内に1つしかない場合、移動後にチャプターを削除
      const shouldDeleteFromChapter =
        page.pageType !== 'file' &&
        fromChapter.pages.length === 1;

      let newChapters = state.chapters.map((c) => {
        if (c.id === fromChapterId) {
          return { ...c, pages: c.pages.filter((p) => p.id !== pageId) };
        }
        if (c.id === toChapterId) {
          const pages = [...c.pages];
          pages.splice(toIndex, 0, page);
          return { ...c, pages };
        }
        return c;
      });

      // 空になった特殊アイテムのみのチャプターを削除
      if (shouldDeleteFromChapter) {
        newChapters = newChapters.filter((c) => c.id !== fromChapterId);
      }

      return {
        ...historyUpdate,
        chapters: newChapters,
      };
    });
  },

  // 複数ページ移動
  movePages: (pageIds, toChapterId, toIndex) => {
    set((state) => {
      const historyUpdate = saveHistory();

      // 移動対象のページを収集（元の順序を保持）
      const pagesToMove: { page: Page; fromChapterId: string }[] = [];
      for (const chapter of state.chapters) {
        for (const page of chapter.pages) {
          if (pageIds.includes(page.id)) {
            pagesToMove.push({ page, fromChapterId: chapter.id });
          }
        }
      }

      if (pagesToMove.length === 0) return state;

      // 表紙チャプターには1ページまでしか移動できない
      const toChapter = state.chapters.find((c) => c.id === toChapterId);
      if (toChapter?.type === 'cover') {
        // 移動対象のうち、既に表紙にいるページを除いた純増分
        const alreadyInTargetIds = new Set(
          pagesToMove.filter((p) => p.fromChapterId === toChapterId).map((p) => p.page.id)
        );
        const incomingCount = pagesToMove.length - alreadyInTargetIds.size;
        const existingCount = toChapter.pages.length - alreadyInTargetIds.size;
        if (existingCount + incomingCount > 1) {
          return state;
        }
      }

      // ページIDの順序でソート（選択順序を維持）
      pagesToMove.sort((a, b) => pageIds.indexOf(a.page.id) - pageIds.indexOf(b.page.id));

      // 各チャプターからページを削除
      let newChapters = state.chapters.map((c) => ({
        ...c,
        pages: c.pages.filter((p) => !pageIds.includes(p.id)),
      }));

      // 移動先チャプターにページを追加
      newChapters = newChapters.map((c) => {
        if (c.id === toChapterId) {
          const pages = [...c.pages];
          const insertPages = pagesToMove.map((p) => p.page);
          pages.splice(toIndex, 0, ...insertPages);
          return { ...c, pages };
        }
        return c;
      });

      // 空になったチャプター（特殊アイテムのみのチャプター）を削除
      newChapters = newChapters.filter((c) => c.pages.length > 0 || c.type === 'chapter');

      return {
        ...historyUpdate,
        chapters: newChapters,
      };
    });
  },

  // チャプター選択
  selectChapter: (id) => {
    set({ selectedChapterId: id, selectedPageId: null });
  },

  // ページ選択
  selectPage: (id) => {
    set({ selectedPageId: id, selectedPageIds: id ? [id] : [] });
  },

  // ページの選択をトグル（Ctrl+クリック用）
  togglePageSelection: (pageId) => {
    set((state) => {
      const isSelected = state.selectedPageIds.includes(pageId);
      if (isSelected) {
        const newSelection = state.selectedPageIds.filter((id) => id !== pageId);
        return {
          selectedPageIds: newSelection,
          selectedPageId: newSelection.length > 0 ? newSelection[newSelection.length - 1] : null,
        };
      } else {
        return {
          selectedPageIds: [...state.selectedPageIds, pageId],
          selectedPageId: pageId,
        };
      }
    });
  },

  // 範囲選択（Shift+クリック用）
  selectPageRange: (fromPageId, toPageId) => {
    const chapters = get().chapters;
    const allPages: string[] = [];
    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        allPages.push(page.id);
      }
    }

    const fromIndex = allPages.indexOf(fromPageId);
    const toIndex = allPages.indexOf(toPageId);

    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = allPages.slice(start, end + 1);

    set({
      selectedPageIds: rangeIds,
      selectedPageId: toPageId,
    });
  },

  // 選択をクリア
  clearPageSelection: () => {
    set({ selectedPageIds: [], selectedPageId: null });
  },

  // 選択されたページを一括削除
  removeSelectedPages: () => {
    const { selectedPageIds } = get();
    if (selectedPageIds.length === 0) return;

    set((state) => ({
      ...saveHistory(),
      chapters: state.chapters.map((c) => ({
        ...c,
        pages: c.pages.filter((p) => !selectedPageIds.includes(p.id)),
      })),
      selectedPageIds: [],
      selectedPageId: null,
    }));
  },

  // サムネイルサイズ切り替え
  setThumbnailSize: (size) => {
    set({ thumbnailSize: size });
  },

  // サムネイル更新（キャッシュキーとパスを保存、base64データは保存しない）
  updatePageThumbnail: (pageId, cacheKey, cachePath) => {
    set((state) => ({
      chapters: state.chapters.map((c) => ({
        ...c,
        pages: c.pages.map((p) =>
          p.id === pageId
            ? { ...p, thumbnailStatus: 'ready' as const, thumbnailCacheKey: cacheKey, thumbnailCachePath: cachePath }
            : p
        ),
      })),
    }));
  },

  // サムネイルエラー
  setPageThumbnailError: (pageId) => {
    set((state) => ({
      chapters: state.chapters.map((c) => ({
        ...c,
        pages: c.pages.map((p) =>
          p.id === pageId ? { ...p, thumbnailStatus: 'error' as const } : p
        ),
      })),
    }));
  },

  // ファイル検証結果を一括反映（履歴には含めない）
  // 1. ベースステータス + 画像メタを各ページにマージ
  // 2. cover チャプター / その他で別グループに最頻値を計算
  // 3. mismatch 系ステータスを上書き、validationContext を更新
  updatePagesValidation: (results) => {
    const map = new Map(results.map((r) => [r.pageId, r] as const));
    set((state) => {
      // Step 1: ベース反映（ステータス + メタ）
      const mergedChapters = state.chapters.map((c) => ({
        ...c,
        pages: c.pages.map((p) => {
          const r = map.get(p.id);
          if (!r) return p;
          return {
            ...p,
            fileValidationStatus: r.status,
            imageWidth: r.width ?? undefined,
            imageHeight: r.height ?? undefined,
            imageColorMode: r.colorMode ?? undefined,
            imageDpi: r.dpi ?? undefined,
          };
        }),
      }));

      // Step 2 & 3: mismatch検知と上書き
      const { chapters: finalChapters, context } = applyMismatchStatuses(mergedChapters);

      return {
        chapters: finalChapters,
        validationContext: context,
      };
    });
  },

  // 元に戻す
  undo: () => {
    const { history, chapters } = get();
    if (history.length === 0) return;

    const newHistory = [...history];
    const previousState = newHistory.pop()!;

    set((state) => ({
      chapters: previousState,
      history: newHistory,
      future: [JSON.parse(JSON.stringify(chapters)), ...state.future],
      selectedChapterId: null,
      selectedPageId: null,
      selectedPageIds: [],
    }));
  },

  // やり直し
  redo: () => {
    const { future, chapters } = get();
    if (future.length === 0) return;

    const newFuture = [...future];
    const nextState = newFuture.shift()!;

    set((state) => ({
      chapters: nextState,
      history: [...state.history, JSON.parse(JSON.stringify(chapters))],
      future: newFuture,
      selectedChapterId: null,
      selectedPageId: null,
      selectedPageIds: [],
    }));
  },

  // 元に戻せるか
  canUndo: () => {
    return get().history.length > 0;
  },

  // やり直せるか
  canRedo: () => {
    return get().future.length > 0;
  },

  // 全ページ取得（通し番号付き）
  getAllPages: () => {
    const chapters = get().chapters;
    const result: { page: Page; chapter: Chapter; globalIndex: number }[] = [];
    let globalIndex = 0;

    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        result.push({ page, chapter, globalIndex });
        globalIndex++;
      }
    }

    return result;
  },

  // 総ページ数
  getTotalPageCount: () => {
    return get().chapters.reduce((sum, c) => sum + c.pages.length, 0);
  },

  // プロジェクトパス設定
  setProjectPath: (path) => {
    set({ currentProjectPath: path });
  },

  // プロジェクト名設定
  setProjectName: (name) => {
    set({ projectName: name, isModified: true });
  },

  // 変更フラグを設定
  markAsModified: () => {
    set({ isModified: true });
  },

  // 保存完了
  markAsSaved: (path) => {
    const name = path.split(/[\\\/]/).pop()?.replace(/\.daidori$/, '') || '新規プロジェクト';
    set({
      currentProjectPath: path,
      projectName: name,
      isModified: false,
      lastSavedAt: new Date(),
    });
  },

  // プロジェクトをリセット（新規作成）
  resetProject: () => {
    set({
      chapters: [],
      currentProjectPath: null,
      projectName: '新規プロジェクト',
      isModified: false,
      lastSavedAt: null,
      history: [],
      future: [],
      selectedChapterId: null,
      selectedPageId: null,
      selectedPageIds: [],
      viewMode: 'all',
    });
  },

  // プロジェクト状態を読み込み
  loadProjectState: (chapters, uiState) => {
    set({
      chapters,
      history: [],
      future: [],
      isModified: false,
      selectedChapterId: uiState?.selectedChapterId ?? null,
      selectedPageId: uiState?.selectedPageId ?? null,
      selectedPageIds: [],
      viewMode: uiState?.viewMode ?? 'all',
      thumbnailSize: uiState?.thumbnailSize ?? 'medium',
    });
  },

  // EPUB_makerアクション
  setEpubPages: (pages) => {
    set({ epubPages: pages, isEpubModified: true });
  },

  setEpubMetadata: (metadata) => {
    set({ epubMetadata: metadata, isEpubModified: true });
  },

  updateEpubMetadata: (updates) => {
    set((state) => ({
      epubMetadata: state.epubMetadata
        ? { ...state.epubMetadata, ...updates }
        : null,
      isEpubModified: true,
    }));
  },

  setEpubCustomCss: (css) => {
    set({ epubCustomCss: css, isEpubModified: true });
  },

  setEpubCurrentSpread: (index) => {
    set({ epubCurrentSpread: index });
  },

  setEpubImageFolder: (folder) => {
    set({ epubImageFolder: folder });
  },

  setEpubSelectedPageId: (id) => {
    set({ epubSelectedPageId: id, epubSelectedPageIds: id ? [id] : [] });
  },

  toggleEpubPageSelection: (pageId) => {
    set((state) => {
      const isSelected = state.epubSelectedPageIds.includes(pageId);
      if (isSelected) {
        const newSelection = state.epubSelectedPageIds.filter((id) => id !== pageId);
        return {
          epubSelectedPageIds: newSelection,
          epubSelectedPageId: newSelection.length > 0 ? newSelection[newSelection.length - 1] : null,
        };
      }
      return {
        epubSelectedPageIds: [...state.epubSelectedPageIds, pageId],
        epubSelectedPageId: pageId,
      };
    });
  },

  selectEpubPageRange: (fromPageId, toPageId) => {
    set((state) => {
      const pages = state.epubPages;
      const fromIdx = pages.findIndex((p) => p.id === fromPageId);
      const toIdx = pages.findIndex((p) => p.id === toPageId);
      if (fromIdx < 0 || toIdx < 0) return state;
      const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      const rangeIds = pages.slice(start, end + 1).map((p) => p.id);
      return {
        epubSelectedPageIds: rangeIds,
        epubSelectedPageId: toPageId,
      };
    });
  },

  clearEpubPageSelection: () => {
    set({ epubSelectedPageIds: [], epubSelectedPageId: null });
  },

  reorderEpubPage: (fromIndex, toIndex) => {
    set((state) => {
      const pages = [...state.epubPages];
      const [removed] = pages.splice(fromIndex, 1);
      pages.splice(toIndex, 0, removed);
      return { epubPages: pages, isEpubModified: true };
    });
  },

  setEpubPageAsCover: (pageId) => {
    set((state) => ({
      epubPages: state.epubPages.map((p) => ({
        ...p,
        isCover: p.id === pageId,
      })),
      isEpubModified: true,
    }));
  },

  setEpubPageAsColophon: (pageId) => {
    set((state) => ({
      epubPages: state.epubPages.map((p) => ({
        ...p,
        isColophon: p.id === pageId ? true : p.isColophon,
      })),
      isEpubModified: true,
    }));
  },

  clearEpubPageCover: () => {
    set((state) => ({
      epubPages: state.epubPages.map((p) => ({
        ...p,
        isCover: false,
      })),
      isEpubModified: true,
    }));
  },

  clearEpubPageColophon: (pageId) => {
    set((state) => ({
      epubPages: state.epubPages.map((p) => ({
        ...p,
        isColophon: p.id === pageId ? false : p.isColophon,
      })),
      isEpubModified: true,
    }));
  },

  // 台割データからEPUBデータへ変換
  loadEpubFromDaidori: () => {
    const { chapters, projectName } = get();
    let pageIndex = 1;
    let coverAssigned = false;
    let colophonAssignedFromChapter = false;
    const epubPages: EpubPageInfo[] = [];

    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        const isBlankPage = page.pageType === 'blank' || (chapter.type === 'blank' && !page.filePath);
        // 白紙ページはプレビュー用に含める（生成時は別処理でスキップ）
        if (!isBlankPage && !page.filePath) continue;

        const isCover =
          !coverAssigned && (chapter.type === 'cover' || page.pageType === 'cover');
        if (isCover) {
          coverAssigned = true;
        }

        const isColophon =
          page.pageType === 'colophon' ||
          (!colophonAssignedFromChapter && chapter.type === 'colophon');
        if (chapter.type === 'colophon' && isColophon) {
          colophonAssignedFromChapter = true;
        }

        const epubPage: EpubPageInfo = {
          id: uuidv4(),
          filename: `p${String(pageIndex).padStart(3, '0')}.jpg`,
          sourcePath: page.filePath || '',
          width: 0,
          height: 0,
          isCover,
          isColophon,
          isBlank: isBlankPage,
          thumbnailPath: page.thumbnailCachePath,
          thumbnailStatus: page.thumbnailStatus,
          originalPageId: page.id,
          originalChapterName: chapter.name,
          originalPageType: page.pageType,
          originalChapterType: chapter.type,
          fileValidationStatus: page.fileValidationStatus,
          imageWidth: page.imageWidth,
          imageHeight: page.imageHeight,
          imageColorMode: page.imageColorMode,
          imageDpi: page.imageDpi,
        };

        epubPages.push(epubPage);
        pageIndex++;
      }
    }

    // デフォルトメタデータを作成
    const defaultViewport = EPUB_FORMAT_VIEWPORTS['kadokawa'];
    const metadata: EpubMetadata = {
      title: projectName,
      authors: [{ name: '', role: 'aut' }],
      publisher: 'CLLENN',
      publisherFileAs: 'シレン',
      language: 'ja',
      pageDirection: 'rtl',
      viewportWidth: defaultViewport.width,
      viewportHeight: defaultViewport.height,
      spreadMode: 'landscape',
      orientation: 'auto',
      bookUuid: uuidv4(),
      outputFormat: 'kadokawa',
      allowMissingColophon: false,
      hybridCssProfile: 'current',
    };

    set({
      epubPages,
      epubMetadata: metadata,
      epubCurrentSpread: 0,
      epubSelectedPageId: null,
      epubSelectedPageIds: [],
      isEpubModified: false,
    });
  },

  resetEpubState: () => {
    set({
      epubPages: [],
      epubMetadata: null,
      epubCustomCss: '',
      epubCurrentSpread: 0,
      epubImageFolder: null,
      epubSelectedPageId: null,
      epubSelectedPageIds: [],
      isEpubModified: false,
    });
  },

  markEpubAsModified: () => {
    set({ isEpubModified: true });
  },
}});
