mod image;
mod psd;

pub use self::image::generate_image_thumbnail;
pub use self::psd::generate_psd_thumbnail;

use crate::cache::ThumbnailCache;
use crate::constants::THUMBNAIL_SIZE;
use crate::state::AppState;
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::State;

/// サムネイル生成結果
#[derive(Serialize)]
pub struct ThumbnailResult {
    /// キャッシュキー（MD5ハッシュ）
    pub cache_key: String,
    /// キャッシュファイルの絶対パス（asset プロトコル用）
    pub cache_path: String,
    /// ステータス: "cached" | "generated"
    pub status: String,
}

#[tauri::command]
pub async fn generate_thumbnail(
    file_path: String,
    modified_time: u64,
    cache: State<'_, ThumbnailCache>,
    app_state: State<'_, AppState>,
) -> Result<ThumbnailResult, String> {
    let cache_dir = cache.cache_dir.clone();

    // キャッシュキーを生成
    let input = format!("{}:{}:{}:png", file_path, modified_time, THUMBNAIL_SIZE);
    let cache_key = format!("{:x}", md5::compute(&input));

    // メモリキャッシュをチェック
    {
        let mut mem = app_state.memory_cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached_path) = mem.get(&cache_key) {
            if Path::new(&cached_path).exists() {
                return Ok(ThumbnailResult {
                    cache_key,
                    cache_path: cached_path,
                    status: "cached".to_string(),
                });
            }
        }
    }

    // ディスクキャッシュをチェック & サムネイル生成
    let result = tokio::task::spawn_blocking(move || {
        let path = Path::new(&file_path);

        if !path.exists() {
            return Err("ファイルが存在しません".to_string());
        }

        let cached_path = cache_dir.join(format!("{}.png", cache_key));
        let cache_path_str = cached_path.to_string_lossy().to_string();

        // ディスクキャッシュチェック
        if cached_path.exists() {
            return Ok(ThumbnailResult {
                cache_key,
                cache_path: cache_path_str,
                status: "cached".to_string(),
            });
        }

        // サムネイル生成
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let thumbnail_data = match ext.as_str() {
            "psd" => generate_psd_thumbnail(path)?,
            "tif" | "tiff" | "jpg" | "jpeg" | "png" => generate_image_thumbnail(path)?,
            _ => return Err(format!("サポートされていないファイル形式: {}", ext)),
        };

        // ディスクキャッシュに保存
        fs::write(&cached_path, &thumbnail_data).map_err(|e| e.to_string())?;

        Ok(ThumbnailResult {
            cache_key,
            cache_path: cache_path_str,
            status: "generated".to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    // メモリキャッシュに保存
    {
        let mut mem = app_state.memory_cache.lock().map_err(|e| e.to_string())?;
        mem.insert(result.cache_key.clone(), result.cache_path.clone());
    }

    Ok(result)
}
