mod constants;
mod types;
mod cache;
mod state;
mod image_utils;
mod thumbnail;
mod commands;

use std::sync::Mutex;
use cache::{ThumbnailCache, ThumbnailMemoryCache};
use state::AppState;
use constants::MEMORY_CACHE_MAX_SIZE;

// Tauri コマンドを再エクスポート
use commands::folder::get_folder_contents;
use commands::export::export_pages;
use commands::project::{save_project, load_project, validate_project_files};
use commands::recent::{get_recent_files, add_recent_file};
use thumbnail::generate_thumbnail;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ThumbnailCache::new())
        .manage(AppState {
            memory_cache: Mutex::new(ThumbnailMemoryCache::new(MEMORY_CACHE_MAX_SIZE)),
        })
        .invoke_handler(tauri::generate_handler![
            get_folder_contents,
            generate_thumbnail,
            export_pages,
            save_project,
            load_project,
            validate_project_files,
            get_recent_files,
            add_recent_file,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Tauriアプリケーション起動エラー: {}", e);
        std::process::exit(1);
    }
}
