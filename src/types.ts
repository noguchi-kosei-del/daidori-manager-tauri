// アイテムの型定義
export type ChapterType = 'chapter' | 'cover' | 'blank' | 'intermission' | 'colophon' | 'ad' | 'title' | 'toc';

export type ThumbnailStatus = 'pending' | 'loading' | 'ready' | 'error';

export type FileValidationStatus =
  | 'ok'
  | 'missing'
  | 'modified'
  | 'meta_error'
  | 'size_mismatch'
  | 'color_mismatch'
  | 'dpi_mismatch';

// 画像カラーモード（PSD/通常画像から抽出）
export type ImageColorMode =
  | 'RGB'
  | 'Grayscale'
  | 'CMYK'
  | 'Bitmap'
  | 'Indexed'
  | 'Multichannel'
  | 'Duotone'
  | 'Lab';

// グループ別の最頻値情報（mismatch tooltip 表示用）
export interface ValidationGroupContext {
  majoritySize?: string;        // "WxH"
  majorityColorMode?: string;
  majorityDpi?: number;
}
export interface ValidationContext {
  cover: ValidationGroupContext;
  body: ValidationGroupContext;
}

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
  // 画像メタデータ（mismatch検知に使用）
  imageWidth?: number;
  imageHeight?: number;
  imageColorMode?: ImageColorMode | string;
  imageDpi?: number;
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
  subtitle?: string;
  type: ChapterType;
  pages: Page[];
  collapsed: boolean;
  folderPath?: string;
}

// 特殊ページのラベル
export const CHAPTER_TYPE_LABELS: Record<ChapterType, string> = {
  chapter: '本文',
  cover: '表紙',
  blank: '白紙',
  intermission: '幕間',
  colophon: '奥付',
  ad: 'AD',
  title: '総扉',
  toc: '目次',
};

// 特殊ページのカラー
export const CHAPTER_TYPE_COLORS: Record<ChapterType, string> = {
  chapter: '#0078d4',
  cover: '#c62828',
  blank: '#8a8a8a',
  intermission: '#a855f7',
  colophon: '#34d399',
  ad: '#f59e0b',
  title: '#ec4899',
  toc: '#06b6d4',
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
  subtitle?: string;
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

export type EpubImageColorPolicy = 'auto' | 'full_color_srgb' | 'full_color_adobe_rgb' | 'adobe_rgb_dot_gain' | 'no_icc' | 'preserve_original';

export const EPUB_IMAGE_COLOR_POLICY_OPTIONS: EpubImageColorPolicy[] = [
  'auto',
  'full_color_srgb',
  'full_color_adobe_rgb',
  'adobe_rgb_dot_gain',
  'no_icc',
  'preserve_original',
];

export const EPUB_IMAGE_COLOR_POLICY_LABELS: Record<EpubImageColorPolicy, string> = {
  auto: '自動（本文モノクロ＋カラーsRGB）',
  full_color_srgb: 'フルカラー（全ページsRGB）',
  full_color_adobe_rgb: 'フルカラー（全ページAdobe RGB 1998）',
  adobe_rgb_dot_gain: 'カラーAdobe RGB 1998＋本文Dot Gain',
  no_icc: '全ページICCなし',
  preserve_original: '元画像を維持',
};

export type EpubPageImageProfileOverride = 'auto' | 'srgb' | 'adobe_rgb' | 'adobe_rgb_dot_gain' | 'dot_gain' | 'no_icc' | 'preserve_original';

export const EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_OPTIONS: EpubPageImageProfileOverride[] = [
  'auto',
  'srgb',
  'adobe_rgb',
  'adobe_rgb_dot_gain',
  'dot_gain',
  'no_icc',
  'preserve_original',
];

export const EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS: Record<EpubPageImageProfileOverride, string> = {
  auto: '自動',
  srgb: 'sRGBを付与',
  adobe_rgb: 'Adobe RGB 1998を付与',
  adobe_rgb_dot_gain: 'Adobe RGB 1998 / Dot Gain自動',
  dot_gain: 'Dot Gainを付与',
  no_icc: 'ICCなし',
  preserve_original: '原本維持',
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
  language: string;
  pageDirection: PageDirection;
  viewportWidth: number;
  viewportHeight: number;
  spreadMode: SpreadMode;
  orientation: Orientation;
  bookUuid: string;
  outputFormat: EpubFormat;
  allowMissingColophon?: boolean;
  hybridCssProfile?: HybridCssProfile;
  imageColorPolicy?: EpubImageColorPolicy;
}

export interface EpubSplitRange {
  startIndex: number;
  endIndex: number;
}

export interface EpubSplitSettings {
  enabled: boolean;
  ranges: EpubSplitRange[];
  baseName: string;
  suffixStart: number;
  suffixDigits: number;
  suffixSeparator: string;
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
  isBlank?: boolean;
  sourceColorMode?: ImageColorMode | string;
  imageProfileOverride?: EpubPageImageProfileOverride;
}

export interface EpubImageProfileSummary {
  rgbSrgbCount: number;
  adobeRgbCount: number;
  grayscaleDotGainCount: number;
  grayscaleNoProfileCount: number;
  noIccCount: number;
  preservedOriginalCount: number;
  warnings: string[];
}

// EPUB生成結果
export interface EpubGenerateResponse {
  success: boolean;
  outputPath: string;
  pageCount: number;
  fileSize: number;
  imageProfileSummary?: EpubImageProfileSummary;
  error?: string;
}

export interface EpubCheckMessage {
  severity: string;
  code?: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
}

export interface EpubCheckResult {
  available: boolean;
  isValid: boolean;
  checkedPath: string;
  checkerVersion?: string;
  elapsedMs: number;
  fatalCount: number;
  errorCount: number;
  warningCount: number;
  usageCount: number;
  infoCount: number;
  messages: EpubCheckMessage[];
  rawOutput?: string;
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
  // 画像メタデータ（台割側から引き継ぎ、mismatch tooltip表示に使用）
  imageWidth?: number;
  imageHeight?: number;
  imageColorMode?: ImageColorMode | string;
  imageDpi?: number;
  imageProfileOverride?: EpubPageImageProfileOverride;
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
