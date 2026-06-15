//! Photoshop による sRGB プロファイル変換コマンド（19.3 実験）
//!
//! EPUB 生成前の PSD→JPEG 中間変換を Photoshop の「プロファイル変換
//! （Convert to Profile）」で実行する。ネイティブ変換（native_jpeg / image
//! クレート）は ICC を埋め込むだけで画素の色変換を行わないため、Adobe RGB
//! などの素材を sRGB 化したとき Photoshop 基準の色とずれる可能性がある。
//! 本コマンドは Photoshop に開かせて厳密に色変換し、中間 JPEG だけを返す。
//!
//! レスポンス形は jpeg_native::NativeJpegResponse と同形にしてあり、
//! フロント側で `run_native_jpeg_convert` と差し替えできる。

use super::photoshop::{
    copy_script_with_bom, create_unique_output_dir, find_photoshop_path, find_script_path,
    get_script_run_path, write_settings_json,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;
use tauri::{Emitter, Manager};

/// 変換対象ファイル1件分
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SrgbConvertFile {
    /// 入力ファイルパス
    pub path: String,
    /// 出力ディレクトリ（Rust 側で最終出力ディレクトリに書き換える）
    pub output_path: String,
    /// 出力ファイル名（例 "psd_0000.jpg"）
    pub output_name: String,
    /// 内蔵クロップ（断ち切り）の範囲。JSXへ素通しする（比率方式: left/top/right/bottom +
    /// refWidth/refHeight + isProportional）。なし/不要なら省略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop_bounds: Option<serde_json::Value>,
}

/// グローバル設定
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SrgbGlobalSettings {
    /// JPEG 品質（Photoshop の 1-12）
    #[serde(default = "default_jpeg_quality")]
    pub jpeg_quality: u8,
    /// 描画インテント: "relative"(既定) / "perceptual" / "saturation" / "absolute"
    #[serde(default = "default_intent")]
    pub intent: String,
    /// 黒点補正
    #[serde(default = "default_bpc")]
    pub black_point_compensation: bool,
    /// プロファイル変換時のディザ（8bit変換のバンディング低減。Photoshop既定はON）
    #[serde(default = "default_dither")]
    pub dither: bool,
    /// 出力画像の最大ピクセル数。Photoshop内で高ビット深度のまま最終サイズへ縮小する。
    /// builder の Apple Books 制約（5.6MP）と同値にすることで、builder 側の
    /// 再リサイズ・再エンコードを不要にする（pre_normalized コピー経路）。0 で無効。
    #[serde(default = "default_max_pixels")]
    pub max_pixels: u64,
    /// 断ち切り等のPhotoshopアクションを各ページに実行するか（TIFF変換と同じ仕組み）。
    /// アクションは色変換・縮小より前に実行する（切り抜き＝幾何処理を先に確定）。
    #[serde(default)]
    pub run_action: bool,
    /// 選択した .atn ファイルのフルパス（処理開始時に app.load で読み込む）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_set_path: Option<String>,
    /// 実行するアクションのセット名（action_set_path から解析して補完）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_set: Option<String>,
    /// 実行するアクション名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_name: Option<String>,
}

fn default_jpeg_quality() -> u8 {
    12
}
fn default_intent() -> String {
    "relative".to_string()
}
fn default_bpc() -> bool {
    true
}
fn default_dither() -> bool {
    true
}
fn default_max_pixels() -> u64 {
    crate::epub::APPLE_BOOKS_MAX_INTERNAL_IMAGE_PIXELS
}

impl Default for SrgbGlobalSettings {
    fn default() -> Self {
        Self {
            jpeg_quality: default_jpeg_quality(),
            intent: default_intent(),
            black_point_compensation: default_bpc(),
            dither: default_dither(),
            max_pixels: default_max_pixels(),
            run_action: false,
            action_set_path: None,
            action_set: None,
            action_name: None,
        }
    }
}

/// 変換設定全体
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SrgbConvertConfig {
    pub files: Vec<SrgbConvertFile>,
    #[serde(default)]
    pub global_settings: SrgbGlobalSettings,
}

/// 個別変換結果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SrgbConvertResult {
    pub file_name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SrgbResultsWrapper {
    results: Vec<SrgbConvertResult>,
}

/// 変換レスポンス（NativeJpegResponse と同形）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SrgbConvertResponse {
    pub results: Vec<SrgbConvertResult>,
    pub output_dir: String,
}

/// Photoshop を使用して画像を sRGB へプロファイル変換し JPEG 出力
#[tauri::command]
pub async fn run_photoshop_srgb_convert(
    app_handle: tauri::AppHandle,
    config: SrgbConvertConfig,
    output_dir: String,
) -> Result<SrgbConvertResponse, String> {
    // セキュリティ: 出力先・全入力・アクション(.atn)パスを許可リストゲート（保護領域/トラバーサル拒否）。
    let _ = crate::security::grant_user_path(&output_dir);
    crate::security::ensure_write_path(&output_dir)?;
    for f in &config.files {
        let _ = crate::security::grant_user_path(&f.path);
        if std::path::Path::new(&f.path).exists() {
            crate::security::ensure_read_path(&f.path)?;
        }
    }
    if let Some(atn) = config.global_settings.action_set_path.as_deref() {
        if !atn.is_empty() && std::path::Path::new(atn).exists() {
            let _ = crate::security::grant_user_path(atn);
            crate::security::ensure_read_path(atn)?;
        }
    }

    let ps_path = find_photoshop_path().ok_or_else(|| {
        "Photoshopが見つかりません。Adobe Photoshopをインストールしてください。".to_string()
    })?;

    let script_path_str = find_script_path(&app_handle, "srgb_convert.jsx", "sRGB Convert")?;

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("daidori_srgb_settings.json");
    let output_path = temp_dir.join("daidori_srgb_results.json");
    let progress_path = temp_dir.join("daidori_srgb_progress.txt");

    // 既存の結果・進捗ファイルを削除
    let _ = fs::remove_file(&output_path);
    let _ = fs::remove_file(&progress_path);

    // 出力ディレクトリ: 既存の場合は連番で新規作成
    let final_output_dir = create_unique_output_dir(&output_dir, "sRGB Convert")?;

    // 各ファイルの出力先を最終出力ディレクトリに統一
    let mut config_with_output = config;
    for file_config in &mut config_with_output.files {
        file_config.output_path = final_output_dir.clone();
    }

    // アクションセット(.atn)が指定されていれば、ヘッダからセット名を解析して action_set に補完。
    // 解析失敗時はファイル名（拡張子なし）でフォールバック（tiff.rs と同じ仕組みを再利用）。
    if config_with_output.global_settings.run_action {
        if let Some(atn_path) = config_with_output.global_settings.action_set_path.clone() {
            if !atn_path.is_empty() {
                let set_name = super::tiff::parse_atn_set_name(&atn_path)
                    .or_else(|| super::tiff::filename_stem(&atn_path));
                eprintln!(
                    "sRGB Convert - Action set '.atn': {} -> set name: {:?}",
                    atn_path, set_name
                );
                config_with_output.global_settings.action_set = set_name;
            }
        }
    }

    // 設定ファイルを書き込み（UTF-8 BOM付き）
    write_settings_json(&settings_path, &config_with_output)?;

    // スクリプトをtempにコピー（UTF-8 BOM付き）
    let temp_script = copy_script_with_bom(&script_path_str, "daidori_srgb_convert_temp.jsx")?;
    let script_to_run = get_script_run_path(&temp_script);

    eprintln!("sRGB Convert - Photoshop: {}", ps_path);
    eprintln!("sRGB Convert - Script: {}", script_to_run);

    // Photoshopを起動してスクリプトを実行
    let _child = Command::new(&ps_path)
        .args(["-r", &script_to_run])
        .spawn()
        .map_err(|e| format!("Photoshopの起動に失敗: {}", e))?;

    eprintln!("sRGB Convert - Launched: {} -r {}", ps_path, script_to_run);

    // 結果をポーリング（ハートビートベース。tiff.rs と同方式）
    let file_count = config_with_output.files.len().max(1);
    let poll_interval_ms: u64 = 500;
    let initial_timeout_secs: u64 = 600; // 10分（PS起動 + 最初のファイル）
    let final_timeout_secs: u64 = 120; // 2分（最後のファイル後）
    let mut last_progress = String::new();
    let mut polls_since_progress: u64 = 0;
    let mut all_done = false;

    eprintln!(
        "sRGB Convert - Heartbeat: {}s initial, no timeout during processing, {} files",
        initial_timeout_secs, file_count
    );

    loop {
        // 結果ファイルをチェック
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('{') && content.contains("results") {
                    eprintln!("sRGB Convert output ready");
                    break;
                }
            }
        }

        // 進捗ファイルをチェック（"X/N"形式）
        if let Ok(content) = fs::read_to_string(&progress_path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() && trimmed != last_progress {
                eprintln!("sRGB Convert progress: {}", trimmed);
                last_progress = trimmed.clone();
                polls_since_progress = 0;
                if let Some((current, total)) = trimmed.split_once('/') {
                    if let (Ok(c), Ok(t)) = (current.parse::<u64>(), total.parse::<u64>()) {
                        all_done = c >= t && t > 0;
                        // ハートビートをEPUBウィザードの進捗表示へリレー（X/N表示）
                        let _ = app_handle.emit(
                            "epub-progress",
                            serde_json::json!({
                                "phase": "psd-to-jpeg",
                                "current": c,
                                "total": t,
                            }),
                        );
                    }
                }
            }
        }

        polls_since_progress += 1;

        let timeout_polls = if last_progress.is_empty() {
            (initial_timeout_secs * 1000) / poll_interval_ms
        } else if all_done {
            (final_timeout_secs * 1000) / poll_interval_ms
        } else {
            (1800 * 1000) / poll_interval_ms // 処理中は最大30分
        };

        if polls_since_progress >= timeout_polls {
            if last_progress.is_empty() {
                eprintln!(
                    "sRGB Convert timed out (Photoshopからの応答なし: {}秒)",
                    initial_timeout_secs
                );
            } else {
                eprintln!("sRGB Convert timed out (結果ファイルが書き込まれませんでした)");
            }
            break;
        }

        tokio::time::sleep(std::time::Duration::from_millis(poll_interval_ms)).await;

        if polls_since_progress > 0 && polls_since_progress.is_multiple_of(60) {
            eprintln!(
                "Still waiting for Photoshop sRGB convert... ({}s since last progress, {})",
                polls_since_progress * poll_interval_ms / 1000,
                if last_progress.is_empty() {
                    "waiting for start"
                } else {
                    &last_progress
                }
            );
        }
    }

    let _ = fs::remove_file(&progress_path);

    // 結果を読み取り
    if output_path.exists() {
        let results_json =
            fs::read_to_string(&output_path).map_err(|e| format!("結果の読み取りに失敗: {}", e))?;

        let wrapper: SrgbResultsWrapper = serde_json::from_str(&results_json)
            .map_err(|e| format!("結果のパースに失敗: {}. JSON: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&temp_script);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(SrgbConvertResponse {
            results: wrapper.results,
            output_dir: final_output_dir,
        })
    } else {
        let _ = fs::remove_file(&temp_script);
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err(
            "Photoshopが出力ファイルを生成しませんでした。スクリプトが失敗した可能性があります。"
                .to_string(),
        )
    }
}
