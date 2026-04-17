use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;
use rayon::prelude::*;
use crate::types::ExportPage;
use crate::image_utils::validate_dimensions;

// PSDヘッダからサイズを取得（先頭26バイトのみ読み取り）
fn get_psd_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut header = [0u8; 26];
    file.read_exact(&mut header).map_err(|e| format!("PSDヘッダ読み取りエラー: {}", e))?;
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

// 白紙画像を生成
fn create_blank_image(width: u32, height: u32, output_path: &Path) -> Result<(), String> {
    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let img = image::RgbImage::from_pixel(width, height, image::Rgb([255, 255, 255]));
    let dynamic_img = DynamicImage::ImageRgb8(img);

    match ext.as_str() {
        "jpg" | "jpeg" => {
            let mut file = fs::File::create(output_path).map_err(|e| e.to_string())?;
            let encoder = JpegEncoder::new_with_quality(&mut file, 95);
            dynamic_img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
        }
        _ => {
            dynamic_img.save(output_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// エクスポートタスク（並列実行用）
enum ExportTask {
    CopyFile { source: PathBuf, dest: PathBuf },
    ConvertToJpg { source: PathBuf, dest: PathBuf, quality: u8 },
    GenerateBlank { width: u32, height: u32, dest: PathBuf },
    GenerateBlankJpg { width: u32, height: u32, dest: PathBuf, quality: u8 },
}

#[tauri::command]
pub async fn export_pages(
    output_path: String,
    pages: Vec<ExportPage>,
    move_files: Option<bool>,
    convert_to_jpg: Option<bool>,
    jpg_quality: Option<u8>,
) -> Result<usize, String> {
    let should_move = move_files.unwrap_or(false);
    let should_convert = convert_to_jpg.unwrap_or(false);
    let quality = jpg_quality.unwrap_or(95);

    // spawn_blockingで同期I/Oをオフロード（UIスレッドをブロックしない）
    tokio::task::spawn_blocking(move || {
        export_pages_sync(&output_path, &pages, should_move, should_convert, quality)
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

    let reference_size = dim_cache.values().next().copied();
    let default_size = reference_size.unwrap_or((1654, 2339)); // A5 350dpi

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
                            let dest = page_output_dir.join(format!("{}.{}", page.output_name, source_ext));
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
                // キャッシュからサイズを取得（前後のページを探索）
                let mut size = default_size;
                let mut ext = reference_ext.clone();

                // 前のページから
                for j in (0..i).rev() {
                    if let Some(ref prev_path) = pages[j].source_path {
                        if let Some(&dims) = dim_cache.get(prev_path) {
                            size = dims;
                            let prev_source = Path::new(prev_path);
                            if let Some(e) = prev_source.extension().and_then(|e| e.to_str()) {
                                let e_lower = e.to_lowercase();
                                if e_lower != "psd" { ext = e_lower; }
                            }
                            break;
                        }
                    }
                }

                // 後のページから（前がなければ）
                if size == default_size {
                    for next_page in &pages[i + 1..] {
                        if let Some(ref next_path) = next_page.source_path {
                            if let Some(&dims) = dim_cache.get(next_path) {
                                size = dims;
                                let next_source = Path::new(next_path);
                                if let Some(e) = next_source.extension().and_then(|e| e.to_str()) {
                                    let e_lower = e.to_lowercase();
                                    if e_lower != "psd" { ext = e_lower; }
                                }
                                break;
                            }
                        }
                    }
                }

                let final_ext = if should_convert { "jpg".to_string() } else { ext };
                let dest = page_output_dir.join(format!("{}.{}", page.output_name, final_ext));

                if should_convert {
                    tasks.push(ExportTask::GenerateBlankJpg { width: size.0, height: size.1, dest, quality });
                } else {
                    tasks.push(ExportTask::GenerateBlank { width: size.0, height: size.1, dest });
                }
            }
            _ => {}
        }
    }

    let task_count = tasks.len();

    // フェーズ3: rayon並列実行
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    tasks.par_iter().for_each(|task| {
        let result = match task {
            ExportTask::CopyFile { source, dest } => {
                fs::copy(source, dest).map(|_| ()).map_err(|e| e.to_string())
            }
            ExportTask::ConvertToJpg { source, dest, quality } => {
                (|| {
                    let img = image::open(source).map_err(|e| e.to_string())?;
                    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
                    let encoder = JpegEncoder::new_with_quality(&mut file, *quality);
                    img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
                    Ok(())
                })()
            }
            ExportTask::GenerateBlank { width, height, dest } => {
                create_blank_image(*width, *height, dest)
            }
            ExportTask::GenerateBlankJpg { width, height, dest, quality } => {
                (|| {
                    let img = image::RgbImage::from_pixel(*width, *height, image::Rgb([255, 255, 255]));
                    let dynamic_img = DynamicImage::ImageRgb8(img);
                    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
                    let encoder = JpegEncoder::new_with_quality(&mut file, *quality);
                    dynamic_img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
                    Ok(())
                })()
            }
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
