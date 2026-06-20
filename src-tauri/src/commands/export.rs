use crate::image_utils::validate_dimensions;
use crate::types::ExportPage;
use image::codecs::jpeg::JpegEncoder;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// PSDヘッダからサイズを取得（先頭26バイトのみ読み取り）
fn get_psd_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut header = [0u8; 26];
    file.read_exact(&mut header)
        .map_err(|e| format!("PSDヘッダ読み取りエラー: {}", e))?;
    if &header[0..4] != b"8BPS" {
        return Err("無効なPSDファイル".to_string());
    }
    let height = u32::from_be_bytes([header[14], header[15], header[16], header[17]]);
    let width = u32::from_be_bytes([header[18], header[19], header[20], header[21]]);
    Ok((width, height))
}

// 画像のサイズを取得（ヘッダのみ読み取り、画像デコード不要）
fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let (width, height) = if ext == "psd" {
        get_psd_dimensions(path)?
    } else {
        image::image_dimensions(path).map_err(|e| e.to_string())?
    };

    validate_dimensions(width, height)?;
    Ok((width, height))
}

// エクスポートタスク（並列実行用）
enum ExportTask {
    CopyFile {
        source: PathBuf,
        dest: PathBuf,
    },
    ConvertToJpg {
        source: PathBuf,
        dest: PathBuf,
        quality: u8,
    },
    // 白紙ページは固定仕様（1280×1818 / 600ppi / モノクロ）で生成する。
    GenerateFixedBlank {
        dest: PathBuf,
    },
}

#[tauri::command]
pub async fn export_pages(
    output_path: String,
    pages: Vec<ExportPage>,
    move_files: Option<bool>,
    convert_to_jpg: Option<bool>,
    jpg_quality: Option<u8>,
    blank_format: Option<String>,
) -> Result<usize, String> {
    // 出力先（ダイアログ由来）を許可リストへ → 書込検証（任意の場所への書き出しを防ぐ）
    if let Some(parent) = std::path::Path::new(&output_path).parent() {
        let _ = crate::security::grant_user_path(parent);
    }
    crate::security::ensure_write_path(&output_path)?;

    let should_move = move_files.unwrap_or(false);
    let should_convert = convert_to_jpg.unwrap_or(false);
    let quality = jpg_quality.unwrap_or(95);
    let blank_fmt = blank_format.map(|s| s.to_lowercase());

    // spawn_blockingで同期I/Oをオフロード（UIスレッドをブロックしない）
    tokio::task::spawn_blocking(move || {
        export_pages_sync(
            &output_path,
            &pages,
            should_move,
            should_convert,
            quality,
            blank_fmt.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))?
}

fn export_pages_sync(
    output_path: &str,
    pages: &[ExportPage],
    should_move: bool,
    should_convert: bool,
    quality: u8,
    blank_format: Option<&str>,
) -> Result<usize, String> {
    let output_dir = Path::new(output_path);

    if !output_dir.exists() {
        fs::create_dir_all(output_dir).map_err(|e| e.to_string())?;
    }

    // サブフォルダを事前に作成
    let mut created_subfolders = std::collections::HashSet::new();
    for page in pages {
        if let Some(ref subfolder) = page.subfolder {
            if created_subfolders.insert(subfolder.clone()) {
                let subfolder_path = output_dir.join(subfolder);
                if !subfolder_path.exists() {
                    fs::create_dir_all(&subfolder_path).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    let get_output_dir = |page: &ExportPage| -> PathBuf {
        if let Some(ref subfolder) = page.subfolder {
            output_dir.join(subfolder)
        } else {
            output_dir.to_path_buf()
        }
    };

    // フェーズ1: サイズキャッシュを事前構築（ヘッダのみ読み取りで高速）
    let mut dim_cache: HashMap<String, (u32, u32)> = HashMap::new();
    let mut reference_ext = "png".to_string();

    for page in pages {
        if let Some(ref source_path) = page.source_path {
            let source = Path::new(source_path);
            if source.exists() {
                if let Ok(dims) = get_image_dimensions(source) {
                    dim_cache.insert(source_path.clone(), dims);
                }
                if let Some(ext) = source.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    if ext_lower != "psd" {
                        reference_ext = ext_lower;
                    }
                }
            }
        }
    }

    // フェーズ2: エクスポートタスクを収集（逐次、計算のみ）
    let mut tasks: Vec<ExportTask> = Vec::with_capacity(pages.len());
    let mut move_sources: Vec<PathBuf> = Vec::new();

    for (i, page) in pages.iter().enumerate() {
        let page_output_dir = get_output_dir(page);

        match page.page_type.as_str() {
            "file" | "cover" | "colophon" | "intermission" => {
                if let Some(ref source_path) = page.source_path {
                    let source = Path::new(source_path);
                    if source.exists() {
                        let source_ext = source
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("png")
                            .to_lowercase();

                        if should_convert {
                            if source_ext == "psd" {
                                continue;
                            }
                            let dest = page_output_dir.join(format!("{}.jpg", page.output_name));
                            tasks.push(ExportTask::ConvertToJpg {
                                source: source.to_path_buf(),
                                dest,
                                quality,
                            });
                        } else {
                            let dest = page_output_dir
                                .join(format!("{}.{}", page.output_name, source_ext));
                            tasks.push(ExportTask::CopyFile {
                                source: source.to_path_buf(),
                                dest,
                            });
                        }

                        if should_move {
                            move_sources.push(source.to_path_buf());
                        }
                    }
                }
            }
            "blank" => {
                // 白紙ページのサイズは固定（1280×1818 / 600ppi / モノクロ）なので
                // 隣接ページのサイズは参照しない。出力拡張子のみ隣接ページから決める。
                let mut ext = reference_ext.clone();
                let mut found = false;

                // 前のページから
                for j in (0..i).rev() {
                    if let Some(ref prev_path) = pages[j].source_path {
                        if dim_cache.contains_key(prev_path) {
                            if let Some(e) = Path::new(prev_path).extension().and_then(|e| e.to_str())
                            {
                                let e_lower = e.to_lowercase();
                                if e_lower != "psd" {
                                    ext = e_lower;
                                }
                            }
                            found = true;
                            break;
                        }
                    }
                }

                // 後のページから（前がなければ）
                if !found {
                    for next_page in &pages[i + 1..] {
                        if let Some(ref next_path) = next_page.source_path {
                            if dim_cache.contains_key(next_path) {
                                if let Some(e) =
                                    Path::new(next_path).extension().and_then(|e| e.to_str())
                                {
                                    let e_lower = e.to_lowercase();
                                    if e_lower != "psd" {
                                        ext = e_lower;
                                    }
                                }
                                break;
                            }
                        }
                    }
                }

                // 白紙の出力形式: blank_format指定 > JPG変換フラグ > 隣接ページのext
                let final_ext = if let Some(fmt) = blank_format {
                    fmt.to_string()
                } else if should_convert {
                    "jpg".to_string()
                } else {
                    ext
                };
                let dest = page_output_dir.join(format!("{}.{}", page.output_name, final_ext));
                tasks.push(ExportTask::GenerateFixedBlank { dest });
            }
            _ => {}
        }
    }

    let task_count = tasks.len();

    // フェーズ3: rayon並列実行
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    tasks.par_iter().for_each(|task| {
        let result = match task {
            ExportTask::CopyFile { source, dest } => fs::copy(source, dest)
                .map(|_| ())
                .map_err(|e| e.to_string()),
            ExportTask::ConvertToJpg {
                source,
                dest,
                quality,
            } => (|| {
                let img = image::open(source).map_err(|e| e.to_string())?;
                let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
                let encoder = JpegEncoder::new_with_quality(&mut file, *quality);
                img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
                Ok(())
            })(),
            ExportTask::GenerateFixedBlank { dest } => crate::blank_page::generate_blank(dest),
        };
        if let Err(e) = result {
            errors.lock().unwrap().push(e);
        }
    });

    let errs = errors.into_inner().unwrap();
    if !errs.is_empty() {
        return Err(format!("エクスポートエラー: {}", errs.join(", ")));
    }

    // moveモード: 全エクスポート成功後に元ファイルを削除
    for source_path in &move_sources {
        let _ = fs::remove_file(source_path);
    }

    Ok(task_count)
}
