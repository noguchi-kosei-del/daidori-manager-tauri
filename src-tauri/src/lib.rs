use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use tauri::State;

// サムネイル設定（超高解像度版）
const THUMBNAIL_SIZE: u32 = 960;  // 超高DPIディスプレイ対応（240px×4倍）
const JPEG_QUALITY: u8 = 98;      // JPEG品質（最高画質）

// 画像サイズ制限（DoS防止）
const MAX_IMAGE_DIMENSION: u32 = 65535;      // 最大辺長
const MAX_PIXEL_COUNT: u64 = 100_000_000;    // 最大ピクセル数（100メガピクセル）

// サポートする拡張子
const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "psd", "tif", "tiff"];

// ファイル情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_time: u64,
    pub file_type: String,
}

// エクスポート用ページ情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPage {
    pub source_path: Option<String>,
    pub output_name: String,
    pub page_type: String,  // "file", "cover", "blank", "intermission", "colophon"
    pub subfolder: Option<String>,  // チャプターごとのサブフォルダ名
}

// ========== プロジェクトファイル関連 ==========

// ファイル参照情報（保存用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFileReference {
    pub absolute_path: String,
    pub relative_path: String,
    pub file_name: String,
    pub file_type: String,
    pub file_size: u64,
    pub modified_time: u64,
}

// 保存されるページ
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedPage {
    pub id: String,
    pub page_type: String,
    pub file: Option<SavedFileReference>,
    pub label: Option<String>,
}

// 保存されるチャプター
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedChapter {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub chapter_type: String,
    pub pages: Vec<SavedPage>,
    pub folder_path: Option<String>,
}

// 保存されるUI状態
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedUiState {
    pub selected_chapter_id: Option<String>,
    pub selected_page_id: Option<String>,
    pub view_mode: String,
    pub thumbnail_size: String,
    pub collapsed_chapter_ids: Vec<String>,
}

// プロジェクトファイル形式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFile {
    pub version: String,
    pub name: String,
    pub created_at: String,
    pub modified_at: String,
    pub base_path: String,
    pub chapters: Vec<SavedChapter>,
    pub ui_state: Option<SavedUiState>,
}

// ファイル検証結果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileValidationResult {
    pub page_id: String,
    pub status: String,  // "found", "missing", "moved", "modified"
    pub original_path: String,
    pub resolved_path: Option<String>,
    pub suggested_path: Option<String>,
}

// 最近使ったファイル
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub opened_at: String,
}

// サムネイルキャッシュディレクトリ
pub struct ThumbnailCache {
    pub cache_dir: PathBuf,
}

impl ThumbnailCache {
    pub fn new() -> Self {
        let cache_dir = dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("daidori-manager")
            .join("thumbnails");

        // キャッシュディレクトリ作成（エラー時はログ出力）
        if let Err(e) = fs::create_dir_all(&cache_dir) {
            eprintln!("キャッシュディレクトリ作成失敗: {} - {}", cache_dir.display(), e);
        }

        Self { cache_dir }
    }
}

// 画像サイズ検証（DoS防止）
fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("無効な画像サイズ: 幅または高さが0".to_string());
    }
    if width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION {
        return Err(format!(
            "画像サイズが大きすぎます: {}x{} (最大: {})",
            width, height, MAX_IMAGE_DIMENSION
        ));
    }
    let pixel_count = (width as u64) * (height as u64);
    if pixel_count > MAX_PIXEL_COUNT {
        return Err(format!(
            "ピクセル数が多すぎます: {} (最大: {})",
            pixel_count, MAX_PIXEL_COUNT
        ));
    }
    Ok(())
}

// ファイルタイプを取得
fn get_file_type(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "psd" => Some("psd"),
        "tif" | "tiff" => Some("tif"),
        _ => None,
    }
}

// 画像をサムネイルに変換（高画質・高速版）
fn create_thumbnail(img: DynamicImage) -> Result<Vec<u8>, String> {
    // CatmullRom: Triangle より高品質、Lanczos3 より高速（バランス良好）
    let thumbnail = img.resize(
        THUMBNAIL_SIZE,
        THUMBNAIL_SIZE * 14 / 10,
        FilterType::CatmullRom,
    );

    let mut buffer = Vec::new();
    {
        let mut encoder = JpegEncoder::new_with_quality(&mut buffer, JPEG_QUALITY);
        encoder
            .encode_image(&thumbnail)
            .map_err(|e| format!("サムネイル書き出しエラー: {}", e))?;
    }

    Ok(buffer)
}

// PSDファイルから埋め込みサムネイルを高速抽出
fn extract_psd_embedded_thumbnail(data: &[u8]) -> Option<Vec<u8>> {
    let mut cursor = Cursor::new(data);

    // PSDシグネチャ確認 "8BPS"
    let mut sig = [0u8; 4];
    cursor.read_exact(&mut sig).ok()?;
    if &sig != b"8BPS" {
        return None;
    }

    // バージョン (2bytes) + 予約 (6bytes) + チャンネル数 (2bytes) + 高さ (4bytes) + 幅 (4bytes) + 深度 (2bytes) + カラーモード (2bytes)
    cursor.seek(SeekFrom::Current(22)).ok()?;

    // カラーモードデータセクションをスキップ
    let mut len_buf = [0u8; 4];
    cursor.read_exact(&mut len_buf).ok()?;
    let color_mode_len = u32::from_be_bytes(len_buf);
    cursor.seek(SeekFrom::Current(color_mode_len as i64)).ok()?;

    // イメージリソースセクション
    cursor.read_exact(&mut len_buf).ok()?;
    let resources_len = u32::from_be_bytes(len_buf);
    let resources_end = cursor.position() + resources_len as u64;

    // リソースを検索
    while cursor.position() < resources_end {
        // 無限ループ防止: ループ開始位置を記録
        let loop_start_pos = cursor.position();

        // リソースシグネチャ "8BIM"
        let mut resource_sig = [0u8; 4];
        if cursor.read_exact(&mut resource_sig).is_err() {
            break;
        }
        if &resource_sig != b"8BIM" {
            break;
        }

        // リソースID (2bytes)
        let mut id_buf = [0u8; 2];
        cursor.read_exact(&mut id_buf).ok()?;
        let resource_id = u16::from_be_bytes(id_buf);

        // パスカル文字列（名前）をスキップ
        let mut name_len = [0u8; 1];
        cursor.read_exact(&mut name_len).ok()?;
        let skip_len = if name_len[0] % 2 == 0 { name_len[0] as i64 + 1 } else { name_len[0] as i64 };
        if cursor.seek(SeekFrom::Current(skip_len)).is_err() {
            break;
        }

        // リソースデータサイズ
        cursor.read_exact(&mut len_buf).ok()?;
        let resource_size = u32::from_be_bytes(len_buf);

        // サムネイルリソース (1036 = Photoshop 5.0+, 1033 = 旧バージョン)
        if resource_id == 1036 || resource_id == 1033 {
            // サムネイルリソースヘッダー (28bytes)
            // format(4) + width(4) + height(4) + widthbytes(4) + totalsize(4) + compressedsize(4) + bpp(2) + planes(2)
            let mut header = [0u8; 28];
            cursor.read_exact(&mut header).ok()?;

            let format = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);

            // format == 1 は JPEG
            if format == 1 {
                // 整数アンダーフロー防止: resource_sizeが28未満の場合はスキップ
                if resource_size < 28 {
                    return None;
                }
                let jpeg_size = resource_size as usize - 28;
                if jpeg_size == 0 {
                    return None;
                }
                let mut jpeg_data = vec![0u8; jpeg_size];
                cursor.read_exact(&mut jpeg_data).ok()?;
                return Some(jpeg_data);
            }
        }

        // 次のリソースへ（偶数バウンダリにアライン）
        let padded_size = if resource_size % 2 == 0 { resource_size } else { resource_size + 1 };
        if cursor.seek(SeekFrom::Current(padded_size as i64)).is_err() {
            break;
        }

        // 無限ループ防止: カーソルが進んでいることを確認
        if cursor.position() <= loop_start_pos {
            break;
        }
    }

    None
}

// PSDファイルからサムネイルを生成（高速版）
fn generate_psd_thumbnail(path: &Path) -> Result<Vec<u8>, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;

    // まず埋め込みサムネイルを試す（非常に高速）
    if let Some(jpeg_data) = extract_psd_embedded_thumbnail(&data) {
        // JPEGデータをデコードしてリサイズ
        let img = image::load_from_memory_with_format(&jpeg_data, ImageFormat::Jpeg)
            .map_err(|e| format!("サムネイル読み込みエラー: {}", e))?;
        return create_thumbnail(img);
    }

    // 埋め込みサムネイルがない場合は従来の方法（フルコンポジット）
    let psd_file = psd::Psd::from_bytes(&data)
        .map_err(|e| format!("PSD読み込みエラー: {:?}", e))?;

    let width = psd_file.width();
    let height = psd_file.height();

    // 画像サイズ検証（DoS防止）
    validate_dimensions(width, height)?;

    let rgba = psd_file.rgba();

    let img = DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(width, height, rgba)
            .ok_or("画像データの変換に失敗")?
    );

    create_thumbnail(img)
}

// 一般画像ファイルからサムネイルを生成
fn generate_image_thumbnail(path: &Path) -> Result<Vec<u8>, String> {
    let img = image::open(path)
        .map_err(|e| format!("画像読み込みエラー: {}", e))?;

    create_thumbnail(img)
}

// ===== Tauri Commands =====

#[tauri::command]
fn get_folder_contents(folder_path: String) -> Result<Vec<FileInfo>, String> {
    let path = Path::new(&folder_path);

    if !path.exists() || !path.is_dir() {
        return Err("無効なフォルダパス".to_string());
    }

    let mut files: Vec<FileInfo> = Vec::new();

    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry_result in entries {
        // ディレクトリエントリ読み込みエラーをログ出力
        let entry = match entry_result {
            Ok(e) => e,
            Err(e) => {
                eprintln!("ディレクトリエントリ読み込みエラー: {}", e);
                continue;
            }
        };
        let entry_path = entry.path();

        if !entry_path.is_file() {
            continue;
        }

        let ext = entry_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        if !SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
            continue;
        }

        let metadata = entry_path.metadata().map_err(|e| e.to_string())?;
        let file_type = get_file_type(ext).unwrap_or("unknown");

        let modified_time = metadata
            .modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
            .unwrap_or(0);

        files.push(FileInfo {
            path: entry_path.to_string_lossy().to_string(),
            name: entry_path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            size: metadata.len(),
            modified_time,
            file_type: file_type.to_string(),
        });
    }

    // ファイル名で自然順ソート
    files.sort_by(|a, b| natord::compare(&a.name, &b.name));

    Ok(files)
}

#[tauri::command]
async fn generate_thumbnail(
    file_path: String,
    modified_time: u64,
    cache: State<'_, ThumbnailCache>,
) -> Result<String, String> {
    let cache_dir = cache.cache_dir.clone();

    // 非同期タスクで重い処理を実行
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&file_path);

        if !path.exists() {
            return Err("ファイルが存在しません".to_string());
        }

        // キャッシュキーにサムネイル設定を含める（設定変更時に再生成される）
        let input = format!("{}:{}:{}:{}", file_path, modified_time, THUMBNAIL_SIZE, JPEG_QUALITY);
        let cache_key = format!("{:x}", md5::compute(input));

        // キャッシュチェック（TOCTOU対策: 直接読み込みを試行）
        let cached_path = cache_dir.join(format!("{}.jpg", cache_key));
        match fs::read(&cached_path) {
            Ok(data) => {
                let base64_data = BASE64.encode(&data);
                return Ok(format!("data:image/jpeg;base64,{}", base64_data));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // キャッシュミス - サムネイル生成へ進む
            }
            Err(e) => {
                // その他のエラー（権限等）はログ出力して生成へ進む
                eprintln!("キャッシュ読み込みエラー: {} - {}", cached_path.display(), e);
            }
        }

        // サムネイル生成
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let thumbnail_data = match ext.as_str() {
            "psd" => generate_psd_thumbnail(path)?,
            "tif" | "tiff" | "jpg" | "jpeg" | "png" => generate_image_thumbnail(path)?,
            _ => return Err(format!("サポートされていないファイル形式: {}", ext)),
        };

        // キャッシュに保存
        fs::write(&cached_path, &thumbnail_data).map_err(|e| e.to_string())?;

        // base64データURLとして返す
        let base64_data = BASE64.encode(&thumbnail_data);
        Ok(format!("data:image/jpeg;base64,{}", base64_data))
    })
    .await
    .map_err(|e| e.to_string())?
}

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
async fn export_pages(
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

                            // PSDファイルは変換できないのでスキップ（またはサムネイルがあれば使用）
                            if source_ext == "psd" {
                                // PSDはスキップ
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
                // 幕間: ファイルがあればコピーまたは移動（オプションでJPG変換）、なければスキップ
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

// ========== プロジェクトファイル関連コマンド ==========

// 設定ディレクトリを取得
fn get_config_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|p| p.join("daidori-manager"))
        .ok_or_else(|| "設定ディレクトリを特定できません".to_string())
}

// プロジェクトを保存
#[tauri::command]
async fn save_project(file_path: String, project: ProjectFile) -> Result<(), String> {
    let path = Path::new(&file_path);

    // 親ディレクトリが存在することを確認
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("ディレクトリ作成エラー: {}", e))?;
    }

    // JSONとしてシリアライズして書き込み
    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("JSONシリアライズエラー: {}", e))?;

    fs::write(path, json).map_err(|e| format!("ファイル書き込みエラー: {}", e))?;

    Ok(())
}

// プロジェクトを読み込み
#[tauri::command]
async fn load_project(file_path: String) -> Result<ProjectFile, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err("ファイルが見つかりません".to_string());
    }

    let content = fs::read_to_string(path).map_err(|e| format!("ファイル読み込みエラー: {}", e))?;
    let project: ProjectFile = serde_json::from_str(&content)
        .map_err(|e| format!("JSON解析エラー: {}", e))?;

    Ok(project)
}

// ファイル参照を検証
fn validate_file_reference(
    page_id: &str,
    file_ref: &SavedFileReference,
    base_path: &Path,
) -> FileValidationResult {
    let absolute = Path::new(&file_ref.absolute_path);
    let relative = base_path.join(&file_ref.relative_path);

    // まず絶対パスを試す
    if absolute.exists() {
        // ファイルが変更されているかチェック
        if let Ok(metadata) = fs::metadata(absolute) {
            let current_time = metadata
                .modified()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
                .unwrap_or(0);

            if current_time != file_ref.modified_time {
                return FileValidationResult {
                    page_id: page_id.to_string(),
                    status: "modified".to_string(),
                    original_path: file_ref.absolute_path.clone(),
                    resolved_path: Some(file_ref.absolute_path.clone()),
                    suggested_path: None,
                };
            }
        }

        return FileValidationResult {
            page_id: page_id.to_string(),
            status: "found".to_string(),
            original_path: file_ref.absolute_path.clone(),
            resolved_path: Some(file_ref.absolute_path.clone()),
            suggested_path: None,
        };
    }

    // 相対パスを試す
    if relative.exists() {
        return FileValidationResult {
            page_id: page_id.to_string(),
            status: "moved".to_string(),
            original_path: file_ref.absolute_path.clone(),
            resolved_path: Some(relative.to_string_lossy().to_string()),
            suggested_path: Some(relative.to_string_lossy().to_string()),
        };
    }

    // ファイルが見つからない
    FileValidationResult {
        page_id: page_id.to_string(),
        status: "missing".to_string(),
        original_path: file_ref.absolute_path.clone(),
        resolved_path: None,
        suggested_path: None,
    }
}

// プロジェクト内のファイル参照を検証
#[tauri::command]
async fn validate_project_files(
    project: ProjectFile,
    base_path: String,
) -> Result<Vec<FileValidationResult>, String> {
    let mut results = Vec::new();
    let base = Path::new(&base_path);

    for chapter in &project.chapters {
        for page in &chapter.pages {
            if let Some(ref file_ref) = page.file {
                let result = validate_file_reference(&page.id, file_ref, base);
                results.push(result);
            }
        }
    }

    Ok(results)
}

// 最近使ったファイル一覧を取得
#[tauri::command]
async fn get_recent_files() -> Result<Vec<RecentFile>, String> {
    let config_path = get_config_path()?;
    let recent_path = config_path.join("recent_files.json");

    if !recent_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&recent_path).map_err(|e| format!("読み込みエラー: {}", e))?;
    let recent: Vec<RecentFile> = serde_json::from_str(&content).unwrap_or_default();

    // 存在しないファイルをフィルタリング
    let valid: Vec<RecentFile> = recent
        .into_iter()
        .filter(|r| Path::new(&r.path).exists())
        .collect();

    Ok(valid)
}

// 最近使ったファイルに追加
#[tauri::command]
async fn add_recent_file(path: String, name: String) -> Result<(), String> {
    let config_path = get_config_path()?;
    let recent_path = config_path.join("recent_files.json");

    let mut recent = if recent_path.exists() {
        let content = fs::read_to_string(&recent_path).map_err(|e| format!("読み込みエラー: {}", e))?;
        serde_json::from_str::<Vec<RecentFile>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // 既に存在する場合は削除
    recent.retain(|r| r.path != path);

    // 先頭に追加
    recent.insert(0, RecentFile {
        path: path.clone(),
        name,
        opened_at: chrono::Utc::now().to_rfc3339(),
    });

    // 最大10件まで保持
    recent.truncate(10);

    // ディレクトリが存在することを確認
    fs::create_dir_all(&config_path).map_err(|e| format!("ディレクトリ作成エラー: {}", e))?;

    // 保存
    let json = serde_json::to_string_pretty(&recent).map_err(|e| format!("JSONシリアライズエラー: {}", e))?;
    fs::write(&recent_path, json).map_err(|e| format!("ファイル書き込みエラー: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ThumbnailCache::new())
        .invoke_handler(tauri::generate_handler![
            get_folder_contents,
            generate_thumbnail,
            export_pages,
            save_project,
            load_project,
            validate_project_files,
            get_recent_files,
            add_recent_file,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Tauriアプリケーション起動エラー: {}", e);
        std::process::exit(1);
    }
}
