use serde::{Deserialize, Serialize};

/// EPUB出力形式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EpubFormat {
    /// KADOKAWA電書協規格準拠（CSS 8ファイル、フル機能）
    Kadokawa,
    /// EPUB2/3両対応ハイブリッド形式（NCX + Navigation）
    Hybrid,
    /// 基本OEBPS構成（シンプル・軽量）
    Oebps,
}

impl Default for EpubFormat {
    fn default() -> Self {
        EpubFormat::Kadokawa
    }
}

impl EpubFormat {
    /// 形式に応じたデフォルトビューポートサイズを返す
    pub fn default_viewport(&self) -> (u32, u32) {
        match self {
            EpubFormat::Kadokawa => (1442, 2048),
            EpubFormat::Hybrid => (1127, 1600),
            EpubFormat::Oebps => (1352, 1920),
        }
    }

    /// OPFファイル名を返す
    pub fn opf_filename(&self) -> &'static str {
        match self {
            EpubFormat::Kadokawa | EpubFormat::Hybrid => "standard.opf",
            EpubFormat::Oebps => "content.opf",
        }
    }

    /// コンテンツルートフォルダを返す
    pub fn content_folder(&self) -> &'static str {
        match self {
            EpubFormat::Kadokawa | EpubFormat::Hybrid => "item",
            EpubFormat::Oebps => "OEBPS",
        }
    }

    /// 画像フォルダのパスを返す
    pub fn image_folder(&self) -> &'static str {
        match self {
            EpubFormat::Kadokawa | EpubFormat::Hybrid => "item/image",
            EpubFormat::Oebps => "OEBPS/images",
        }
    }

    /// XHTMLフォルダのパスを返す
    pub fn xhtml_folder(&self) -> &'static str {
        match self {
            EpubFormat::Kadokawa | EpubFormat::Hybrid => "item/xhtml",
            EpubFormat::Oebps => "OEBPS/text",
        }
    }

    /// CSSフォルダのパスを返す
    pub fn style_folder(&self) -> &'static str {
        match self {
            EpubFormat::Kadokawa | EpubFormat::Hybrid => "item/style",
            EpubFormat::Oebps => "OEBPS/styles",
        }
    }
}

/// ページ綴じ方向
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PageDirection {
    /// 右綴じ（日本の漫画、右から左へ読む）
    Rtl,
    /// 左綴じ（西洋式、左から右へ読む）
    Ltr,
}

impl Default for PageDirection {
    fn default() -> Self {
        PageDirection::Rtl
    }
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SpreadMode {
    /// 見開き表示
    Landscape,
    /// 単ページ表示
    Portrait,
    /// 自動
    Auto,
}

impl Default for SpreadMode {
    fn default() -> Self {
        SpreadMode::Landscape
    }
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Auto,
    Portrait,
    Landscape,
}

impl Default for Orientation {
    fn default() -> Self {
        Orientation::Auto
    }
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AuthorRole {
    /// 著者
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

impl Default for AuthorRole {
    fn default() -> Self {
        AuthorRole::Author
    }
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

    /// 日本語表示名
    pub fn display_name_ja(&self) -> &'static str {
        match self {
            AuthorRole::Author => "著者",
            AuthorRole::Illustrator => "イラスト",
            AuthorRole::Editor => "編集",
            AuthorRole::Translator => "翻訳",
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
    /// ISBN（オプション）
    #[serde(default)]
    pub isbn: Option<String>,
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
    /// 説明文（オプション）
    #[serde(default)]
    pub description: Option<String>,
}

fn default_language() -> String {
    "ja".to_string()
}

impl EpubMetadata {
    /// 新規メタデータを作成（UUID自動生成）
    pub fn new(title: String, publisher: String) -> Self {
        let format = EpubFormat::default();
        let (width, height) = format.default_viewport();
        Self {
            title,
            title_file_as: None,
            authors: Vec::new(),
            publisher,
            publisher_file_as: None,
            isbn: None,
            language: "ja".to_string(),
            page_direction: PageDirection::default(),
            viewport_width: width,
            viewport_height: height,
            spread_mode: SpreadMode::default(),
            orientation: Orientation::default(),
            book_uuid: uuid::Uuid::new_v4().to_string(),
            output_format: format,
            description: None,
        }
    }
}

/// EPUBページ情報
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubPage {
    /// ページID（例: p-001, p-cover）
    pub id: String,
    /// 出力ファイル名（例: p001.jpg）
    pub filename: String,
    /// 元ファイルパス
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
    /// エラーメッセージ（失敗時）
    #[serde(default)]
    pub error: Option<String>,
}
