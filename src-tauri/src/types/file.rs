use serde::{Deserialize, Serialize};

// ファイル情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_time: u64,
    pub file_type: String,
}
