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
use tauri::Manager;

// Tauri コマンドを再エクスポート
use commands::folder::get_folder_contents;
use commands::export::export_pages;
use commands::project::{save_project, load_project, validate_project_files};
use commands::recent::{get_recent_files, add_recent_file};
use commands::open_file::open_file_with_default_app;
use commands::tiff::{check_photoshop_installed, run_photoshop_tiff_convert};
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
        .setup(|app| {
            // ウィンドウアイコンを設定
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(img) = image::load_from_memory(icon_bytes) {
                    let rgba = img.to_rgba8();
                    let (width, height) = rgba.dimensions();
                    let icon = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
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
            open_file_with_default_app,
            check_photoshop_installed,
            run_photoshop_tiff_convert,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Tauriアプリケーション起動エラー: {}", e);
        std::process::exit(1);
    }
}
