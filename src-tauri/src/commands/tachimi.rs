use std::fs;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::image_utils::validate_dimensions;
use crate::types::{JpegConvertConfig, JpegFileConfig, JpegGlobalSettings};
use super::jpeg::run_photoshop_jpeg_convert;

#[derive(Debug, Clone, Deserialize)]
pub struct TachimiPdfPage {
    pub source_path: Option<String>,
    pub page_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TachimiPdfChapter {
    pub name: String,
    pub pages: Vec<TachimiPdfPage>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TachimiPdfJobBatch {
    jobs: Vec<TachimiPdfJobItem>,
    result_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct TachimiPdfJobItem {
    input_folder: String,
    output_path: String,
    files: Vec<String>,
    options: TachimiPdfOptions,
}

#[derive(Debug, Serialize, Deserialize)]
struct TachimiPdfOptions {
    preset: String,
    width_mm: f32,
    height_mm: f32,
    gutter: u32,
    padding: u32,
    is_spread: bool,
    add_white_page: bool,
    print_work_info: bool,
    work_info: Option<serde_json::Value>,
    add_nombre: bool,
    nombre_size: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct TachimiPdfJobResultFile {
    success: bool,
    results: Vec<TachimiPdfJobItemResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TachimiPdfJobItemResult {
    pub output_path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TachimiPdfBatchResult {
    pub generated: usize,
    pub output_dir: String,
    pub results: Vec<TachimiPdfJobItemResult>,
}

#[derive(Debug, Clone, Serialize)]
struct TachimiPdfProgress {
    phase: String,
    message: String,
    current: usize,
    total: usize,
    indeterminate: bool,
}

fn emit_tachimi_pdf_progress(
    app_handle: &tauri::AppHandle,
    phase: &str,
    message: String,
    current: usize,
    total: usize,
    indeterminate: bool,
) {
    let _ = app_handle.emit(
        "tachimi-pdf-progress",
        TachimiPdfProgress {
            phase: phase.to_string(),
            message,
            current,
            total,
            indeterminate,
        },
    );
}

/// 指定パスが tachimi の実行ファイルとして妥当か検証する。
/// （存在チェック + ファイル名末尾 "tachimi.exe" の case-insensitive 一致）
fn is_tachimi_exe(p: &Path) -> bool {
    if !p.is_file() {
        return false;
    }
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    name == "tachimi.exe" || name == "tachimi"
}

fn tachimi_supports_pdf_job(p: &Path) -> bool {
    if !is_tachimi_exe(p) {
        return false;
    }

    let check_dir = std::env::temp_dir().join("daidori_tachimi_capability_check");
    let _ = fs::remove_dir_all(&check_dir);
    if fs::create_dir_all(&check_dir).is_err() {
        return false;
    }

    let job_path = check_dir.join("job.json");
    let result_path = check_dir.join("result.json");
    let job_json = serde_json::json!({
        "jobs": [],
        "result_path": result_path.to_string_lossy().to_string()
    });

    if fs::write(&job_path, job_json.to_string()).is_err() {
        let _ = fs::remove_dir_all(&check_dir);
        return false;
    }

    let mut child = match Command::new(p).arg("--pdf-job").arg(&job_path).spawn() {
        Ok(child) => child,
        Err(_) => {
            let _ = fs::remove_dir_all(&check_dir);
            return false;
        }
    };

    let started = Instant::now();
    let timeout = Duration::from_secs(5);
    loop {
        if result_path.exists() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_dir_all(&check_dir);
            return true;
        }

        if let Ok(Some(_)) = child.try_wait() {
            let ok = result_path.exists();
            let _ = fs::remove_dir_all(&check_dir);
            return ok;
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_dir_all(&check_dir);
            return false;
        }

        std::thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
pub async fn check_tachimi_exe(path: String) -> Result<bool, String> {
    Ok(is_tachimi_exe(Path::new(&path)))
}

/// 既知の候補から tachimi.exe を自動検出する。
/// hint（前回成功パス）→ 開発ビルド（Desktop\Tachimi_開発\...）→ インストール想定パスの順。
/// 見つかれば絶対パスを返し、見つからなければ None を返す。
#[tauri::command]
pub async fn detect_tachimi_exe(hint: Option<String>) -> Option<String> {
    // 1. hint（localStorage 等から渡された前回パス）
    if let Some(h) = hint.as_deref() {
        let p = PathBuf::from(h);
        if tachimi_supports_pdf_job(&p) {
            return Some(p.to_string_lossy().to_string());
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 2. 開発ビルド：%USERPROFILE%\Desktop\Tachimi_開発\Tachimi-_Standalone\src-tauri\target\{release,debug}\tachimi.exe
    if let Some(home) = dirs::home_dir() {
        let dev_root = home
            .join("Desktop")
            .join("Tachimi_開発")
            .join("Tachimi-_Standalone")
            .join("src-tauri")
            .join("target");
        candidates.push(dev_root.join("release").join("tachimi.exe"));
        candidates.push(dev_root.join("debug").join("tachimi.exe"));
    }

    // 3. Windows のインストール想定パス
    for env_key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(env_key) {
            let base_path = PathBuf::from(base);
            candidates.push(base_path.join("Tachimi").join("tachimi.exe"));
            candidates.push(
                base_path
                    .join("Programs")
                    .join("Tachimi")
                    .join("tachimi.exe"),
            );
        }
    }

    // 4. デスクトップ直下に置かれた配布版（あれば）
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Desktop").join("tachimi.exe"));
        candidates.push(home.join("Desktop").join("Tachimi").join("tachimi.exe"));
    }

    for c in candidates {
        if tachimi_supports_pdf_job(&c) {
            return Some(c.to_string_lossy().to_string());
        }
    }
    None
}

/// 連番プレフィックスを安全な文字列で組み立てる（4桁ゼロ埋め）。
fn stage_filename(idx: usize, src: &Path) -> String {
    let basename = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("file_{:04}", idx + 1));
    format!("{:04}_{}", idx + 1, basename)
}

/// 古いステージングフォルダを掃除する（前回実行の残骸を消す）。
/// 失敗は無視（次のステップで新しいフォルダを作るので致命的ではない）。
fn cleanup_old_staging(staging_dir: &Path) {
    if staging_dir.exists() {
        if let Err(e) = fs::remove_dir_all(staging_dir) {
            eprintln!(
                "Tachimi staging - failed to clean old staging dir {}: {}",
                staging_dir.display(),
                e
            );
        }
    }
}

fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = sanitized.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "chapter".to_string()
    } else {
        trimmed
    }
}

fn get_psd_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut header = [0u8; 26];
    file.read_exact(&mut header)
        .map_err(|e| format!("PSDヘッダー読み取りエラー: {}", e))?;
    if &header[0..4] != b"8BPS" {
        return Err("無効なPSDファイルです".to_string());
    }
    let height = u32::from_be_bytes([header[14], header[15], header[16], header[17]]);
    let width = u32::from_be_bytes([header[18], header[19], header[20], header[21]]);
    validate_dimensions(width, height)?;
    Ok((width, height))
}

fn get_source_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "psd" {
        get_psd_dimensions(path)
    } else {
        let (width, height) = image::image_dimensions(path).map_err(|e| e.to_string())?;
        validate_dimensions(width, height)?;
        Ok((width, height))
    }
}

fn create_blank_jpeg(width: u32, height: u32, dest: &Path) -> Result<(), String> {
    let img = image::RgbImage::from_pixel(width, height, image::Rgb([255, 255, 255]));
    let dynamic_img = image::DynamicImage::ImageRgb8(img);
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 95);
    dynamic_img.write_with_encoder(encoder).map_err(|e| e.to_string())
}

fn link_or_copy_file(src: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    if fs::hard_link(src, dest).is_ok() {
        return Ok(());
    }
    fs::copy(src, dest)
        .map(|_| ())
        .map_err(|e| format!("{} のステージングに失敗: {}", src.display(), e))
}

fn build_tachimi_pdf_options(is_spread: bool) -> TachimiPdfOptions {
    TachimiPdfOptions {
        preset: if is_spread { "b5_spread" } else { "b5_single" }.to_string(),
        width_mm: 182.0,
        height_mm: 257.0,
        gutter: if is_spread { 70 } else { 0 },
        padding: if is_spread { 150 } else { 0 },
        is_spread,
        add_white_page: false,
        print_work_info: false,
        work_info: None,
        add_nombre: false,
        nombre_size: "medium".to_string(),
    }
}

/// すべてのチャプターから集めたファイルパス群を Tachimi に渡して起動する。
///
/// 設計: 複数チャプター（=複数フォルダ）混在の場合でも Tachimi がファイルを
/// 見つけられるよう、`%TEMP%\daidori_tachimi_staging\` に**ハードリンク**で
/// 全ファイルを集約してから渡す。
/// - ハードリンクは同一ボリュームならほぼ即時で I/O ゼロ（NTFS の link 機能）
/// - 跨ボリューム時はファイルコピーへフォールバック
/// - 連番プレフィックス (`0001_`, `0002_`, ...) でチャプター順 + ページ順を保持
/// - ファイル名重複（複数チャプターで同名ファイル）も自動回避
///
/// Tachimi 側は起動時に `%TEMP%\tachimi_cli_files.json` の JSON 配列を読み取り、
/// 読み込み後に同ファイルを削除する設計（COMIC-Bridge 連携用に既存実装あり）。
///
/// 戻り値: 実際にステージングに成功したファイル数。
#[tauri::command]
pub async fn launch_tachimi_with_files(
    exe_path: String,
    file_paths: Vec<String>,
) -> Result<usize, String> {
    let exe = Path::new(&exe_path);
    if !exe.exists() || !exe.is_file() {
        return Err(format!(
            "Tachimi の実行ファイルが見つかりません: {}",
            exe_path
        ));
    }

    if file_paths.is_empty() {
        return Err("渡すファイルがありません。".to_string());
    }

    // 存在するファイルだけを抽出（壊れた参照は無視して残りで起動する）
    let valid: Vec<String> = file_paths
        .into_iter()
        .filter(|p| Path::new(p).exists())
        .collect();

    if valid.is_empty() {
        return Err(
            "渡せるファイルが見つかりませんでした（参照先がすべて存在しないか移動されています）。"
                .to_string(),
        );
    }

    // ステージングフォルダ: 前回分を掃除してから新規作成
    let staging_dir = std::env::temp_dir().join("daidori_tachimi_staging");
    cleanup_old_staging(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|e| {
        format!(
            "ステージングフォルダの作成に失敗 ({}): {}",
            staging_dir.display(),
            e
        )
    })?;

    // 全ファイルをハードリンク（失敗時はコピー）でステージングへ集約
    let mut staged_paths: Vec<String> = Vec::with_capacity(valid.len());
    let mut link_errors: Vec<String> = Vec::new();
    for (idx, src) in valid.iter().enumerate() {
        let src_path = Path::new(src);
        let staged_name = stage_filename(idx, src_path);
        let dest = staging_dir.join(&staged_name);

        // 同名既存（前回掃除に失敗した場合などのフェイルセーフ）を除去
        if dest.exists() {
            let _ = fs::remove_file(&dest);
        }

        // 1) ハードリンク: 同一ボリューム内で最速、I/O ほぼゼロ
        let linked = fs::hard_link(src_path, &dest).is_ok();
        // 2) 失敗時はファイルコピー（クロスボリューム / 権限 / FS 非対応など）
        if !linked {
            match fs::copy(src_path, &dest) {
                Ok(_) => {}
                Err(e) => {
                    link_errors.push(format!("{}: {}", src, e));
                    continue;
                }
            }
        }
        staged_paths.push(dest.to_string_lossy().to_string());
    }

    if staged_paths.is_empty() {
        return Err(format!(
            "ステージングに失敗しました ({} 件)。最初の失敗: {}",
            link_errors.len(),
            link_errors.first().cloned().unwrap_or_default()
        ));
    }

    if !link_errors.is_empty() {
        eprintln!(
            "Tachimi staging - {} files staged, {} failed (例: {})",
            staged_paths.len(),
            link_errors.len(),
            link_errors.first().cloned().unwrap_or_default()
        );
    }

    // トリガー JSON を %TEMP%\tachimi_cli_files.json に書き出し
    let trigger_path = std::env::temp_dir().join("tachimi_cli_files.json");
    let json = serde_json::to_string(&staged_paths)
        .map_err(|e| format!("トリガー JSON のシリアライズに失敗: {}", e))?;
    fs::write(&trigger_path, json).map_err(|e| {
        format!(
            "トリガー JSON の書き出しに失敗 ({}): {}",
            trigger_path.display(),
            e
        )
    })?;

    eprintln!(
        "Tachimi launch - staging: {} ({} files), trigger: {}",
        staging_dir.display(),
        staged_paths.len(),
        trigger_path.display()
    );

    // tachimi.exe を spawn（CLI 引数なし、トリガーファイル経由）
    Command::new(&exe_path).spawn().map_err(|e| {
        // spawn 失敗時はトリガーファイルが残ると次回他経路から誤読されるため削除
        let _ = fs::remove_file(&trigger_path);
        format!("Tachimi の起動に失敗: {}", e)
    })?;

    eprintln!("Tachimi launch - spawned: {}", exe_path);
    Ok(staged_paths.len())
}

#[tauri::command]
pub async fn generate_tachimi_chapter_pdfs(
    app_handle: tauri::AppHandle,
    exe_path: String,
    output_dir: String,
    mut chapters: Vec<TachimiPdfChapter>,
    is_spread: Option<bool>,
) -> Result<TachimiPdfBatchResult, String> {
    chapters = convert_psd_pages_for_pdf(app_handle.clone(), chapters).await?;
    tokio::task::spawn_blocking(move || {
        generate_tachimi_chapter_pdfs_sync(app_handle, exe_path, output_dir, chapters, is_spread.unwrap_or(true))
    })
    .await
    .map_err(|e| format!("Tachimi PDFジョブの実行に失敗: {}", e))?
}

async fn convert_psd_pages_for_pdf(
    app_handle: tauri::AppHandle,
    mut chapters: Vec<TachimiPdfChapter>,
) -> Result<Vec<TachimiPdfChapter>, String> {
    let mut psd_files: Vec<(usize, usize, String, String)> = Vec::new();

    for (chapter_index, chapter) in chapters.iter().enumerate() {
        for (page_index, page) in chapter.pages.iter().enumerate() {
            let Some(path) = page.source_path.as_deref() else {
                continue;
            };
            let ext = Path::new(path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext == "psd" {
                psd_files.push((
                    chapter_index,
                    page_index,
                    path.to_string(),
                    format!("c{:03}_p{:04}.jpg", chapter_index + 1, page_index + 1),
                ));
            }
        }
    }

    if psd_files.is_empty() {
        return Ok(chapters);
    }

    emit_tachimi_pdf_progress(
        &app_handle,
        "prepare",
        format!("PSD {} 件をPDF用JPEGに変換しています", psd_files.len()),
        0,
        psd_files.len(),
        true,
    );

    let output_dir = std::env::temp_dir()
        .join("daidori_tachimi_pdf_psd_jpeg")
        .to_string_lossy()
        .to_string();
    let _ = fs::remove_dir_all(&output_dir);

    let config = JpegConvertConfig {
        global_settings: JpegGlobalSettings { jpg_quality: 12 },
        files: psd_files
            .iter()
            .map(|(_, _, path, output_name)| JpegFileConfig {
                path: path.clone(),
                output_path: output_dir.clone(),
                output_name: output_name.clone(),
                crop_bounds: None,
            })
            .collect(),
    };

    let response = run_photoshop_jpeg_convert(app_handle.clone(), config, output_dir).await?;
    let mut converted_paths: HashMap<String, String> = HashMap::new();

    for (idx, result) in response.results.iter().enumerate() {
        if !result.success {
            return Err(format!(
                "PDF用JPEG変換に失敗しました: {}",
                result.error.clone().unwrap_or_else(|| result.file_name.clone())
            ));
        }

        let Some((_, _, source_path, requested_name)) = psd_files.get(idx) else {
            continue;
        };
        let converted = result
            .output_path
            .clone()
            .unwrap_or_else(|| {
                Path::new(&response.output_dir)
                    .join(requested_name)
                    .to_string_lossy()
                    .to_string()
            });
        converted_paths.insert(source_path.clone(), converted);
    }

    for chapter in &mut chapters {
        for page in &mut chapter.pages {
            if let Some(path) = page.source_path.as_ref() {
                if let Some(converted) = converted_paths.get(path) {
                    page.source_path = Some(converted.clone());
                }
            }
        }
    }

    emit_tachimi_pdf_progress(
        &app_handle,
        "prepare",
        "PSDのPDF用JPEG変換が完了しました".to_string(),
        psd_files.len(),
        psd_files.len(),
        false,
    );

    Ok(chapters)
}

fn generate_tachimi_chapter_pdfs_sync(
    app_handle: tauri::AppHandle,
    exe_path: String,
    output_dir: String,
    chapters: Vec<TachimiPdfChapter>,
    is_spread: bool,
) -> Result<TachimiPdfBatchResult, String> {
    let exe = Path::new(&exe_path);
    if !exe.exists() || !exe.is_file() {
        return Err(format!("Tachimi の実行ファイルが見つかりません: {}", exe_path));
    }

    let output_root = PathBuf::from(&output_dir);
    fs::create_dir_all(&output_root)
        .map_err(|e| format!("PDF出力フォルダを作成できません: {}", e))?;

    emit_tachimi_pdf_progress(
        &app_handle,
        "prepare",
        "Tachimi PDFジョブを準備しています".to_string(),
        0,
        chapters.len().max(1),
        false,
    );

    let staging_root = std::env::temp_dir().join("daidori_tachimi_pdf_jobs");
    cleanup_old_staging(&staging_root);
    fs::create_dir_all(&staging_root)
        .map_err(|e| format!("PDFジョブ用一時フォルダを作成できません: {}", e))?;

    let mut jobs = Vec::new();
    let mut skipped: Vec<TachimiPdfJobItemResult> = Vec::new();

    let total_chapters = chapters.len().max(1);
    for (chapter_index, chapter) in chapters.iter().enumerate() {
        emit_tachimi_pdf_progress(
            &app_handle,
            "stage",
            format!("「{}」をPDFジョブに追加しています", chapter.name),
            chapter_index,
            total_chapters,
            false,
        );

        if chapter.pages.is_empty() {
            continue;
        }

        let safe_chapter_name = sanitize_filename(&chapter.name);
        let chapter_dir = staging_root.join(format!("{:03}_{}", chapter_index + 1, safe_chapter_name));
        fs::create_dir_all(&chapter_dir)
            .map_err(|e| format!("チャプター一時フォルダを作成できません: {}", e))?;

        let mut source_dimensions: Vec<Option<(u32, u32)>> = Vec::with_capacity(chapter.pages.len());
        for page in &chapter.pages {
            let dims = page
                .source_path
                .as_deref()
                .and_then(|p| {
                    let path = Path::new(p);
                    if path.exists() {
                        get_source_dimensions(path).ok()
                    } else {
                        None
                    }
                });
            source_dimensions.push(dims);
        }

        let default_size = source_dimensions
            .iter()
            .flatten()
            .next()
            .copied()
            .unwrap_or((1654, 2339));

        let mut files = Vec::new();
        for (page_index, page) in chapter.pages.iter().enumerate() {
            let page_no = page_index + 1;

            if let Some(source_path) = page.source_path.as_deref() {
                let src = Path::new(source_path);
                if src.exists() {
                    let ext = src
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("jpg")
                        .to_lowercase();
                    let file_name = format!("{:04}.{}", page_no, ext);
                    let dest = chapter_dir.join(&file_name);
                    link_or_copy_file(src, &dest)?;
                    files.push(file_name);
                    continue;
                }
            }

            if page.page_type == "file" {
                skipped.push(TachimiPdfJobItemResult {
                    output_path: output_root
                        .join(format!("{}.pdf", safe_chapter_name))
                        .to_string_lossy()
                        .to_string(),
                    success: false,
                    error: Some(format!(
                        "{} の {} ページ目の参照ファイルが見つかりません",
                        chapter.name, page_no
                    )),
                });
                continue;
            }

            let size = source_dimensions[..page_index]
                .iter()
                .rev()
                .flatten()
                .next()
                .copied()
                .or_else(|| source_dimensions[page_index + 1..].iter().flatten().next().copied())
                .unwrap_or(default_size);
            let file_name = format!("{:04}.jpg", page_no);
            let dest = chapter_dir.join(&file_name);
            create_blank_jpeg(size.0, size.1, &dest)?;
            files.push(file_name);
        }

        if files.is_empty() {
            continue;
        }

        let output_path = output_root
            .join(format!("{}.pdf", safe_chapter_name))
            .to_string_lossy()
            .to_string();

        jobs.push(TachimiPdfJobItem {
            input_folder: chapter_dir.to_string_lossy().to_string(),
            output_path,
            files,
            options: build_tachimi_pdf_options(is_spread),
        });
    }

    if jobs.is_empty() {
        return Err("PDF化できるチャプターがありません。".to_string());
    }

    emit_tachimi_pdf_progress(
        &app_handle,
        "stage",
        "Tachimi に渡すPDFジョブを書き出しています".to_string(),
        total_chapters,
        total_chapters,
        false,
    );

    let job_path = staging_root.join("tachimi_pdf_job.json");
    let result_path = staging_root.join("tachimi_pdf_result.json");
    let batch = TachimiPdfJobBatch {
        jobs,
        result_path: result_path.to_string_lossy().to_string(),
    };

    let job_json = serde_json::to_string_pretty(&batch)
        .map_err(|e| format!("PDFジョブJSONを作成できません: {}", e))?;
    fs::write(&job_path, job_json)
        .map_err(|e| format!("PDFジョブJSONを書き込めません: {}", e))?;

    emit_tachimi_pdf_progress(
        &app_handle,
        "generate",
        "Tachimi でPDFを生成しています".to_string(),
        0,
        batch.jobs.len().max(1),
        true,
    );

    let mut child = Command::new(&exe_path)
        .arg("--pdf-job")
        .arg(&job_path)
        .spawn()
        .map_err(|e| format!("Tachimi の起動に失敗: {}", e))?;

    let timeout = Duration::from_secs(30 * 60);
    let started = Instant::now();
    let status = loop {
        if result_path.exists() {
            break None;
        }

        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Tachimi の実行状態を確認できません: {}", e));
            }
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(
                "Tachimi PDF生成がタイムアウトしました。古い Tachimi 実行ファイルが起動している可能性があります。Tachimi_開発\\Tachimi-_Standalone\\src-tauri\\target\\debug\\tachimi.exe をビルド済みか確認してください。"
                    .to_string(),
            );
        }

        std::thread::sleep(Duration::from_millis(500));
    };

    if !result_path.exists() {
        return Err(format!(
            "Tachimi PDFジョブの結果ファイルが作成されませんでした。終了コード: {:?}",
            status.and_then(|s| s.code())
        ));
    }

    let _ = child.kill();
    let _ = child.wait();

    let result_json = fs::read_to_string(&result_path)
        .map_err(|e| format!("Tachimi PDFジョブ結果を読み込めません: {}", e))?;

    emit_tachimi_pdf_progress(
        &app_handle,
        "finalize",
        "PDF生成結果を確認しています".to_string(),
        1,
        1,
        false,
    );

    let result_file: TachimiPdfJobResultFile = serde_json::from_str(&result_json)
        .map_err(|e| format!("Tachimi PDFジョブ結果を解析できません: {}", e))?;

    let mut results = result_file.results;
    results.extend(skipped);
    let generated = results.iter().filter(|r| r.success).count();

    if generated == 0 {
        let first_error = results
            .iter()
            .find_map(|r| r.error.clone())
            .unwrap_or_else(|| "Tachimi PDF生成に失敗しました。".to_string());
        return Err(first_error);
    }

    emit_tachimi_pdf_progress(
        &app_handle,
        "complete",
        format!("{} 件のチャプターPDFを生成しました", generated),
        1,
        1,
        false,
    );

    Ok(TachimiPdfBatchResult {
        generated,
        output_dir,
        results,
    })
}
