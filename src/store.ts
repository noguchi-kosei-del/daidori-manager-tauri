import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  Chapter,
  ChapterType,
  Page,
  PageType,
  PAGE_TYPE_LABELS,
  SavedUiState,

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

  // EPUB_maker状態
  epubPages: EpubPageInfo[];
  epubMetadata: EpubMetadata | null;
  epubCustomCss: string;
  epubCurrentSpread: number;
  epubImageFolder: string | null;
  epubSelectedPageId: string | null;
  isEpubModified: boolean;

  // アクション: チャプター管理
  addChapter: (type: ChapterType, name?: string, skipInitialPage?: boolean, insertAt?: number) => string;
  removeChapter: (id: string) => void;
  clearChapters: () => void;
  renameChapter: (id: string, name: string) => void;
  toggleChapterCollapsed: (id: string) => void;
  reorderChapters: (fromIndex: number, toIndex: number) => void;

  // アクション: ページ管理
  addPagesToChapter: (chapterId: string, files: FileInfo[]) => void;
  addPagesToChapterAt: (chapterId: string, files: FileInfo[], atIndex: number) => void;
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
      return `第${chapterCount + 1}話`;
    }
    case 'cover':
      return '表紙';
    case 'blank':
      return '白紙';
    case 'intermission':
      return '幕間';
    case 'colophon':
      return '奥付';
    default:
      return '新規';
  }
};

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

  // EPUB_maker初期状態
  epubPages: [],
  epubMetadata: null,
  epubCustomCss: '',
  epubCurrentSpread: 0,
  epubImageFolder: null,
  epubSelectedPageId: null,
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

  // ファイルページ追加（末尾に追加）
  addPagesToChapter: (chapterId, files) => {
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

  // ファイルページ追加（指定位置に挿入）
  addPagesToChapterAt: (chapterId, files, atIndex) => {
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
    set({ epubSelectedPageId: id });
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
    const epubPages: EpubPageInfo[] = [];

    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        // 白紙ページはスキップ
        if (page.pageType === 'blank') continue;
        // ファイルがないページもスキップ
        if (!page.filePath) continue;

        const epubPage: EpubPageInfo = {
          id: uuidv4(),
          filename: `p${String(pageIndex).padStart(3, '0')}.jpg`,
          sourcePath: page.filePath,
          width: 0,
          height: 0,
          isCover: page.pageType === 'cover',
          isColophon: page.pageType === 'colophon',
          thumbnailPath: page.thumbnailCachePath,
          thumbnailStatus: page.thumbnailStatus,
          originalPageId: page.id,
          originalChapterName: chapter.name,
          originalPageType: page.pageType,
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
      publisher: '',
      language: 'ja',
      pageDirection: 'rtl',
      viewportWidth: defaultViewport.width,
      viewportHeight: defaultViewport.height,
      spreadMode: 'landscape',
      orientation: 'auto',
      bookUuid: uuidv4(),
      outputFormat: 'kadokawa',
    };

    set({
      epubPages,
      epubMetadata: metadata,
      epubCurrentSpread: 0,
      epubSelectedPageId: null,
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
      isEpubModified: false,
    });
  },

  markEpubAsModified: () => {
    set({ isEpubModified: true });
  },
}});
