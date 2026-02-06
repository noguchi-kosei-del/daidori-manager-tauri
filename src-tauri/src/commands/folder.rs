use std::fs;
use std::path::Path;
use crate::types::FileInfo;
use crate::constants::SUPPORTED_EXTENSIONS;
use crate::image_utils::get_file_type;

#[tauri::command]
pub fn get_folder_contents(folder_path: String) -> Result<Vec<FileInfo>, String> {
    let path = Path::new(&folder_path);

    if !path.exists() || !path.is_dir() {
        return Err("無効なフォルダパス".to_string());
    }

    let mut files: Vec<FileInfo> = Vec::new();

    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry_result in entries {
        // ディレクトリエントリ読み込みエラーをログ出力
        let entry = match entry_result {
            Ok(e) => e,
            Err(e) => {
                eprintln!("ディレクトリエントリ読み込みエラー: {}", e);
                continue;
            }
        };
        let entry_path = entry.path();

        if !entry_path.is_file() {
            continue;
        }

        let ext = entry_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        if !SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
            continue;
        }

        let metadata = entry_path.metadata().map_err(|e| e.to_string())?;
        let file_type = get_file_type(ext).unwrap_or("unknown");

        let modified_time = metadata
            .modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
            .unwrap_or(0);

        files.push(FileInfo {
            path: entry_path.to_string_lossy().to_string(),
            name: entry_path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            size: metadata.len(),
            modified_time,
            file_type: file_type.to_string(),
        });
    }

    // ファイル名で自然順ソート
    files.sort_by(|a, b| natord::compare(&a.name, &b.name));

    Ok(files)
}
