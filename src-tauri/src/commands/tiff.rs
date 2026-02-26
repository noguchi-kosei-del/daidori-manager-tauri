use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use tauri::Manager;
use crate::types::{TiffConvertConfig, TiffConvertResponse, TiffResultsWrapper};

/// Photoshopのインストールパスを検索
fn find_photoshop_path() -> Option<String> {
    let possible_paths = [
        // Adobe Photoshop 2025
        r"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe",
        // Adobe Photoshop 2024
        r"C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe",
        // Adobe Photoshop 2023
        r"C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe",
        // Adobe Photoshop CC 2022
        r"C:\Program Files\Adobe\Adobe Photoshop 2022\Photoshop.exe",
        // Adobe Photoshop CC 2021
        r"C:\Program Files\Adobe\Adobe Photoshop 2021\Photoshop.exe",
        // Adobe Photoshop CC 2020
        r"C:\Program Files\Adobe\Adobe Photoshop 2020\Photoshop.exe",
        // Adobe Photoshop CC 2019
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2019\Photoshop.exe",
        // Adobe Photoshop CC 2018
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2018\Photoshop.exe",
        // Adobe Photoshop CC
        r"C:\Program Files\Adobe\Adobe Photoshop CC\Photoshop.exe",
        // 32bit versions
        r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2025\Photoshop.exe",
        r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2024\Photoshop.exe",
        r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2023\Photoshop.exe",
    ];

    for path in &possible_paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}

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
) -> Result<TiffConvertResponse, String> {
    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshopが見つかりません。Adobe Photoshopをインストールしてください。".to_string())?;

    // スクリプトパスを取得
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("リソースディレクトリの取得に失敗: {}", e))?;

    eprintln!("TIFF Convert - Resource dir: {}", resource_path.display());

    // 検索するパスのリスト（優先順位順）
    let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("tiff_convert.jsx");
    let resource_script = resource_path.join("scripts").join("tiff_convert.jsx");
    let resource_root_script = resource_path.join("tiff_convert.jsx");

    eprintln!("TIFF Convert - Checking dev script: {} (exists: {})", dev_script.display(), dev_script.exists());
    eprintln!("TIFF Convert - Checking resource script: {} (exists: {})", resource_script.display(), resource_script.exists());
    eprintln!("TIFF Convert - Checking resource root script: {} (exists: {})", resource_root_script.display(), resource_root_script.exists());

    let script_path_str = if dev_script.exists() {
        dev_script.to_string_lossy().to_string()
    } else if resource_script.exists() {
        resource_script.to_string_lossy().to_string()
    } else if resource_root_script.exists() {
        resource_root_script.to_string_lossy().to_string()
    } else {
        return Err(format!(
            "TIFF変換スクリプトが見つかりません。検索パス:\n- {}\n- {}\n- {}",
            dev_script.display(),
            resource_script.display(),
            resource_root_script.display()
        ));
    };

    eprintln!("TIFF Convert - Using script: {}", script_path_str);

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("daidori_tiff_settings.json");
    let output_path = temp_dir.join("daidori_tiff_results.json");

    // 既存の結果ファイルを削除
    let _ = fs::remove_file(&output_path);

    // 出力ディレクトリ: 既存の場合は連番で新規作成
    let final_output_dir = {
        let base_path = Path::new(&output_dir);
        if base_path.exists() {
            let base = output_dir.clone();
            let mut counter = 1;
            loop {
                let candidate = format!("{} ({})", base, counter);
                if !Path::new(&candidate).exists() {
                    fs::create_dir_all(&candidate)
                        .map_err(|e| format!("出力ディレクトリの作成に失敗: {}", e))?;
                    break candidate;
                }
                counter += 1;
            }
        } else {
            fs::create_dir_all(&output_dir)
                .map_err(|e| format!("出力ディレクトリの作成に失敗: {}", e))?;
            output_dir.clone()
        }
    };

    eprintln!("TIFF Convert - Output dir: {}", final_output_dir);

    // 設定JSONを作成（outputPathを最終出力ディレクトリに書き換え）
    let mut config_with_output = config;
    for file_config in &mut config_with_output.files {
        file_config.output_path = final_output_dir.clone();
    }

    let settings_json = serde_json::to_string(&config_with_output)
        .map_err(|e| format!("JSON変換に失敗: {}", e))?;

    // 設定ファイルを書き込み（UTF-8 BOM付き）
    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("設定ファイルの作成に失敗: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("BOM書き込みに失敗: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("設定の書き込みに失敗: {}", e))?;
    drop(settings_file);

    // スクリプトをtempにコピー（UTF-8 BOM付きで書き出し）
    let temp_script = temp_dir.join("daidori_tiff_convert_temp.jsx");
    let script_content = fs::read_to_string(&script_path_str)
        .map_err(|e| format!("スクリプトの読み込みに失敗: {} (元: {})", e, script_path_str))?;

    // UTF-8 BOM + スクリプト内容を書き出し
    let mut script_file = fs::File::create(&temp_script)
        .map_err(|e| format!("スクリプトファイルの作成に失敗: {}", e))?;
    script_file.write_all(&[0xEF, 0xBB, 0xBF])  // UTF-8 BOM
        .map_err(|e| format!("BOM書き込みに失敗: {}", e))?;
    script_file.write_all(script_content.as_bytes())
        .map_err(|e| format!("スクリプト書き込みに失敗: {}", e))?;
    drop(script_file);

    // コピー後の存在確認
    if !temp_script.exists() {
        return Err(format!("スクリプトのコピー後にファイルが見つかりません: {}", temp_script.display()));
    }

    // コピーしたファイルの内容確認
    let copied_size = fs::metadata(&temp_script)
        .map(|m| m.len())
        .unwrap_or(0);
    eprintln!("TIFF Convert - Copied script size: {} bytes", copied_size);
    if copied_size == 0 {
        return Err("スクリプトファイルが空です".to_string());
    }

    // フルパスを取得（8.3形式を回避）
    let script_to_run = temp_script.canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| temp_script.to_string_lossy().to_string());

    // \\?\ プレフィックスを削除
    let script_to_run = script_to_run.strip_prefix(r"\\?\").unwrap_or(&script_to_run).to_string();

    eprintln!("TIFF Convert - Photoshop: {}", ps_path);
    eprintln!("TIFF Convert - Script: {}", script_to_run);

    // Photoshopを起動してスクリプトを実行
    // 注: Photoshop 2025では -r オプションの後にスペースを入れてパスを指定
    let _child = Command::new(&ps_path)
        .args(["-r", &script_to_run])
        .spawn()
        .map_err(|e| format!("Photoshopの起動に失敗: {}", e))?;

    eprintln!("TIFF Convert - Launched: {} -r {}", ps_path, script_to_run);

    // 結果をポーリング
    let file_count = config_with_output.files.len().max(1);
    let poll_interval_ms: u64 = 500;
    let initial_timeout_secs: u64 = 600;  // 10分（PS起動 + 最初のファイル）
    let final_timeout_secs: u64 = 120;    // 2分（最後のファイル後）
    let progress_path = temp_dir.join("daidori_tiff_progress.txt");
    let _ = fs::remove_file(&progress_path);
    let mut last_progress = String::new();
    let mut polls_since_progress: u64 = 0;
    let mut all_done = false;

    eprintln!("TIFF Convert - Heartbeat: {}s initial, {} files", initial_timeout_secs, file_count);

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

        // タイムアウト計算
        let timeout_polls = if all_done {
            (final_timeout_secs * 1000) / poll_interval_ms
        } else if last_progress.is_empty() {
            (initial_timeout_secs * 1000) / poll_interval_ms
        } else {
            u64::MAX  // 処理中はタイムアウトなし
        };

        if polls_since_progress >= timeout_polls {
            if last_progress.is_empty() {
                eprintln!("TIFF Convert timed out (Photoshopからの応答なし: {}秒)", initial_timeout_secs);
            } else {
                eprintln!("TIFF Convert timed out (結果ファイルが書き込まれませんでした)");
            }
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms));

        if polls_since_progress > 0 && polls_since_progress % 60 == 0 {
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
        })
    } else {
        let _ = fs::remove_file(&temp_script);
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshopが出力ファイルを生成しませんでした。スクリプトが失敗した可能性があります。".to_string())
    }
}
