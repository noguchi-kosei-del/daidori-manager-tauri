//! Photoshop不要のネイティブJPEG変換コマンド
//! Tachimi 由来の native_jpeg モジュールを使い、PSD/JPEG/PNG/TIFF を
//! 断ち切り・リサイズ適用のうえ MozJPEG で JPEG 出力する。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::native_jpeg::{process_single_image, ProcessOptions};

use super::photoshop::create_unique_output_dir;

/// 変換対象ファイル1件分の設定
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeJpegFile {
    /// 入力ファイルパス
    pub path: String,
    /// 出力ディレクトリ（output_dir と同一。互換のため受け取るが dest 計算には未使用）
    #[serde(default)]
    #[allow(dead_code)]
    pub output_path: String,
    /// 出力ファイル名（例 "0001.jpg"）
    pub output_name: String,
    /// 断ち切り・リサイズ・品質設定（cover/body/本文ごとに別値）
    pub options: ProcessOptions,
}

/// 変換設定全体
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeJpegConfig {
    pub files: Vec<NativeJpegFile>,
}

/// 個別変換結果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeJpegResult {
    pub file_name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 変換レスポンス（既存 JpegConvertResponse と同形）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeJpegResponse {
    pub results: Vec<NativeJpegResult>,
    pub output_dir: String,
}

/// 進捗イベントペイロード
#[derive(Debug, Clone, Serialize)]
struct JpegConvertProgress {
    phase: String,
    current: usize,
    total: usize,
}

fn emit_progress(app_handle: &tauri::AppHandle, phase: &str, current: usize, total: usize) {
    let _ = app_handle.emit(
        "jpeg-convert-progress",
        JpegConvertProgress {
            phase: phase.to_string(),
            current,
            total,
        },
    );
}

/// PSD/JPEG/PNG/TIFF を MozJPEG で JPEG 化（断ち切り・リサイズ適用）
#[tauri::command]
pub async fn run_native_jpeg_convert(
    app_handle: tauri::AppHandle,
    config: NativeJpegConfig,
    output_dir: String,
) -> Result<NativeJpegResponse, String> {
    // 出力ディレクトリ: 既存の場合は連番で新規作成
    let final_output_dir = create_unique_output_dir(&output_dir, "Native JPEG")?;
    let out_base = PathBuf::from(&final_output_dir);

    let total = config.files.len();
    if total == 0 {
        return Ok(NativeJpegResponse {
            results: Vec::new(),
            output_dir: final_output_dir,
        });
    }

    emit_progress(&app_handle, "images", 0, total);

    let app_for_task = app_handle.clone();
    let files = config.files;

    let results = tokio::task::spawn_blocking(move || {
        let done = AtomicUsize::new(0);

        let mut results: Vec<(usize, NativeJpegResult)> = files
            .par_iter()
            .enumerate()
            .map(|(idx, file)| {
                let input = Path::new(&file.path);
                let dest = out_base.join(&file.output_name);

                let result = if !input.exists() {
                    NativeJpegResult {
                        file_name: file.output_name.clone(),
                        success: false,
                        output_path: None,
                        error: Some(format!("入力ファイルが存在しません: {}", file.path)),
                    }
                } else {
                    match process_single_image(input, &dest, &file.options) {
                        Ok(()) => NativeJpegResult {
                            file_name: file.output_name.clone(),
                            success: true,
                            output_path: Some(dest.to_string_lossy().to_string()),
                            error: None,
                        },
                        Err(e) => NativeJpegResult {
                            file_name: file.output_name.clone(),
                            success: false,
                            output_path: None,
                            error: Some(e),
                        },
                    }
                };

                let completed = done.fetch_add(1, Ordering::SeqCst) + 1;
                emit_progress(&app_for_task, "images", completed, total);

                (idx, result)
            })
            .collect();

        // 入力順に並べ替えて返す
        results.sort_by_key(|(idx, _)| *idx);
        results
            .into_iter()
            .map(|(_, r)| r)
            .collect::<Vec<NativeJpegResult>>()
    })
    .await
    .map_err(|e| format!("変換タスクエラー: {}", e))?;

    emit_progress(&app_handle, "done", total, total);

    // ウィンドウを前面に復帰
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_focus();
    }

    Ok(NativeJpegResponse {
        results,
        output_dir: final_output_dir,
    })
}
