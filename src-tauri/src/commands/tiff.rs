use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::Manager;
use crate::types::{TiffConvertConfig, TiffConvertResponse, TiffResultsWrapper};
use super::photoshop::{
    find_photoshop_path,
    find_script_path,
    create_unique_output_dir,
    copy_script_with_bom,
    get_script_run_path,
    write_settings_json,
};

/// Photoshopがインストールされているかチェック
#[tauri::command]
pub async fn check_photoshop_installed() -> Result<bool, String> {
    Ok(find_photoshop_path().is_some())
}

/// Photoshopを使用してPSDをTIFFに変換
#[tauri::command]
pub async fn run_photoshop_tiff_convert(
    app_handle: tauri::AppHandle,
    config: TiffConvertConfig,
    output_dir: String,
    jpg_output_dir: Option<String>,
) -> Result<TiffConvertResponse, String> {
    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshopが見つかりません。Adobe Photoshopをインストールしてください。".to_string())?;

    // スクリプトパスを取得
    let script_path_str = find_script_path(&app_handle, "tiff_convert.jsx", "TIFF Convert")?;

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("daidori_tiff_settings.json");
    let output_path = temp_dir.join("daidori_tiff_results.json");

    // 既存の結果ファイルを削除
    let _ = fs::remove_file(&output_path);

    // 出力ディレクトリ: 既存の場合は連番で新規作成
    let final_output_dir = create_unique_output_dir(&output_dir, "TIFF Convert")?;

    // JPG出力ディレクトリ: 既存の場合は連番で新規作成
    let final_jpg_output_dir = if let Some(ref jdir) = jpg_output_dir {
        if !jdir.is_empty() {
            let base_path = Path::new(jdir);
            let resolved = if base_path.exists() {
                let base = jdir.clone();
                let mut counter = 1;
                loop {
                    let candidate = format!("{} ({})", base, counter);
                    if !Path::new(&candidate).exists() {
                        break candidate;
                    }
                    counter += 1;
                }
            } else {
                jdir.clone()
            };
            eprintln!("TIFF Convert - JPG Output dir: {}", resolved);
            let _ = fs::create_dir_all(&resolved);
            Some(resolved)
        } else {
            None
        }
    } else {
        None
    };

    // 設定JSONを作成（outputPathを最終出力ディレクトリに書き換え）
    let mut config_with_output = config;
    let output_dir_fwd = output_dir.replace('\\', "/");
    let final_dir_fwd = final_output_dir.replace('\\', "/");

    for file_config in &mut config_with_output.files {
        // outputPathを書き換え
        file_config.output_path = file_config.output_path.replace(&output_dir_fwd, &final_dir_fwd);

        // jpgOutputPathも書き換え
        if let (Some(ref orig_jpg), Some(ref final_jpg)) = (&jpg_output_dir, &final_jpg_output_dir) {
            if let Some(ref mut jpg_path) = file_config.jpg_output_path {
                let orig_fwd = orig_jpg.replace('\\', "/");
                let final_fwd = final_jpg.replace('\\', "/");
                *jpg_path = jpg_path.replace(&orig_fwd, &final_fwd);
            }
        }
    }

    // 設定ファイルを書き込み（UTF-8 BOM付き）
    write_settings_json(&settings_path, &config_with_output)?;

    // スクリプトをtempにコピー（UTF-8 BOM付きで書き出し）
    let temp_script = copy_script_with_bom(&script_path_str, "daidori_tiff_convert_temp.jsx")?;
    let script_to_run = get_script_run_path(&temp_script);

    eprintln!("TIFF Convert - Photoshop: {}", ps_path);
    eprintln!("TIFF Convert - Script: {}", script_to_run);

    // Photoshopを起動してスクリプトを実行
    let _child = Command::new(&ps_path)
        .args(["-r", &script_to_run])
        .spawn()
        .map_err(|e| format!("Photoshopの起動に失敗: {}", e))?;

    eprintln!("TIFF Convert - Launched: {} -r {}", ps_path, script_to_run);

    // 結果をポーリング（ハートビートベース）
    let file_count = config_with_output.files.len().max(1);
    let poll_interval_ms: u64 = 500;
    let initial_timeout_secs: u64 = 600;  // 10分（PS起動 + 最初のファイル）
    let final_timeout_secs: u64 = 120;    // 2分（最後のファイル後）
    let progress_path = temp_dir.join("daidori_tiff_progress.txt");
    let _ = fs::remove_file(&progress_path);
    let mut last_progress = String::new();
    let mut polls_since_progress: u64 = 0;
    let mut all_done = false;

    eprintln!("TIFF Convert - Heartbeat: {}s initial, no timeout during processing, {} files",
        initial_timeout_secs, file_count);

    loop {
        // 結果ファイルをチェック
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('{') && content.contains("results") {
                    eprintln!("TIFF Convert output ready");
                    break;
                }
            }
        }

        // 進捗ファイルをチェック（"X/N"形式）
        if let Ok(content) = fs::read_to_string(&progress_path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() && trimmed != last_progress {
                eprintln!("TIFF Convert progress: {}", trimmed);
                last_progress = trimmed.clone();
                polls_since_progress = 0;
                // "X/N"をパースして完了チェック
                if let Some((current, total)) = trimmed.split_once('/') {
                    if let (Ok(c), Ok(t)) = (current.parse::<u64>(), total.parse::<u64>()) {
                        all_done = c >= t && t > 0;
                    }
                }
            }
        }

        polls_since_progress += 1;

        // タイムアウト計算: 最初のハートビート前と全完了後のみ適用
        let timeout_polls = if last_progress.is_empty() {
            (initial_timeout_secs * 1000) / poll_interval_ms
        } else if all_done {
            (final_timeout_secs * 1000) / poll_interval_ms
        } else {
            (1800 * 1000) / poll_interval_ms  // 処理中は最大30分
        };

        if polls_since_progress >= timeout_polls {
            if last_progress.is_empty() {
                eprintln!("TIFF Convert timed out (Photoshopからの応答なし: {}秒)", initial_timeout_secs);
            } else {
                eprintln!("TIFF Convert timed out (結果ファイルが書き込まれませんでした)");
            }
            break;
        }

        tokio::time::sleep(std::time::Duration::from_millis(poll_interval_ms)).await;

        if polls_since_progress > 0 && polls_since_progress.is_multiple_of(60) {
            eprintln!("Still waiting for Photoshop TIFF convert... ({}s since last progress, {})",
                polls_since_progress * poll_interval_ms / 1000,
                if last_progress.is_empty() { "waiting for start" } else { &last_progress });
        }
    }

    let _ = fs::remove_file(&progress_path);

    // 結果を読み取り
    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("結果の読み取りに失敗: {}", e))?;

        let wrapper: TiffResultsWrapper = serde_json::from_str(&results_json)
            .map_err(|e| format!("結果のパースに失敗: {}. JSON: {}", e, results_json))?;

        // 一時ファイルを削除
        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&temp_script);

        // ウィンドウを前面に復帰
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(TiffConvertResponse {
            results: wrapper.results,
            output_dir: final_output_dir,
            jpg_output_dir: final_jpg_output_dir,
        })
    } else {
        let _ = fs::remove_file(&temp_script);
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshopが出力ファイルを生成しませんでした。スクリプトが失敗した可能性があります。".to_string())
    }
}
