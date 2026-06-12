use crate::types::{PageCheckInput, PageCheckResult, ProjectFile};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const PROJECT_LINKS_DIR_NAME: &str = "リンクファイル";
const PROJECT_EXTENSION: &str = "daiw";

#[derive(Debug, Serialize)]
pub struct ProjectSaveResult {
    pub file_path: String,
    pub project_dir: String,
    pub copied_files: usize,
}

#[derive(Debug, Serialize)]
pub struct ProjectSavePathResult {
    pub file_path: String,
    pub project_dir: String,
    pub dialog_path: String,
}

fn safe_file_name(name: &str, fallback: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = sanitized.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

fn ensure_project_extension(path: &Path) -> PathBuf {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(PROJECT_EXTENSION))
        .unwrap_or(false)
    {
        path.to_path_buf()
    } else {
        path.with_extension(PROJECT_EXTENSION)
    }
}

fn project_bundle_paths(
    requested_path: &str,
    allow_overwrite: bool,
) -> Result<(PathBuf, PathBuf), String> {
    let project_file_candidate = ensure_project_extension(Path::new(requested_path));
    let stem = project_file_candidate
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| safe_file_name(s, "project"))
        .ok_or_else(|| "プロジェクトファイル名を取得できません".to_string())?;
    let parent = project_file_candidate
        .parent()
        .ok_or_else(|| "プロジェクト保存先の親フォルダを取得できません".to_string())?;

    let path_is_inside_named_dir = parent
        .file_name()
        .and_then(|s| s.to_str())
        .map(|name| name.eq_ignore_ascii_case(&stem))
        .unwrap_or(false);

    let project_dir = if path_is_inside_named_dir {
        parent.to_path_buf()
    } else {
        parent.join(&stem)
    };
    let project_file = project_dir.join(format!("{}.{}", stem, PROJECT_EXTENSION));
    if allow_overwrite {
        return Ok((project_dir, project_file));
    }

    let bundle_parent = if path_is_inside_named_dir {
        parent
            .parent()
            .ok_or_else(|| "プロジェクト保存先の親フォルダを取得できません".to_string())?
    } else {
        parent
    };

    let mut counter = 0;
    loop {
        let candidate_stem = if counter == 0 {
            stem.clone()
        } else {
            format!("{}({})", stem, counter)
        };
        let candidate_dir = bundle_parent.join(&candidate_stem);
        let candidate_file =
            candidate_dir.join(format!("{}.{}", candidate_stem, PROJECT_EXTENSION));
        let sibling_file = bundle_parent.join(format!("{}.{}", candidate_stem, PROJECT_EXTENSION));

        if !candidate_dir.exists() && !candidate_file.exists() && !sibling_file.exists() {
            return Ok((candidate_dir, candidate_file));
        }
        counter += 1;
    }
}

fn project_dialog_path(project_dir: &Path, project_file: &Path) -> Result<PathBuf, String> {
    let file_name = project_file
        .file_name()
        .ok_or_else(|| "プロジェクトファイル名を取得できません".to_string())?;

    Ok(project_dir
        .parent()
        .map(|parent| parent.join(file_name))
        .unwrap_or_else(|| PathBuf::from(file_name)))
}

fn relative_path(path: &Path, base: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn unique_file_name(name: &str, used: &mut HashSet<String>) -> String {
    let safe = safe_file_name(name, "file");
    let path = Path::new(&safe);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let mut candidate = safe.clone();
    let mut counter = 1;

    while used.contains(&candidate.to_lowercase()) {
        candidate = if ext.is_empty() {
            format!("{}({})", stem, counter)
        } else {
            format!("{}({}).{}", stem, counter, ext)
        };
        counter += 1;
    }
    used.insert(candidate.to_lowercase());
    candidate
}

fn metadata_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn copy_linked_files_into_bundle(
    project: &mut ProjectFile,
    project_dir: &Path,
) -> Result<usize, String> {
    let links_dir = project_dir.join(PROJECT_LINKS_DIR_NAME);
    fs::create_dir_all(&links_dir)
        .map_err(|e| format!("リンクファイルフォルダ作成エラー: {}", e))?;

    let mut used_names = HashSet::new();
    let mut path_map: HashMap<String, PathBuf> = HashMap::new();
    let mut copied_count = 0;

    for chapter in &mut project.chapters {
        for page in &mut chapter.pages {
            let Some(file_ref) = page.file.as_mut() else {
                continue;
            };

            let source = Path::new(&file_ref.absolute_path);
            if !source.exists() {
                continue;
            }

            let source_key = fs::canonicalize(source)
                .unwrap_or_else(|_| source.to_path_buf())
                .to_string_lossy()
                .to_string();

            let dest = if let Some(mapped) = path_map.get(&source_key) {
                mapped.clone()
            } else {
                let source_name = source
                    .file_name()
                    .and_then(|s| s.to_str())
                    .or_else(|| {
                        (!file_ref.file_name.is_empty()).then_some(file_ref.file_name.as_str())
                    })
                    .unwrap_or("file");
                let dest_name = unique_file_name(source_name, &mut used_names);
                let dest = links_dir.join(dest_name);

                let source_canonical = fs::canonicalize(source).ok();
                let dest_canonical = fs::canonicalize(&dest).ok();
                if source_canonical.as_ref() != dest_canonical.as_ref() {
                    fs::copy(source, &dest).map_err(|e| {
                        format!(
                            "リンクファイルのコピーに失敗しました: {} -> {} ({})",
                            source.display(),
                            dest.display(),
                            e
                        )
                    })?;
                    copied_count += 1;
                }

                path_map.insert(source_key, dest.clone());
                dest
            };

            if let Ok(metadata) = fs::metadata(&dest) {
                file_ref.file_size = metadata.len();
                file_ref.modified_time = metadata_millis(&metadata);
            }
            file_ref.absolute_path = dest.to_string_lossy().to_string();
            file_ref.relative_path = relative_path(&dest, project_dir);
            file_ref.file_name = dest
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&file_ref.file_name)
                .to_string();
        }
    }

    Ok(copied_count)
}

fn write_project_file_atomic(path: &Path, project: &ProjectFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(project)
        .map_err(|e| format!("JSONシリアライズエラー: {}", e))?;
    let temp_path = path.with_extension(format!("{}.tmp", PROJECT_EXTENSION));
    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("一時ファイル作成エラー: {}", e))?;
    file.write_all(json.as_bytes()).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("書き込みエラー: {}", e)
    })?;
    file.sync_all().map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("同期エラー: {}", e)
    })?;
    drop(file);

    if path.exists() {
        fs::remove_file(path).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            format!("既存プロジェクトファイル削除エラー: {}", e)
        })?;
    }
    fs::rename(&temp_path, path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("リネームエラー: {}", e)
    })
}

// プロジェクトをフォルダ形式で保存（.daiw + リンクファイルコピー）
#[tauri::command]
pub fn get_available_project_save_path(file_path: String) -> Result<ProjectSavePathResult, String> {
    let (project_dir, project_file) = project_bundle_paths(&file_path, false)?;
    let dialog_path = project_dialog_path(&project_dir, &project_file)?;

    Ok(ProjectSavePathResult {
        file_path: project_file.to_string_lossy().to_string(),
        project_dir: project_dir.to_string_lossy().to_string(),
        dialog_path: dialog_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn save_project(
    file_path: String,
    mut project: ProjectFile,
    allow_overwrite: Option<bool>,
) -> Result<ProjectSaveResult, String> {
    let (project_dir, project_file) =
        project_bundle_paths(&file_path, allow_overwrite.unwrap_or(false))?;
    fs::create_dir_all(&project_dir)
        .map_err(|e| format!("プロジェクトフォルダ作成エラー: {}", e))?;

    project.base_path = project_dir.to_string_lossy().to_string();
    let copied_files = copy_linked_files_into_bundle(&mut project, &project_dir)?;
    write_project_file_atomic(&project_file, &project)?;

    Ok(ProjectSaveResult {
        file_path: project_file.to_string_lossy().to_string(),
        project_dir: project_dir.to_string_lossy().to_string(),
        copied_files,
    })
}

// プロジェクトを読み込み
#[tauri::command]
pub async fn load_project(file_path: String) -> Result<ProjectFile, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err("ファイルが見つかりません".to_string());
    }

    let content = fs::read_to_string(path).map_err(|e| format!("ファイル読み込みエラー: {}", e))?;
    let mut project: ProjectFile =
        serde_json::from_str(&content).map_err(|e| format!("JSON解析エラー: {}", e))?;
    let current_base = path.parent().unwrap_or_else(|| Path::new("")).to_path_buf();
    project.base_path = current_base.to_string_lossy().to_string();

    for chapter in &mut project.chapters {
        for page in &mut chapter.pages {
            if let Some(file_ref) = page.file.as_mut() {
                let absolute = Path::new(&file_ref.absolute_path);
                let saved_relative = Path::new(&file_ref.relative_path);
                let relative = current_base.join(saved_relative);
                if !saved_relative.is_absolute() && relative.exists() {
                    file_ref.absolute_path = relative.to_string_lossy().to_string();
                    if let Ok(metadata) = fs::metadata(&relative) {
                        file_ref.file_size = metadata.len();
                        file_ref.modified_time = metadata_millis(&metadata);
                    }
                } else if !absolute.exists() && relative.exists() {
                    file_ref.absolute_path = relative.to_string_lossy().to_string();
                    if let Ok(metadata) = fs::metadata(&relative) {
                        file_ref.file_size = metadata.len();
                        file_ref.modified_time = metadata_millis(&metadata);
                    }
                }
            }
        }
    }

    Ok(project)
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
        image::ColorType::L8
        | image::ColorType::L16
        | image::ColorType::La8
        | image::ColorType::La16 => "Grayscale",
        image::ColorType::Rgb8
        | image::ColorType::Rgb16
        | image::ColorType::Rgb32F
        | image::ColorType::Rgba8
        | image::ColorType::Rgba16
        | image::ColorType::Rgba32F => "RGB",
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
    match fs::metadata(path) {
        Ok(metadata) => {
            if let Some(expected_size) = page.file_size {
                if metadata.len() != expected_size {
                    status = "modified".to_string();
                }
            }

            if let Some(expected) = page.modified_time {
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

    // 3. 画像メタデータ抽出
    let lower = page.file_path.to_lowercase();
    let is_psd = lower.ends_with(".psd");

    let (width, height, color_mode, dpi) = if is_psd {
        match read_psd_header(path) {
            Some(info) => {
                let dpi = read_psd_dpi(path);
                (
                    Some(info.width),
                    Some(info.height),
                    Some(info.color_mode),
                    dpi,
                )
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
            Some(info) => (
                Some(info.width),
                Some(info.height),
                Some(info.color_mode),
                None,
            ),
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
        let results: Vec<PageCheckResult> = pages.par_iter().map(check_one_page).collect();
        Ok(results)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
