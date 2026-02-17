use serde::{Deserialize, Serialize};

/// TIFF変換の個別ファイル設定
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffFileConfig {
    /// 入力ファイルパス
    pub path: String,
    /// 出力ディレクトリ
    pub output_path: String,
    /// 出力ファイル名
    pub output_name: String,
    /// カラーモード ("rgb" | "grayscale")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<String>,
}

/// TIFF変換のグローバル設定
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffGlobalSettings {
    /// レイヤーを統合するか
    #[serde(default = "default_true")]
    pub flatten_image: bool,
    /// カラーモード ("rgb" | "grayscale")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<String>,
    /// 出力幅 (px)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_width: Option<u32>,
    /// 出力高さ (px)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_height: Option<u32>,
    /// 出力DPI
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_dpi: Option<u32>,
}

fn default_true() -> bool {
    true
}

impl Default for TiffGlobalSettings {
    fn default() -> Self {
        Self {
            flatten_image: true,
            color_mode: None,
            target_width: None,
            target_height: None,
            target_dpi: None,
        }
    }
}

/// TIFF変換の設定全体（JSXに渡すJSON）
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffConvertConfig {
    pub global_settings: TiffGlobalSettings,
    pub files: Vec<TiffFileConfig>,
}

/// TIFF変換の個別結果
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffConvertResult {
    pub file_name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// TIFF変換のレスポンス
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffConvertResponse {
    pub results: Vec<TiffConvertResult>,
    pub output_dir: String,
}

/// JSXからの結果JSONのラッパー
#[derive(Debug, Deserialize)]
pub struct TiffResultsWrapper {
    pub results: Vec<TiffConvertResult>,
}
