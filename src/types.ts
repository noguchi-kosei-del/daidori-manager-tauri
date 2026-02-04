// アイテムの型定義
export type ChapterType = 'chapter' | 'cover' | 'blank' | 'intermission' | 'colophon';

export type ThumbnailStatus = 'pending' | 'loading' | 'ready' | 'error';

export type FileType = 'jpg' | 'jpeg' | 'png' | 'psd' | 'tif' | 'tiff';

// ページ種別
export type PageType = 'file' | 'cover' | 'blank' | 'intermission' | 'colophon';

// ページ種別ラベル
export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  file: 'ファイル',
  cover: '表紙',
  blank: '白紙',
  intermission: '幕間',
  colophon: '奥付',
};

// ページ種別カラー
export const PAGE_TYPE_COLORS: Record<PageType, string> = {
  file: '#5c9cff',
  cover: '#ff7a7a',
  blank: '#8a8aa0',
  intermission: '#a855f7',
  colophon: '#34d399',
};

// ファイル選択可能な特殊ページタイプ
export const FILE_SELECTABLE_PAGE_TYPES: PageType[] = ['cover', 'colophon'];

// ページ（ファイルまたは特殊ページ）
export interface Page {
  id: string;
  pageType: PageType;
  // ファイルページの場合
  filePath?: string;
  fileName?: string;
  fileType?: FileType;
  fileSize?: number;
  modifiedTime?: number;
  thumbnailStatus?: ThumbnailStatus;
  thumbnailPath?: string;
  // 特殊ページの場合のラベル（カスタム名）
  label?: string;
}

// 話数/グループ
export interface Chapter {
  id: string;
  name: string;
  type: ChapterType;
  pages: Page[];
  collapsed: boolean;
  folderPath?: string;
}

// 特殊ページのラベル
export const CHAPTER_TYPE_LABELS: Record<ChapterType, string> = {
  chapter: '話',
  cover: '表紙',
  blank: '白紙',
  intermission: '幕間',
  colophon: '奥付',
};

// 特殊ページのカラー
export const CHAPTER_TYPE_COLORS: Record<ChapterType, string> = {
  chapter: '#5c9cff',
  cover: '#ff7a7a',
  blank: '#8a8aa0',
  intermission: '#a855f7',
  colophon: '#34d399',
};

// ========== プロジェクトファイル関連 ==========

// 保存されるUI状態
export interface SavedUiState {
  selectedChapterId: string | null;
  selectedPageId: string | null;
  viewMode: 'selection' | 'all';
  thumbnailSize: 'small' | 'medium' | 'large';
  collapsedChapterIds: string[];
}

// ファイル参照情報（保存用）
export interface SavedFileReference {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  modifiedTime: number;
}

// 保存されるページ
export interface SavedPage {
  id: string;
  pageType: PageType;
  file?: SavedFileReference;
  label?: string;
}

// 保存されるチャプター
export interface SavedChapter {
  id: string;
  name: string;
  type: ChapterType;
  pages: SavedPage[];
  folderPath?: string;
}

// プロジェクトファイル形式
export interface DaidoriProjectFile {
  version: '1.0';
  name: string;
  createdAt: string;
  modifiedAt: string;
  basePath: string;
  chapters: SavedChapter[];
  uiState?: SavedUiState;
}

// ファイル検証結果
export interface FileValidationResult {
  pageId: string;
  status: 'found' | 'missing' | 'moved' | 'modified';
  originalPath: string;
  resolvedPath?: string;
  suggestedPath?: string;
}

// 最近使ったファイル
export interface RecentFile {
  path: string;
  name: string;
  openedAt: string;
}
