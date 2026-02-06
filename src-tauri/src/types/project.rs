use serde::{Deserialize, Serialize};

// ファイル参照情報（保存用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFileReference {
    pub absolute_path: String,
    pub relative_path: String,
    pub file_name: String,
    pub file_type: String,
    pub file_size: u64,
    pub modified_time: u64,
}

// 保存されるページ
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedPage {
    pub id: String,
    pub page_type: String,
    pub file: Option<SavedFileReference>,
    pub label: Option<String>,
}

// 保存されるチャプター
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedChapter {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub chapter_type: String,
    pub pages: Vec<SavedPage>,
    pub folder_path: Option<String>,
}

// 保存されるUI状態
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedUiState {
    pub selected_chapter_id: Option<String>,
    pub selected_page_id: Option<String>,
    pub view_mode: String,
    pub thumbnail_size: String,
    pub collapsed_chapter_ids: Vec<String>,
}

// プロジェクトファイル形式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFile {
    pub version: String,
    pub name: String,
    pub created_at: String,
    pub modified_at: String,
    pub base_path: String,
    pub chapters: Vec<SavedChapter>,
    pub ui_state: Option<SavedUiState>,
}

// ファイル検証結果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileValidationResult {
    pub page_id: String,
    pub status: String,  // "found", "missing", "moved", "modified"
    pub original_path: String,
    pub resolved_path: Option<String>,
    pub suggested_path: Option<String>,
}

// 最近使ったファイル
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub opened_at: String,
}
