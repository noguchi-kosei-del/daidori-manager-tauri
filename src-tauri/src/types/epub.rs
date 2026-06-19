use serde::{Deserialize, Serialize};

/// EPUB出力形式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum EpubFormat {
    /// KADOKAWA電書協規格準拠（CSS 8ファイル、フル機能）
    #[default]
    Kadokawa,
    /// EPUB2/3両対応ハイブリッド形式（NCX + Navigation）
    Hybrid,
    /// 基本OEBPS構成（シンプル・軽量）
    Oebps,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum HybridCssProfile {
    #[default]
    Current,
    Legacy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum EpubImageColorPolicy {
    #[default]
    Auto,
    FullColorSrgb,
    /// 全ページをグレースケール化して Dot Gain プロファイルを付与（モノクロ指定）
    FullMonoDotGain,
    FullColorAdobeRgb,
    AdobeRgbDotGain,
    NoIcc,
    PreserveOriginal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum EpubPageImageProfileOverride {
    #[default]
    Auto,
    Srgb,
    AdobeRgb,
    AdobeRgbDotGain,
    DotGain,
    NoIcc,
    PreserveOriginal,
}

/// ページ綴じ方向
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PageDirection {
    /// 右綴じ（日本の漫画、右から左へ読む）
    #[default]
    Rtl,
    /// 左綴じ（西洋式、左から右へ読む）
    Ltr,
}

impl PageDirection {
    pub fn as_str(&self) -> &'static str {
        match self {
            PageDirection::Rtl => "rtl",
            PageDirection::Ltr => "ltr",
        }
    }
}

/// 見開きモード
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SpreadMode {
    /// 見開き表示
    #[default]
    Landscape,
    /// 単ページ表示
    Portrait,
    /// 自動
    Auto,
}

impl SpreadMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            SpreadMode::Landscape => "landscape",
            SpreadMode::Portrait => "portrait",
            SpreadMode::Auto => "auto",
        }
    }
}

/// 画面向き
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    #[default]
    Auto,
    Portrait,
    Landscape,
}

impl Orientation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Orientation::Auto => "auto",
            Orientation::Portrait => "portrait",
            Orientation::Landscape => "landscape",
        }
    }
}

/// 著者の役割
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AuthorRole {
    /// 著者
    #[default]
    #[serde(rename = "aut")]
    Author,
    /// イラストレーター
    #[serde(rename = "ill")]
    Illustrator,
    /// 編集者
    #[serde(rename = "edt")]
    Editor,
    /// 翻訳者
    #[serde(rename = "trl")]
    Translator,
}

impl AuthorRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthorRole::Author => "aut",
            AuthorRole::Illustrator => "ill",
            AuthorRole::Editor => "edt",
            AuthorRole::Translator => "trl",
        }
    }
}

/// 著者情報
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorInfo {
    /// 著者名
    pub name: String,
    /// 読み仮名（ソート用）
    #[serde(default)]
    pub file_as: Option<String>,
    /// 役割
    #[serde(default)]
    pub role: AuthorRole,
    /// 表示用役割（原作、作画等のカスタム表記）
    #[serde(default)]
    pub role_display: Option<String>,
}

/// EPUBメタデータ
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubMetadata {
    /// 書籍タイトル
    pub title: String,
    /// タイトル読み仮名
    #[serde(default)]
    pub title_file_as: Option<String>,
    /// 著者リスト
    pub authors: Vec<AuthorInfo>,
    /// 出版社
    pub publisher: String,
    /// 出版社読み仮名
    #[serde(default)]
    pub publisher_file_as: Option<String>,
    /// 言語コード（デフォルト: ja）
    #[serde(default = "default_language")]
    pub language: String,
    /// ページ綴じ方向
    #[serde(default)]
    pub page_direction: PageDirection,
    /// ビューポート幅
    pub viewport_width: u32,
    /// ビューポート高さ
    pub viewport_height: u32,
    /// 見開きモード
    #[serde(default)]
    pub spread_mode: SpreadMode,
    /// 画面向き
    #[serde(default)]
    pub orientation: Orientation,
    /// 書籍UUID（永続化用、電子書店での識別子）
    pub book_uuid: String,
    /// 出力形式
    #[serde(default)]
    pub output_format: EpubFormat,
    /// Hybrid形式で奥付なし構成を許可する
    #[serde(default)]
    pub allow_missing_colophon: bool,
    /// Hybrid形式で使用するCSSセット
    #[serde(default)]
    pub hybrid_css_profile: HybridCssProfile,
    /// EPUB生成時の画像カラープロファイル方針
    #[serde(default)]
    pub image_color_policy: EpubImageColorPolicy,
}

fn default_language() -> String {
    "ja".to_string()
}

/// EPUBページ情報
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubPage {
    /// ページID（例: p-001, p-cover）
    pub id: String,
    /// 出力ファイル名（例: p001.jpg）
    pub filename: String,
    /// 元ファイルパス（白紙ページの場合は空文字）
    pub source_path: String,
    /// 画像幅
    pub width: u32,
    /// 画像高さ
    pub height: u32,
    /// 表紙フラグ
    #[serde(default)]
    pub is_cover: bool,
    /// 奥付フラグ
    #[serde(default)]
    pub is_colophon: bool,
    /// 白紙ページフラグ（true の場合は width/height で白JPEGを生成）
    #[serde(default)]
    pub is_blank: bool,
    /// 元画像のカラーモード（RGB/Grayscale/CMYK/Bitmap など）
    #[serde(default)]
    pub source_color_mode: Option<String>,
    /// ページ単位のICCプロファイル上書き
    #[serde(default)]
    pub image_profile_override: EpubPageImageProfileOverride,
    /// 事前正規化済みフラグ（19.3: Photoshopエンジンで sRGB プロファイル変換・
    /// ICC埋め込み・最終サイズ化済みの中間JPEG）。
    /// true の場合、builder はリサイズ不要なら再エンコードせずコピーする。
    #[serde(default)]
    pub pre_normalized: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubImageProfileSummary {
    pub rgb_srgb_count: usize,
    pub adobe_rgb_count: usize,
    pub grayscale_dot_gain_count: usize,
    pub grayscale_no_profile_count: usize,
    pub no_icc_count: usize,
    pub preserved_original_count: usize,
    pub warnings: Vec<String>,
}

/// EPUB生成設定
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubGenerateConfig {
    /// メタデータ
    pub metadata: EpubMetadata,
    /// ページリスト
    pub pages: Vec<EpubPage>,
    /// 出力パス（.epubファイル）
    pub output_path: String,
    /// カスタムCSS（オプション）
    #[serde(default)]
    pub custom_css: Option<String>,
}

/// EPUB生成結果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubGenerateResponse {
    /// 成功フラグ
    pub success: bool,
    /// 出力ファイルパス
    pub output_path: String,
    /// ページ数
    pub page_count: usize,
    /// ファイルサイズ（バイト）
    pub file_size: u64,
    /// EPUB生成時の画像カラープロファイル処理サマリー
    #[serde(default)]
    pub image_profile_summary: Option<EpubImageProfileSummary>,
    /// エラーメッセージ（失敗時）
    #[serde(default)]
    pub error: Option<String>,
}
