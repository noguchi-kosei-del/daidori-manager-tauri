use std::fs;
use std::path::Path;
use crate::types::{ProjectFile, SavedFileReference, FileValidationResult};

// プロジェクトを保存
#[tauri::command]
pub async fn save_project(file_path: String, project: ProjectFile) -> Result<(), String> {
    let path = Path::new(&file_path);

    // 親ディレクトリが存在することを確認
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("ディレクトリ作成エラー: {}", e))?;
    }

    // JSONとしてシリアライズして書き込み
    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("JSONシリアライズエラー: {}", e))?;

    fs::write(path, json).map_err(|e| format!("ファイル書き込みエラー: {}", e))?;

    Ok(())
}

// プロジェクトを読み込み
#[tauri::command]
pub async fn load_project(file_path: String) -> Result<ProjectFile, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err("ファイルが見つかりません".to_string());
    }

    let content = fs::read_to_string(path).map_err(|e| format!("ファイル読み込みエラー: {}", e))?;
    let project: ProjectFile = serde_json::from_str(&content)
        .map_err(|e| format!("JSON解析エラー: {}", e))?;

    Ok(project)
}

// ファイル参照を検証
fn validate_file_reference(
    page_id: &str,
    file_ref: &SavedFileReference,
    base_path: &Path,
) -> FileValidationResult {
    let absolute = Path::new(&file_ref.absolute_path);
    let relative = base_path.join(&file_ref.relative_path);

    // まず絶対パスを試す
    if absolute.exists() {
        // ファイルが変更されているかチェック
        if let Ok(metadata) = fs::metadata(absolute) {
            let current_time = metadata
                .modified()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
                .unwrap_or(0);

            if current_time != file_ref.modified_time {
                return FileValidationResult {
                    page_id: page_id.to_string(),
                    status: "modified".to_string(),
                    original_path: file_ref.absolute_path.clone(),
                    resolved_path: Some(file_ref.absolute_path.clone()),
                    suggested_path: None,
                };
            }
        }

        return FileValidationResult {
            page_id: page_id.to_string(),
            status: "found".to_string(),
            original_path: file_ref.absolute_path.clone(),
            resolved_path: Some(file_ref.absolute_path.clone()),
            suggested_path: None,
        };
    }

    // 相対パスを試す
    if relative.exists() {
        return FileValidationResult {
            page_id: page_id.to_string(),
            status: "moved".to_string(),
            original_path: file_ref.absolute_path.clone(),
            resolved_path: Some(relative.to_string_lossy().to_string()),
            suggested_path: Some(relative.to_string_lossy().to_string()),
        };
    }

    // ファイルが見つからない
    FileValidationResult {
        page_id: page_id.to_string(),
        status: "missing".to_string(),
        original_path: file_ref.absolute_path.clone(),
        resolved_path: None,
        suggested_path: None,
    }
}

// プロジェクト内のファイル参照を検証
#[tauri::command]
pub async fn validate_project_files(
    project: ProjectFile,
    base_path: String,
) -> Result<Vec<FileValidationResult>, String> {
    let mut results = Vec::new();
    let base = Path::new(&base_path);

    for chapter in &project.chapters {
        for page in &chapter.pages {
            if let Some(ref file_ref) = page.file {
                let result = validate_file_reference(&page.id, file_ref, base);
                results.push(result);
            }
        }
    }

    Ok(results)
}
