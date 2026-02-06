use std::fs;
use std::path::{Path, PathBuf};
use crate::types::RecentFile;

// 設定ディレクトリを取得
fn get_config_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|p| p.join("daidori-manager"))
        .ok_or_else(|| "設定ディレクトリを特定できません".to_string())
}

// 最近使ったファイル一覧を取得
#[tauri::command]
pub async fn get_recent_files() -> Result<Vec<RecentFile>, String> {
    let config_path = get_config_path()?;
    let recent_path = config_path.join("recent_files.json");

    if !recent_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&recent_path).map_err(|e| format!("読み込みエラー: {}", e))?;
    let recent: Vec<RecentFile> = serde_json::from_str(&content).unwrap_or_default();

    // 存在しないファイルをフィルタリング
    let valid: Vec<RecentFile> = recent
        .into_iter()
        .filter(|r| Path::new(&r.path).exists())
        .collect();

    Ok(valid)
}

// 最近使ったファイルに追加
#[tauri::command]
pub async fn add_recent_file(path: String, name: String) -> Result<(), String> {
    let config_path = get_config_path()?;
    let recent_path = config_path.join("recent_files.json");

    let mut recent = if recent_path.exists() {
        let content = fs::read_to_string(&recent_path).map_err(|e| format!("読み込みエラー: {}", e))?;
        serde_json::from_str::<Vec<RecentFile>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // 既に存在する場合は削除
    recent.retain(|r| r.path != path);

    // 先頭に追加
    recent.insert(0, RecentFile {
        path: path.clone(),
        name,
        opened_at: chrono::Utc::now().to_rfc3339(),
    });

    // 最大10件まで保持
    recent.truncate(10);

    // ディレクトリが存在することを確認
    fs::create_dir_all(&config_path).map_err(|e| format!("ディレクトリ作成エラー: {}", e))?;

    // 保存
    let json = serde_json::to_string_pretty(&recent).map_err(|e| format!("JSONシリアライズエラー: {}", e))?;
    fs::write(&recent_path, json).map_err(|e| format!("ファイル書き込みエラー: {}", e))?;

    Ok(())
}
