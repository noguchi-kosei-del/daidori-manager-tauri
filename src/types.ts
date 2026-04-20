// アイテムの型定義
export type ChapterType = 'chapter' | 'cover' | 'blank' | 'intermission' | 'colophon';

export type ThumbnailStatus = 'pending' | 'loading' | 'ready' | 'error';

export type FileValidationStatus = 'ok' | 'missing' | 'modified';

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
  file: '#0078d4',
  cover: '#c62828',
  blank: '#8a8a8a',
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
  // サムネイルキャッシュ情報（base64ではなくファイルパス参照）
  thumbnailCacheKey?: string;
  thumbnailCachePath?: string;
  // 特殊ページの場合のラベル（カスタム名）
  label?: string;
  // ファイル検証状態（移動・リネーム・日時変更を検出）
  fileValidationStatus?: FileValidationStatus;
}

// サムネイル生成結果（Rust側のThumbnailResultに対応）
export interface ThumbnailResult {
  cache_key: string;
  cache_path: string;
  status: 'cached' | 'generated';
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
  chapter: '#0078d4',
  cover: '#c62828',
  blank: '#8a8a8a',
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

// ========== TIFF変換関連 ==========

// TIFF変換の個別ファイル設定
export interface TiffFileConfig {
  path: string;
  outputPath: string;
  outputName: string;
  colorMode?: 'rgb' | 'grayscale';
}

// TIFF変換のグローバル設定
export interface TiffGlobalSettings {
  flattenImage: boolean;
  colorMode?: 'rgb' | 'grayscale';
  targetWidth?: number;
  targetHeight?: number;
  targetDpi?: number;
}

// TIFF変換の設定全体
export interface TiffConvertConfig {
  globalSettings: TiffGlobalSettings;
  files: TiffFileConfig[];
}

// TIFF変換の個別結果
export interface TiffConvertResult {
  fileName: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}

// TIFF変換のレスポンス
export interface TiffConvertResponse {
  results: TiffConvertResult[];
  outputDir: string;
}

// ========== EPUB生成関連 ==========

// EPUB出力形式
export type EpubFormat = 'kadokawa' | 'hybrid' | 'oebps';

// EPUB形式のラベル
export const EPUB_FORMAT_LABELS: Record<EpubFormat, string> = {
  kadokawa: 'KADOKAWA（電書協準拠）',
  hybrid: 'Hybrid（EPUB2/3両対応）',
  oebps: 'OEBPS（シンプル）',
};

// EPUB形式のデフォルトビューポート
export const EPUB_FORMAT_VIEWPORTS: Record<EpubFormat, { width: number; height: number }> = {
  kadokawa: { width: 1442, height: 2048 },
  hybrid: { width: 1127, height: 1600 },
  oebps: { width: 1352, height: 1920 },
};

export type HybridCssProfile = 'current' | 'legacy';

export const HYBRID_CSS_PROFILE_LABELS: Record<HybridCssProfile, string> = {
  current: '現行CSS',
  legacy: '旧Hybrid CSS',
};

// ページ綴じ方向
export type PageDirection = 'rtl' | 'ltr';

// 綴じ方向ラベル
export const PAGE_DIRECTION_LABELS: Record<PageDirection, string> = {
  rtl: '右綴じ（日本の漫画）',
  ltr: '左綴じ（西洋式）',
};

// 見開きモード
export type SpreadMode = 'landscape' | 'portrait' | 'auto';

// 見開きモードラベル
export const SPREAD_MODE_LABELS: Record<SpreadMode, string> = {
  landscape: '見開き表示',
  portrait: '単ページ表示',
  auto: '自動',
};

// 画面向き
export type Orientation = 'auto' | 'portrait' | 'landscape';

// 著者の役割
export type AuthorRole = 'aut' | 'ill' | 'edt' | 'trl';

// 著者役割ラベル
export const AUTHOR_ROLE_LABELS: Record<AuthorRole, string> = {
  aut: '著者',
  ill: 'イラスト',
  edt: '編集',
  trl: '翻訳',
};

// 著者情報
export interface AuthorInfo {
  name: string;
  fileAs?: string;
  role: AuthorRole;
  roleDisplay?: string;
}

// EPUBメタデータ
export interface EpubMetadata {
  title: string;
  titleFileAs?: string;
  authors: AuthorInfo[];
  publisher: string;
  publisherFileAs?: string;
  isbn?: string;
  language: string;
  pageDirection: PageDirection;
  viewportWidth: number;
  viewportHeight: number;
  spreadMode: SpreadMode;
  orientation: Orientation;
  bookUuid: string;
  outputFormat: EpubFormat;
  description?: string;
  allowMissingColophon?: boolean;
  hybridCssProfile?: HybridCssProfile;
}

// EPUBページ情報
export interface EpubPage {
  id: string;
  filename: string;
  sourcePath: string;
  width: number;
  height: number;
  isCover: boolean;
  isColophon: boolean;
}

// EPUB生成結果
export interface EpubGenerateResponse {
  success: boolean;
  outputPath: string;
  pageCount: number;
  fileSize: number;
  error?: string;
}

// ========== EPUB_makerモード関連 ==========

// EPUB_maker用ページ情報（EpubPageを拡張）
export interface EpubPageInfo {
  id: string;
  filename: string;
  sourcePath: string;
  width: number;
  height: number;
  isCover: boolean;
  isColophon: boolean;
  isBlank?: boolean;
  // サムネイル（base64 or ファイルパス）
  thumbnailPath?: string;
  thumbnailStatus?: ThumbnailStatus;
  // 元の台割情報（変換元）
  originalPageId?: string;
  originalChapterName?: string;
  originalPageType?: PageType;
  originalChapterType?: ChapterType;
  // ファイル検証状態（台割側から引き継ぐ）
  fileValidationStatus?: FileValidationStatus;
}

// EPUBプロジェクトファイル形式
export interface EpubProjectFile {
  version: '1.0';
  metadata: EpubMetadata;
  pages: EpubPageInfo[];
  customCss?: string;
  imageFolder?: string;
  createdAt: string;
  modifiedAt: string;
}
