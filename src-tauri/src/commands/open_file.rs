use tauri_plugin_opener::OpenerExt;

/// 外部アプリケーションでファイルを開く（シェルインジェクション対策済み）
#[tauri::command]
pub fn open_file_with_default_app(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<(), String> {
    app_handle
        .opener()
        .open_path(&file_path, None::<&str>)
        .map_err(|e| format!("ファイルを開けませんでした: {}", e))
}
