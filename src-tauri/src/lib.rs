mod cache;
// commands/epub/types は統合テスト（tests/）から参照するため pub
pub mod commands;
mod constants;
pub mod epub;
mod image_utils;
mod integrity;
mod native_jpeg;
mod security;
mod state;
mod thumbnail;
pub mod types;
mod updater_local;

/// デバッグ専用ログ。release では出力しない（本番でのパス露出防止）。
#[macro_export]
macro_rules! dlog {
    ($($arg:tt)*) => {{
        #[cfg(debug_assertions)] eprintln!($($arg)*);
        #[cfg(not(debug_assertions))] { let _ = format_args!($($arg)*); }
    }};
}

use cache::{ThumbnailCache, ThumbnailMemoryCache};
use constants::MEMORY_CACHE_MAX_SIZE;
use state::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// ファイル関連付け（.daiw ダブルクリック）起動時のファイルパスを保持する
struct PendingOpen(Mutex<Option<String>>);

/// 起動引数（exe パスを除く）から実在する .daiw を探す
fn find_daiw_path(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".daiw") && std::path::Path::new(a).is_file())
        .cloned()
}

/// フロント準備後に保持済みの起動ファイルパスを取得（取得と同時にクリア）
#[tauri::command]
fn take_pending_open_path(state: tauri::State<PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

// Tauri コマンドを再エクスポート
use commands::cllenn::{
    get_cllenn_json_dir, list_cllenn_labels, list_cllenn_works, read_cllenn_ranges,
};
use commands::epub::{
    generate_book_uuid, generate_epub, get_available_epub_output_path, get_image_dimensions,
    read_psd_guides,
};
use commands::epub_verify::verify_epub_internal;
use commands::epubcheck::validate_epub_with_epubcheck;
use commands::export::export_pages;
use commands::folder::{ensure_dir, get_folder_contents};
use commands::jpeg_native::run_native_jpeg_convert;
use commands::open_file::open_file_with_default_app;
use commands::pdf::rasterize_pdf;
use commands::project::{
    get_available_project_save_path, load_project, save_project, validate_pages,
};
use commands::recent::add_recent_file;
use commands::srgb_convert::run_photoshop_srgb_convert;
use commands::tachimi::{detect_tachimi_exe, generate_tachimi_chapter_pdfs};
use commands::tiff::{check_photoshop_installed, read_atn_actions, run_photoshop_tiff_convert};
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
        // single-instance は最初に登録する（Tauri 公式要件）。
        // 既にアプリが開いている状態で .daiw をダブルクリックした場合（ウォームスタート）、
        // 二重起動を防ぎ、既存ウィンドウを前面化してファイルを読み込む。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = find_daiw_path(&argv) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
                let _ = app.emit("open-project-file", path);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|_window, event| {
            // 実D&D で投入されたパスを Rust が直接許可リストへ（OS由来＝XSS偽装不可・保護パスは拒否）
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                for p in paths {
                    let _ = security::grant_user_path(p);
                }
            }
        })
        .manage(ThumbnailCache::new())
        .manage(AppState {
            memory_cache: Mutex::new(ThumbnailMemoryCache::new(MEMORY_CACHE_MAX_SIZE)),
        })
        .manage(PendingOpen(Mutex::new(None)))
        .setup(|app| {
            // セキュリティ初期化（許可ルート・temp ACL）
            security::init();
            security::harden_temp_dir();

            // コールドスタート: 起動引数から .daiw を拾って保持し、
            // フロント準備後に take_pending_open_path で取得・読込する。
            // 起動 .daiw のフォルダを許可リストへ（プロジェクトフォルダ内のリンク画像参照のため）
            if let Some(p) = find_daiw_path(&std::env::args().collect::<Vec<_>>()) {
                let _ = security::grant_user_path(&p);
            }
            if let Some(path) = find_daiw_path(&std::env::args().collect::<Vec<_>>()) {
                if let Some(state) = app.try_state::<PendingOpen>() {
                    *state.0.lock().unwrap() = Some(path);
                }
            }

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
            take_pending_open_path,
            get_folder_contents,
            ensure_dir,
            generate_thumbnail,
            export_pages,
            get_available_project_save_path,
            save_project,
            load_project,
            validate_pages,
            add_recent_file,
            open_file_with_default_app,
            check_photoshop_installed,
            run_photoshop_tiff_convert,
            read_atn_actions,
            get_cllenn_json_dir,
            list_cllenn_labels,
            list_cllenn_works,
            read_cllenn_ranges,
            run_native_jpeg_convert,
            run_photoshop_srgb_convert,
            get_available_epub_output_path,
            generate_epub,
            generate_book_uuid,
            get_image_dimensions,
            read_psd_guides,
            validate_epub_with_epubcheck,
            verify_epub_internal,
            detect_tachimi_exe,
            generate_tachimi_chapter_pdfs,
            rasterize_pdf,
            security::register_paths,
            updater_local::check_local_update,
            updater_local::apply_local_update,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Tauriアプリケーション起動エラー: {}", e);
        std::process::exit(1);
    }
}
