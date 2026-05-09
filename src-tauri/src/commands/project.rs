use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::Path;
use rayon::prelude::*;
use crate::types::{ProjectFile, SavedFileReference, FileValidationResult, PageCheckInput, PageCheckResult};

// プロジェクトを保存（アトミック書き込み: 一時ファイル→リネーム）
#[tauri::command]
pub async fn save_project(file_path: String, project: ProjectFile) -> Result<(), String> {
    let path = Path::new(&file_path);

    // 親ディレクトリが存在することを確認
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("ディレクトリ作成エラー: {}", e))?;
    }

    // JSONとしてシリアライズ
    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("JSONシリアライズエラー: {}", e))?;

    // 一時ファイルに書き込み→sync→リネーム（クラッシュ時のデータ破損を防止）
    let temp_path = format!("{}.tmp", file_path);
    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("一時ファイル作成エラー: {}", e))?;
    file.write_all(json.as_bytes()).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("書き込みエラー: {}", e)
    })?;
    file.sync_all().map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("同期エラー: {}", e)
    })?;
    drop(file);
    fs::rename(&temp_path, path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("リネームエラー: {}", e)
    })?;

    Ok(())
}

// プロジェクトを読み込み
#[tauri::command]
pub async fn load_project(file_path: String) -> Result<ProjectFile, String> {
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

// PSDヘッダ(26バイト)からwidth/height/color_modeを抽出
struct PsdHeaderInfo {
    width: u32,
    height: u32,
    color_mode: String,
}

fn read_psd_header(path: &Path) -> Option<PsdHeaderInfo> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 26];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"8BPS" {
        return None;
    }
    let height = u32::from_be_bytes([header[14], header[15], header[16], header[17]]);
    let width = u32::from_be_bytes([header[18], header[19], header[20], header[21]]);
    let color_mode_id = u16::from_be_bytes([header[24], header[25]]);
    let color_mode = match color_mode_id {
        0 => "Bitmap",
        1 => "Grayscale",
        2 => "Indexed",
        3 => "RGB",
        4 => "CMYK",
        7 => "Multichannel",
        8 => "Duotone",
        9 => "Lab",
        _ => return None,
    };
    Some(PsdHeaderInfo {
        width,
        height,
        color_mode: color_mode.to_string(),
    })
}

// PSDのImage Resourcesセクションを走査してDPI(リソースID 1005)を取得
fn read_psd_dpi(path: &Path) -> Option<u32> {
    let data = fs::read(path).ok()?;
    let mut cursor = Cursor::new(&data);

    // PSDシグネチャ確認
    let mut sig = [0u8; 4];
    cursor.read_exact(&mut sig).ok()?;
    if &sig != b"8BPS" {
        return None;
    }

    // ヘッダ残り(22バイト)をスキップ
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

    while cursor.position() < resources_end {
        let loop_start_pos = cursor.position();

        let mut resource_sig = [0u8; 4];
        if cursor.read_exact(&mut resource_sig).is_err() {
            break;
        }
        if &resource_sig != b"8BIM" {
            break;
        }

        let mut id_buf = [0u8; 2];
        cursor.read_exact(&mut id_buf).ok()?;
        let resource_id = u16::from_be_bytes(id_buf);

        // パスカル文字列(名前)をスキップ
        let mut name_len = [0u8; 1];
        cursor.read_exact(&mut name_len).ok()?;
        let skip_len = if name_len[0] % 2 == 0 {
            name_len[0] as i64 + 1
        } else {
            name_len[0] as i64
        };
        if cursor.seek(SeekFrom::Current(skip_len)).is_err() {
            break;
        }

        cursor.read_exact(&mut len_buf).ok()?;
        let resource_size = u32::from_be_bytes(len_buf);

        // リソースID 1005 = ResolutionInfo
        if resource_id == 1005 && resource_size >= 4 {
            // hRes は 16.16 fixed-point: 上位2バイトが整数部
            let mut h_res_buf = [0u8; 4];
            if cursor.read_exact(&mut h_res_buf).is_err() {
                break;
            }
            let h_res_int = u16::from_be_bytes([h_res_buf[0], h_res_buf[1]]) as u32;
            return Some(h_res_int);
        }

        // 次のリソースへ(偶数バウンダリにアライン)
        let padded_size = if resource_size % 2 == 0 {
            resource_size
        } else {
            resource_size + 1
        };
        if cursor.seek(SeekFrom::Current(padded_size as i64)).is_err() {
            break;
        }

        if cursor.position() <= loop_start_pos {
            break;
        }
    }

    None
}

// 非PSD画像のwidth/height/color_modeをヘッダのみで取得(フルデコード回避)
struct ImageHeaderInfo {
    width: u32,
    height: u32,
    color_mode: String,
}

fn read_image_header(path: &Path) -> Option<ImageHeaderInfo> {
    use image::ImageDecoder;
    let reader = image::ImageReader::open(path).ok()?;
    let reader = reader.with_guessed_format().ok()?;
    let decoder = reader.into_decoder().ok()?;
    let (width, height) = decoder.dimensions();
    let mut color_mode = match decoder.color_type() {
        image::ColorType::L8 | image::ColorType::L16 |
        image::ColorType::La8 | image::ColorType::La16 => "Grayscale",
        image::ColorType::Rgb8 | image::ColorType::Rgb16 | image::ColorType::Rgb32F |
        image::ColorType::Rgba8 | image::ColorType::Rgba16 | image::ColorType::Rgba32F => "RGB",
        _ => "RGB",
    }
    .to_string();

    // image クレートは CMYK TIFF を内部で RGB に変換してしまうため、
    // PhotometricInterpretation タグ(262)を直接読んで CMYK を識別する。
    let lower = path.to_string_lossy().to_lowercase();
    if lower.ends_with(".tif") || lower.ends_with(".tiff") {
        if let Some(photometric) = read_tiff_photometric(path) {
            // 5 = Separated (CMYK)
            if photometric == 5 {
                color_mode = "CMYK".to_string();
            }
        }
    }

    Some(ImageHeaderInfo {
        width,
        height,
        color_mode,
    })
}

// TIFFのPhotometricInterpretationタグ(262)を読み取る
// 0=WhiteIsZero, 1=BlackIsZero, 2=RGB, 3=Palette, 4=Mask, 5=Separated(CMYK), 6=YCbCr, 8=CIELab
fn read_tiff_photometric(path: &Path) -> Option<u16> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 8];
    file.read_exact(&mut header).ok()?;

    let little_endian = match &header[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };

    let read_u16 = |b: &[u8]| -> u16 {
        if little_endian {
            u16::from_le_bytes([b[0], b[1]])
        } else {
            u16::from_be_bytes([b[0], b[1]])
        }
    };
    let read_u32 = |b: &[u8]| -> u32 {
        if little_endian {
            u32::from_le_bytes([b[0], b[1], b[2], b[3]])
        } else {
            u32::from_be_bytes([b[0], b[1], b[2], b[3]])
        }
    };

    // magic = 42 (classic TIFF)。BigTIFF(43)はサポート対象外
    if read_u16(&header[2..4]) != 42 {
        return None;
    }

    let ifd_offset = read_u32(&header[4..8]);
    file.seek(SeekFrom::Start(ifd_offset as u64)).ok()?;

    let mut count_buf = [0u8; 2];
    file.read_exact(&mut count_buf).ok()?;
    let entry_count = read_u16(&count_buf);

    let mut entry = [0u8; 12];
    for _ in 0..entry_count {
        if file.read_exact(&mut entry).is_err() {
            break;
        }
        let tag = read_u16(&entry[0..2]);
        if tag == 262 {
            // type=3(SHORT) count=1 のとき値は entry[8..10] に直接入っている
            return Some(read_u16(&entry[8..10]));
        }
    }
    None
}

// 単一ページの検証(ステータス + 画像メタ)
fn check_one_page(page: &PageCheckInput) -> PageCheckResult {
    let path = Path::new(&page.file_path);

    // 1. 存在確認
    if !path.exists() {
        return PageCheckResult {
            page_id: page.page_id.clone(),
            status: "missing".to_string(),
            width: None,
            height: None,
            color_mode: None,
            dpi: None,
        };
    }

    // 2. 更新日時確認
    let mut status = "ok".to_string();
    if let Some(expected) = page.modified_time {
        match fs::metadata(path) {
            Ok(metadata) => {
                let current = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                if current != expected {
                    status = "modified".to_string();
                }
            }
            Err(_) => {
                return PageCheckResult {
                    page_id: page.page_id.clone(),
                    status: "missing".to_string(),
                    width: None,
                    height: None,
                    color_mode: None,
                    dpi: None,
                };
            }
        }
    }

    // 3. 画像メタデータ抽出
    let lower = page.file_path.to_lowercase();
    let is_psd = lower.ends_with(".psd");

    let (width, height, color_mode, dpi) = if is_psd {
        match read_psd_header(path) {
            Some(info) => {
                let dpi = read_psd_dpi(path);
                (Some(info.width), Some(info.height), Some(info.color_mode), dpi)
            }
            None => {
                if status == "ok" {
                    status = "meta_error".to_string();
                }
                (None, None, None, None)
            }
        }
    } else {
        match read_image_header(path) {
            Some(info) => {
                (Some(info.width), Some(info.height), Some(info.color_mode), None)
            }
            None => {
                if status == "ok" {
                    status = "meta_error".to_string();
                }
                (None, None, None, None)
            }
        }
    };

    PageCheckResult {
        page_id: page.page_id.clone(),
        status,
        width,
        height,
        color_mode,
        dpi,
    }
}

// 作業中ページの軽量検証(rayon並列・画像メタ抽出含む)
#[tauri::command]
pub async fn validate_pages(pages: Vec<PageCheckInput>) -> Result<Vec<PageCheckResult>, String> {
    tokio::task::spawn_blocking(move || {
        let results: Vec<PageCheckResult> = pages
            .par_iter()
            .map(check_one_page)
            .collect();
        Ok(results)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// プロジェクト内のファイル参照を検証
#[tauri::command]
pub async fn validate_project_files(
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
