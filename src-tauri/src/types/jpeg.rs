use serde::{Deserialize, Serialize};

/// JPEG変換の個別ファイル設定
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegFileConfig {
    /// 入力ファイルパス
    pub path: String,
    /// 出力ディレクトリ
    pub output_path: String,
    /// 出力ファイル名
    pub output_name: String,
}

/// JPEG変換のグローバル設定
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegGlobalSettings {
    /// JPEG品質（1-12, Photoshop scale）
    #[serde(default = "default_quality")]
    pub jpg_quality: u8,
}

fn default_quality() -> u8 {
    12
}

impl Default for JpegGlobalSettings {
    fn default() -> Self {
        Self {
            jpg_quality: 12,
        }
    }
}

/// JPEG変換の設定全体（JSXに渡すJSON）
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegConvertConfig {
    pub global_settings: JpegGlobalSettings,
    pub files: Vec<JpegFileConfig>,
}

/// JPEG変換の個別結果
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegConvertResult {
    pub file_name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// JPEG変換のレスポンス
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegConvertResponse {
    pub results: Vec<JpegConvertResult>,
    pub output_dir: String,
}

/// JSXからの結果JSONのラッパー
#[derive(Debug, Deserialize)]
pub struct JpegResultsWrapper {
    pub results: Vec<JpegConvertResult>,
}
