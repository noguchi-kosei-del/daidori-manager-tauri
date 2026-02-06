use serde::{Deserialize, Serialize};

// エクスポート用ページ情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPage {
    pub source_path: Option<String>,
    pub output_name: String,
    pub page_type: String,  // "file", "cover", "blank", "intermission", "colophon"
    pub subfolder: Option<String>,  // チャプターごとのサブフォルダ名
}
