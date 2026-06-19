//! Photoshop不要のネイティブJPEG変換コマンド
//! Tachimi 由来の native_jpeg モジュールを使い、PSD/JPEG/PNG/TIFF を
//! 断ち切り・リサイズ適用のうえ MozJPEG で JPEG 出力する。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::native_jpeg::{process_image_to_rgb, save_processed_rgb, ProcessOptions};

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
    /// 追加出力先（絶対パス）。1回のデコードから別形式も書き出す（拡張子で TIFF/JPEG 判定）。
    /// 例: TIFF併産時に EPUB用 JPEG を同時生成する用途。
    #[serde(default)]
    pub extra_outputs: Vec<String>,
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
    // セキュリティ: 出力先・全入力パスを許可リストゲートに通す（保護領域/トラバーサルを拒否）。
    let _ = crate::security::grant_user_path(&output_dir);
    crate::security::ensure_write_path(&output_dir)?;
    for f in &config.files {
        let _ = crate::security::grant_user_path(&f.path);
        if Path::new(&f.path).exists() {
            crate::security::ensure_read_path(&f.path)?;
        }
        // 追加出力先（別形式の同時書き出し）も許可リストへ
        for ex in &f.extra_outputs {
            let _ = crate::security::grant_user_path(ex);
        }
    }

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
                // output_name に分割サブフォルダ（例 "01/0001.jpg"）が含まれる場合に備えて親を作成
                if let Some(parent) = dest.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                let result = if !input.exists() {
                    NativeJpegResult {
                        file_name: file.output_name.clone(),
                        success: false,
                        output_path: None,
                        error: Some(format!("入力ファイルが存在しません: {}", file.path)),
                    }
                } else {
                    // 1回のデコードから主出力＋追加出力（別形式）を書き出す
                    match process_image_to_rgb(input, &file.options) {
                        Ok(rgb) => {
                            let mut write_res = save_processed_rgb(&rgb, &file.options, &dest);
                            if write_res.is_ok() {
                                for extra in &file.extra_outputs {
                                    let ep = Path::new(extra);
                                    if let Some(parent) = ep.parent() {
                                        let _ = std::fs::create_dir_all(parent);
                                    }
                                    if let Err(e) = save_processed_rgb(&rgb, &file.options, ep) {
                                        write_res = Err(e);
                                        break;
                                    }
                                }
                            }
                            match write_res {
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
                        }
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
