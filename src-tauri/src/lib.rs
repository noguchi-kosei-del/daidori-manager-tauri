mod constants;
mod types;
mod cache;
mod state;
mod image_utils;
mod thumbnail;
mod commands;
mod epub;

use std::sync::Mutex;
use cache::{ThumbnailCache, ThumbnailMemoryCache};
use state::AppState;
use constants::MEMORY_CACHE_MAX_SIZE;
use tauri::Manager;

// Tauri コマンドを再エクスポート
use commands::folder::get_folder_contents;
use commands::export::export_pages;
use commands::project::{save_project, load_project, validate_project_files, validate_pages};
use commands::recent::{get_recent_files, add_recent_file};
use commands::open_file::open_file_with_default_app;
use commands::tiff::{check_photoshop_installed, run_photoshop_tiff_convert};
use commands::jpeg::run_photoshop_jpeg_convert;
use commands::epub::{generate_epub, generate_book_uuid, get_image_dimensions, create_epub_metadata, get_default_viewport, read_psd_guides};
use commands::tachimi::{detect_tachimi_exe, generate_tachimi_chapter_pdfs};
use thumbnail::generate_thumbnail;

/// スプラッシュウィンドウを一定時間表示した後、閉じてメインウィンドウを表示する
#[tauri::command]
async fn close_splash(window: tauri::Window) -> Result<(), String> {
    let app = window.app_handle();

    // スプラッシュを2秒間表示
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    // メインウィンドウを表示
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.show().map_err(|e| e.to_string())?;
    }

    // スプラッシュウィンドウを閉じる
    if let Some(splash_window) = app.get_webview_window("splash") {
        splash_window.close().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ThumbnailCache::new())
        .manage(AppState {
            memory_cache: Mutex::new(ThumbnailMemoryCache::new(MEMORY_CACHE_MAX_SIZE)),
        })
        .setup(|app| {
            // スプラッシュウィンドウを作成
            let splash_url = tauri::WebviewUrl::App("splash.html".into());
            tauri::WebviewWindowBuilder::new(app, "splash", splash_url)
                .title("台割マネージャー")
                .inner_size(500.0, 400.0)
                .resizable(false)
                .decorations(false)
                .center()
                .always_on_top(true)
                .skip_taskbar(true)
                .build()
                .map_err(|e| e.to_string())?;

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
            close_splash,
            get_folder_contents,
            generate_thumbnail,
            export_pages,
            save_project,
            load_project,
            validate_project_files,
            validate_pages,
            get_recent_files,
            add_recent_file,
            open_file_with_default_app,
            check_photoshop_installed,
            run_photoshop_tiff_convert,
            run_photoshop_jpeg_convert,
            generate_epub,
            generate_book_uuid,
            get_image_dimensions,
            create_epub_metadata,
            get_default_viewport,
            read_psd_guides,
            detect_tachimi_exe,
            generate_tachimi_chapter_pdfs,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Tauriアプリケーション起動エラー: {}", e);
        std::process::exit(1);
    }
}
