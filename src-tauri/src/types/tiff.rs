use serde::{Deserialize, Serialize};

/// クロップ範囲
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffCropBounds {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

/// 部分ぼかし設定
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffPartialBlur {
    /// 部分ぼかし半径
    pub blur_radius: f64,
    /// 部分ぼかし範囲
    pub bounds: TiffCropBounds,
}

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
    /// カラーモード ("rgb" | "grayscale" | "mono" | "color")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<String>,
    /// ぼかしを適用するか
    #[serde(default)]
    pub apply_blur: bool,
    /// ぼかし半径
    #[serde(default)]
    pub blur_radius: f64,
    /// 部分ぼかし設定
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_blur: Option<TiffPartialBlur>,
    /// クロップをスキップするか
    #[serde(default)]
    pub skip_crop: bool,
    /// クロップ範囲（JSXスクリプトに透過的に渡す）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crop_bounds: Option<serde_json::Value>,
    /// JPG出力先（TIFF+JPG同時出力時）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jpg_output_path: Option<String>,
}

/// TIFF変換のグローバル設定
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffGlobalSettings {
    /// レイヤーを統合するか
    #[serde(default = "default_true")]
    pub flatten_image: bool,
    /// テキストと背景を分離するか
    #[serde(default)]
    pub separate_text_and_background: bool,
    /// テキストレイヤーを整理するか
    #[serde(default)]
    pub reorganize_text: bool,
    /// カラーモード ("rgb" | "grayscale" | "mono" | "color")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<String>,
    /// 出力幅 (px)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_width: Option<u32>,
    /// 出力高さ (px)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_height: Option<u32>,
    /// 出力DPI（デフォルト）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_dpi: Option<u32>,
    /// モノクロ用DPI（デフォルト600）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_dpi_mono: Option<u32>,
    /// カラー用DPI（デフォルト350）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_dpi_color: Option<u32>,
    /// TIFFとして出力するか（falseの場合はPSDまたはJPG）
    #[serde(default = "default_true")]
    pub proceed_as_tiff: bool,
    /// JPG出力を行うか
    #[serde(default)]
    pub output_jpg: bool,
}

fn default_true() -> bool {
    true
}

impl Default for TiffGlobalSettings {
    fn default() -> Self {
        Self {
            flatten_image: true,
            separate_text_and_background: false,
            reorganize_text: false,
            color_mode: None,
            target_width: None,
            target_height: None,
            target_dpi: None,
            target_dpi_mono: Some(600),
            target_dpi_color: Some(350),
            proceed_as_tiff: true,
            output_jpg: false,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jpg_output_dir: Option<String>,
}

/// JSXからの結果JSONのラッパー
#[derive(Debug, Deserialize)]
pub struct TiffResultsWrapper {
    pub results: Vec<TiffConvertResult>,
}
