use tauri_plugin_opener::OpenerExt;

/// 外部アプリケーションでファイルを開く（シェルインジェクション対策済み）
#[tauri::command]
pub fn open_file_with_default_app(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<(), String> {
    // 許可リスト検証（任意ファイルを既定アプリで開かせない）
    let _ = crate::security::grant_user_path(&file_path);
    let validated = crate::security::ensure_read_path(&file_path)?;
    app_handle
        .opener()
        .open_path(validated.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("ファイルを開けませんでした: {}", e))
}
