use std::fs;
use std::path::{Path, PathBuf};
use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;
use crate::types::ExportPage;
use crate::image_utils::validate_dimensions;

// 画像のサイズを取得
fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let (width, height) = if ext == "psd" {
        let data = fs::read(path).map_err(|e| e.to_string())?;
        let psd = psd::Psd::from_bytes(&data)
            .map_err(|e| format!("PSD読み込みエラー: {:?}", e))?;
        (psd.width(), psd.height())
    } else {
        let img = image::open(path).map_err(|e| e.to_string())?;
        (img.width(), img.height())
    };

    // 画像サイズ検証（DoS防止）
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

    // 白い画像を生成
    let img = image::RgbImage::from_pixel(width, height, image::Rgb([255, 255, 255]));
    let dynamic_img = DynamicImage::ImageRgb8(img);

    match ext.as_str() {
        "jpg" | "jpeg" => {
            let mut file = fs::File::create(output_path).map_err(|e| e.to_string())?;
            let encoder = JpegEncoder::new_with_quality(&mut file, 95);
            dynamic_img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
        }
        "png" => {
            dynamic_img.save(output_path).map_err(|e| e.to_string())?;
        }
        "tif" | "tiff" => {
            dynamic_img.save(output_path).map_err(|e| e.to_string())?;
        }
        _ => {
            // デフォルトはPNG
            dynamic_img.save(output_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
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
    let output_dir = Path::new(&output_path);

    if !output_dir.exists() {
        fs::create_dir_all(output_dir).map_err(|e| e.to_string())?;
    }

    // サブフォルダを事前に作成
    let mut created_subfolders = std::collections::HashSet::new();
    for page in &pages {
        if let Some(ref subfolder) = page.subfolder {
            if !created_subfolders.contains(subfolder) {
                let subfolder_path = output_dir.join(subfolder);
                if !subfolder_path.exists() {
                    fs::create_dir_all(&subfolder_path).map_err(|e| e.to_string())?;
                }
                created_subfolders.insert(subfolder.clone());
            }
        }
    }

    // 出力先ディレクトリを取得するヘルパー
    let get_output_dir = |page: &ExportPage| -> PathBuf {
        if let Some(ref subfolder) = page.subfolder {
            output_dir.join(subfolder)
        } else {
            output_dir.to_path_buf()
        }
    };

    // まず、ファイルがあるページからサイズと拡張子を取得
    let mut reference_size: Option<(u32, u32)> = None;
    let mut reference_ext = "png".to_string();

    for page in &pages {
        if let Some(ref source_path) = page.source_path {
            let source = Path::new(source_path);
            if source.exists() {
                if reference_size.is_none() {
                    if let Ok(dims) = get_image_dimensions(source) {
                        reference_size = Some(dims);
                    }
                }
                if let Some(ext) = source.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    // PSDは出力形式として使わない（PNG or JPEGに変換）
                    if ext_lower != "psd" {
                        reference_ext = ext_lower;
                    }
                }
                break;
            }
        }
    }

    // デフォルトサイズ（参照ページがない場合）
    let default_size = reference_size.unwrap_or((1654, 2339)); // A5 350dpi

    let mut exported = 0;

    for (i, page) in pages.iter().enumerate() {
        let page_output_dir = get_output_dir(page);

        match page.page_type.as_str() {
            "file" | "cover" | "colophon" => {
                // ファイルがあるページはコピーまたは移動（オプションでJPG変換）
                if let Some(ref source_path) = page.source_path {
                    let source = Path::new(source_path);
                    if source.exists() {
                        let source_ext = source
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("png")
                            .to_lowercase();

                        if should_convert {
                            // JPGに変換して出力
                            let output_file = page_output_dir.join(format!("{}.jpg", page.output_name));

                            // PSDファイルは変換できないのでスキップ
                            if source_ext == "psd" {
                                continue;
                            }

                            // 画像を読み込んで変換
                            let img = image::open(source).map_err(|e| e.to_string())?;
                            let mut file = fs::File::create(&output_file).map_err(|e| e.to_string())?;
                            let encoder = JpegEncoder::new_with_quality(&mut file, quality);
                            img.write_with_encoder(encoder).map_err(|e| e.to_string())?;

                            // 移動モードの場合は元ファイルを削除
                            if should_move {
                                fs::remove_file(source).map_err(|e| e.to_string())?;
                            }
                        } else {
                            // そのままコピーまたは移動
                            let output_file = page_output_dir.join(format!("{}.{}", page.output_name, source_ext));
                            if should_move {
                                fs::rename(source, &output_file).map_err(|e| e.to_string())?;
                            } else {
                                fs::copy(source, &output_file).map_err(|e| e.to_string())?;
                            }
                        }
                        exported += 1;
                    }
                }
            }
            "blank" => {
                // 白紙ページ: 前後のページからサイズと拡張子を取得
                let mut size = default_size;
                let mut ext = reference_ext.clone();

                // 前のページからサイズを取得
                for j in (0..i).rev() {
                    if let Some(ref prev_path) = pages[j].source_path {
                        let prev_source = Path::new(prev_path);
                        if prev_source.exists() {
                            if let Ok(dims) = get_image_dimensions(prev_source) {
                                size = dims;
                            }
                            if let Some(e) = prev_source.extension().and_then(|e| e.to_str()) {
                                let e_lower = e.to_lowercase();
                                if e_lower != "psd" {
                                    ext = e_lower;
                                }
                            }
                            break;
                        }
                    }
                }

                // 後のページからも確認（前がなければ）
                if size == default_size {
                    for j in (i + 1)..pages.len() {
                        if let Some(ref next_path) = pages[j].source_path {
                            let next_source = Path::new(next_path);
                            if next_source.exists() {
                                if let Ok(dims) = get_image_dimensions(next_source) {
                                    size = dims;
                                }
                                if let Some(e) = next_source.extension().and_then(|e| e.to_str()) {
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

                // JPG変換モードの場合はJPGで白紙を生成
                let final_ext = if should_convert { "jpg".to_string() } else { ext };
                let output_file = page_output_dir.join(format!("{}.{}", page.output_name, final_ext));
                if should_convert {
                    // JPGで白紙を生成
                    let img = image::RgbImage::from_pixel(size.0, size.1, image::Rgb([255, 255, 255]));
                    let dynamic_img = DynamicImage::ImageRgb8(img);
                    let mut file = fs::File::create(&output_file).map_err(|e| e.to_string())?;
                    let encoder = JpegEncoder::new_with_quality(&mut file, quality);
                    dynamic_img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
                } else {
                    create_blank_image(size.0, size.1, &output_file)?;
                }
                exported += 1;
            }
            "intermission" => {
                // 幕間: ファイルがあればコピーまたは移動
                if let Some(ref source_path) = page.source_path {
                    let source = Path::new(source_path);
                    if source.exists() {
                        let source_ext = source
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("png")
                            .to_lowercase();

                        if should_convert {
                            // JPGに変換して出力
                            let output_file = page_output_dir.join(format!("{}.jpg", page.output_name));

                            if source_ext == "psd" {
                                continue;
                            }

                            let img = image::open(source).map_err(|e| e.to_string())?;
                            let mut file = fs::File::create(&output_file).map_err(|e| e.to_string())?;
                            let encoder = JpegEncoder::new_with_quality(&mut file, quality);
                            img.write_with_encoder(encoder).map_err(|e| e.to_string())?;

                            if should_move {
                                fs::remove_file(source).map_err(|e| e.to_string())?;
                            }
                        } else {
                            let output_file = page_output_dir.join(format!("{}.{}", page.output_name, source_ext));
                            if should_move {
                                fs::rename(source, &output_file).map_err(|e| e.to_string())?;
                            } else {
                                fs::copy(source, &output_file).map_err(|e| e.to_string())?;
                            }
                        }
                        exported += 1;
                    }
                }
            }
            _ => {}
        }
    }

    Ok(exported)
}
