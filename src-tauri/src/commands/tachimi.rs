use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use tauri::Emitter;

use image::imageops::FilterType;
use rayon::prelude::*;

use super::jpeg_native::{run_native_jpeg_convert, NativeJpegConfig, NativeJpegFile};
use crate::image_utils::validate_dimensions;
use crate::native_jpeg::jpeg::write_jpeg_baseline_to_file;
use crate::native_jpeg::{
    fit_within_pdf_bbox, predict_output_dims, read_image_dimensions, ProcessOptions,
};

#[derive(Debug, Clone, Deserialize)]
pub struct TachimiPdfPage {
    pub source_path: Option<String>,
    pub page_type: String,
    /// 断ち切り・品質設定（画像ファイルページのみ。未指定はデフォルト=断ち切りなし）
    #[serde(default)]
    pub options: Option<ProcessOptions>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TachimiPdfChapter {
    pub name: String,
    pub chapter_type: Option<String>,
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

    // ジョブごとに一意なフォルダ（固定名による衝突/予測・並行実行干渉を回避）。
    let check_dir = crate::security::temp_subdir("work")
        .join("daidori_tachimi_capability_check")
        .join(uuid::Uuid::new_v4().simple().to_string());
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

fn create_blank_jpeg(_width: u32, _height: u32, dest: &Path) -> Result<(), String> {
    // 白紙ページは固定仕様（1280×1818 / 600ppi / グレースケール白）で生成する。
    // 隣接ページのサイズ（_width/_height）は参照しない。
    crate::blank_page::write_blank_jpeg(dest, None)
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
#[tauri::command]
pub async fn generate_tachimi_chapter_pdfs(
    app_handle: tauri::AppHandle,
    exe_path: String,
    output_dir: String,
    output_name: Option<String>,
    mut chapters: Vec<TachimiPdfChapter>,
    is_spread: Option<bool>,
) -> Result<TachimiPdfBatchResult, String> {
    chapters = prepare_pages_for_pdf(app_handle.clone(), chapters).await?;
    tokio::task::spawn_blocking(move || {
        generate_tachimi_chapter_pdfs_sync(
            app_handle,
            exe_path,
            output_dir,
            output_name.unwrap_or_else(|| "台割PDF".to_string()),
            chapters,
            is_spread.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| format!("Tachimi PDFジョブの実行に失敗: {}", e))?
}

/// PDF化前処理: 全ページを JPEG化 → 一律サイズ統一 → 断ち切り適用
/// （Photoshop不要・native_jpeg パイプライン使用）
async fn prepare_pages_for_pdf(
    app_handle: tauri::AppHandle,
    mut chapters: Vec<TachimiPdfChapter>,
) -> Result<Vec<TachimiPdfChapter>, String> {
    // 1. 画像ファイルを持つ全ページ（PSD/JPEG/PNG/TIFF 区別なし）を収集
    // セキュリティ(§6): 中間JPEGは pdf カテゴリ配下へ（ACL強化済・共有%TEMP%直下の固定名を避ける）。
    let output_dir = crate::security::temp_subdir("pdf")
        .join("daidori_tachimi_pdf_jpeg")
        .to_string_lossy()
        .to_string();

    let mut tasks: Vec<(usize, usize)> = Vec::new();
    let mut files: Vec<NativeJpegFile> = Vec::new();
    let mut src_paths: Vec<String> = Vec::new();
    let mut opts_list: Vec<ProcessOptions> = Vec::new();

    for (ci, chapter) in chapters.iter().enumerate() {
        for (pi, page) in chapter.pages.iter().enumerate() {
            let Some(path) = page.source_path.as_deref() else {
                continue;
            };
            if !Path::new(path).exists() {
                continue;
            }
            let opts = page.options.clone().unwrap_or_default();
            src_paths.push(path.to_string());
            opts_list.push(opts.clone());
            files.push(NativeJpegFile {
                path: path.to_string(),
                output_path: output_dir.clone(),
                output_name: format!("c{:03}_p{:04}.jpg", ci + 1, pi + 1),
                // 断ち切り設定（未指定はデフォルト=断ち切りなし）
                options: opts,
                extra_outputs: Vec::new(),
            });
            tasks.push((ci, pi));
        }
    }

    if files.is_empty() {
        return Ok(chapters);
    }

    let total = files.len();

    emit_tachimi_pdf_progress(
        &app_handle,
        "prepare",
        format!("{} 件をJPEG化（断ち切り適用）しています", total),
        0,
        total,
        true,
    );

    // 統一目標サイズを予測（画像をデコードせずヘッダのみ読む）。
    // 段階1の単一パス内で各ページをこのサイズへ exact リサイズし、
    // 旧段階2の「再デコード＋再エンコード」を不要にする。
    let predicted: Vec<(u32, u32)> = src_paths
        .par_iter()
        .zip(opts_list.par_iter())
        .map(|(p, o)| match read_image_dimensions(Path::new(p)) {
            Some((w, h)) => predict_output_dims(w, h, o),
            None => (0, 0),
        })
        .collect();

    let mut size_counts: HashMap<(u32, u32), usize> = HashMap::new();
    for &(w, h) in &predicted {
        if w > 0 && h > 0 {
            *size_counts.entry((w, h)).or_insert(0) += 1;
        }
    }
    let target_size = size_counts
        .into_iter()
        .max_by(|a, b| {
            a.1.cmp(&b.1).then_with(|| {
                let area_a = (a.0).0 as u64 * (a.0).1 as u64;
                let area_b = (b.0).0 as u64 * (b.0).1 as u64;
                area_a.cmp(&area_b)
            })
        })
        .map(|(size, _)| size)
        // Tachimi 標準の書き出し解像度（2250×3000枠）に収めてPDFを軽量化
        .map(|(w, h)| fit_within_pdf_bbox(w, h));

    // 各ページに「ベースライン高速JPEG」と「目標サイズへの exact リサイズ」を強制。
    // フロント送信値は断ち切り設定のみ尊重し、リサイズ/エンコーダはサーバ側で固定する。
    for f in &mut files {
        f.options.fast_jpeg = true;
        if let Some((tw, th)) = target_size {
            f.options.resize_mode = "exact".to_string();
            f.options.resize_target_w = tw;
            f.options.resize_target_h = th;
        }
    }

    let _ = fs::remove_dir_all(&output_dir);

    let response =
        run_native_jpeg_convert(app_handle.clone(), NativeJpegConfig { files }, output_dir).await?;

    let mut converted: Vec<PathBuf> = Vec::with_capacity(tasks.len());
    for (idx, result) in response.results.iter().enumerate() {
        if !result.success {
            return Err(format!(
                "PDF用JPEG変換に失敗しました: {}",
                result
                    .error
                    .clone()
                    .unwrap_or_else(|| result.file_name.clone())
            ));
        }
        let path = result.output_path.clone().unwrap_or_else(|| {
            let (ci, pi) = tasks.get(idx).copied().unwrap_or((idx, 0));
            Path::new(&response.output_dir)
                .join(format!("c{:03}_p{:04}.jpg", ci + 1, pi + 1))
                .to_string_lossy()
                .to_string()
        });
        converted.push(PathBuf::from(path));
    }

    // 2. サイズ統一の安全網（段階1で統一済みのため通常は再エンコードが発火しない。
    //    予測不能だった外れ値のみベースラインJPEGで補正）
    emit_tachimi_pdf_progress(
        &app_handle,
        "prepare",
        "ページサイズを統一しています".to_string(),
        total,
        total,
        true,
    );

    let resize_targets = converted.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
        for p in &resize_targets {
            if let Some((w, h)) = read_image_dimensions(p) {
                *counts.entry((w, h)).or_insert(0) += 1;
            }
        }
        let target = counts
            .into_iter()
            .max_by(|a, b| {
                a.1.cmp(&b.1).then_with(|| {
                    let area_a = (a.0).0 as u64 * (a.0).1 as u64;
                    let area_b = (b.0).0 as u64 * (b.0).1 as u64;
                    area_a.cmp(&area_b)
                })
            })
            .map(|(size, _)| size)
            // 段階1で予測不能だった場合のフォールバックでも 2250×3000 枠に収める
            .map(|(w, h)| fit_within_pdf_bbox(w, h));

        let Some((tw, th)) = target else {
            return Ok(());
        };

        resize_targets
            .par_iter()
            .try_for_each(|p| -> Result<(), String> {
                match read_image_dimensions(p) {
                    Some((w, h)) if w == tw && h == th => Ok(()),
                    _ => {
                        let img = image::open(p).map_err(|e| format!("{}: {}", p.display(), e))?;
                        let resized = img.resize_exact(tw, th, FilterType::Triangle);
                        let rgb = resized.to_rgb8();
                        write_jpeg_baseline_to_file(
                            rgb.as_raw(),
                            rgb.width(),
                            rgb.height(),
                            95.0,
                            p,
                        )
                    }
                }
            })
    })
    .await
    .map_err(|e| format!("サイズ統一タスクエラー: {}", e))??;

    // 3. source_path を変換後JPEGに差し替え
    for (idx, (ci, pi)) in tasks.iter().enumerate() {
        if let Some(p) = converted.get(idx) {
            chapters[*ci].pages[*pi].source_path = Some(p.to_string_lossy().to_string());
        }
    }

    emit_tachimi_pdf_progress(
        &app_handle,
        "prepare",
        "JPEG化・サイズ統一・断ち切りが完了しました".to_string(),
        total,
        total,
        false,
    );

    Ok(chapters)
}

fn generate_tachimi_chapter_pdfs_sync(
    app_handle: tauri::AppHandle,
    exe_path: String,
    output_dir: String,
    output_name: String,
    chapters: Vec<TachimiPdfChapter>,
    is_spread: bool,
) -> Result<TachimiPdfBatchResult, String> {
    let exe = Path::new(&exe_path);
    if !exe.exists() || !exe.is_file() {
        return Err(format!(
            "Tachimi の実行ファイルが見つかりません: {}",
            exe_path
        ));
    }

    let output_root = PathBuf::from(&output_dir);
    fs::create_dir_all(&output_root)
        .map_err(|e| format!("PDF出力フォルダを作成できません: {}", e))?;

    generate_tachimi_merged_pdf_job(
        &app_handle,
        exe_path,
        output_root,
        output_dir,
        output_name,
        chapters,
        is_spread,
    )
}

fn generate_tachimi_merged_pdf_job(
    app_handle: &tauri::AppHandle,
    exe_path: String,
    output_root: PathBuf,
    output_dir: String,
    output_name: String,
    chapters: Vec<TachimiPdfChapter>,
    is_spread: bool,
) -> Result<TachimiPdfBatchResult, String> {
    emit_tachimi_pdf_progress(
        app_handle,
        "prepare",
        "Tachimi PDFジョブを準備しています".to_string(),
        0,
        chapters.len().max(1),
        false,
    );

    // ジョブごとに一意な staging（固定名の衝突/予測・並行実行干渉を回避）。
    // 終了時に確実に削除するため RAII ガードを使う（全 return 経路で発火）。
    struct StagingGuard(PathBuf);
    impl Drop for StagingGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    let staging_root = crate::security::temp_subdir("work")
        .join("daidori_tachimi_pdf_jobs")
        .join(uuid::Uuid::new_v4().simple().to_string());
    let _staging_guard = StagingGuard(staging_root.clone());
    fs::create_dir_all(&staging_root)
        .map_err(|e| format!("PDFジョブ用一時フォルダを作成できません: {}", e))?;
    let merged_dir = staging_root.join("merged_pdf");
    fs::create_dir_all(&merged_dir)
        .map_err(|e| format!("PDF一時フォルダを作成できません: {}", e))?;

    let output_path = output_root
        .join(format!("{}.pdf", sanitize_filename(&output_name)))
        .to_string_lossy()
        .to_string();

    let mut staged_pages: Vec<(usize, usize, TachimiPdfChapter, TachimiPdfPage)> = Vec::new();
    for (chapter_index, chapter) in chapters.iter().enumerate() {
        emit_tachimi_pdf_progress(
            app_handle,
            "stage",
            format!("「{}」をPDFに追加しています", chapter.name),
            chapter_index,
            chapters.len().max(1),
            false,
        );
        if chapter.pages.is_empty() && chapter.chapter_type.as_deref() == Some("blank") {
            staged_pages.push((
                chapter_index,
                0,
                chapter.clone(),
                TachimiPdfPage {
                    source_path: None,
                    page_type: "blank".to_string(),
                    options: None,
                },
            ));
        } else {
            for (page_index, page) in chapter.pages.iter().enumerate() {
                staged_pages.push((chapter_index, page_index, chapter.clone(), page.clone()));
            }
        }
    }

    if staged_pages.is_empty() {
        return Err("PDF化できるページがありません。".to_string());
    }

    let mut source_dimensions: Vec<Option<(u32, u32)>> = Vec::with_capacity(staged_pages.len());
    for (_, _, _, page) in &staged_pages {
        let dims = page.source_path.as_deref().and_then(|p| {
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
    let mut results: Vec<TachimiPdfJobItemResult> = Vec::new();
    for (global_index, (chapter_index, page_index, chapter, page)) in
        staged_pages.iter().enumerate()
    {
        let page_no = global_index + 1;

        if let Some(source_path) = page.source_path.as_deref() {
            let src = Path::new(source_path);
            if src.exists() {
                let ext = src
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("jpg")
                    .to_lowercase();
                let file_name = format!(
                    "{:04}_c{:03}_p{:04}.{}",
                    page_no,
                    chapter_index + 1,
                    page_index + 1,
                    ext
                );
                let dest = merged_dir.join(&file_name);
                link_or_copy_file(src, &dest)?;
                files.push(file_name);
                continue;
            }
        }

        if page.page_type == "file" {
            results.push(TachimiPdfJobItemResult {
                output_path: output_path.clone(),
                success: false,
                error: Some(format!(
                    "{} の {} ページ目の参照ファイルが見つかりません",
                    chapter.name,
                    page_index + 1
                )),
            });
            continue;
        }

        let size = source_dimensions[..global_index]
            .iter()
            .rev()
            .flatten()
            .next()
            .copied()
            .or_else(|| {
                source_dimensions[global_index + 1..]
                    .iter()
                    .flatten()
                    .next()
                    .copied()
            })
            .unwrap_or(default_size);
        let file_name = format!(
            "{:04}_c{:03}_p{:04}.jpg",
            page_no,
            chapter_index + 1,
            page_index + 1
        );
        let dest = merged_dir.join(&file_name);
        create_blank_jpeg(size.0, size.1, &dest)?;
        files.push(file_name);
    }

    if files.is_empty() {
        let first_error = results
            .iter()
            .find_map(|r| r.error.clone())
            .unwrap_or_else(|| "PDF化できるページがありません。".to_string());
        return Err(first_error);
    }

    emit_tachimi_pdf_progress(
        app_handle,
        "generate",
        "PDFを生成しています".to_string(),
        0,
        files.len(),
        true,
    );

    let mut tachimi_results = run_tachimi_pdf_job_batch(
        &exe_path,
        &staging_root,
        vec![TachimiPdfJobItem {
            input_folder: merged_dir.to_string_lossy().to_string(),
            output_path: output_path.clone(),
            files,
            options: build_tachimi_pdf_options(is_spread),
        }],
    )?;
    tachimi_results.append(&mut results);
    let results = tachimi_results;
    let generated = results.iter().filter(|r| r.success).count();

    if generated == 0 {
        let first_error = results
            .iter()
            .find_map(|r| r.error.clone())
            .unwrap_or_else(|| "Tachimi PDF生成に失敗しました。".to_string());
        return Err(first_error);
    }

    emit_tachimi_pdf_progress(
        app_handle,
        "complete",
        "1つのPDFを生成しました".to_string(),
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

fn run_tachimi_pdf_job_batch(
    exe_path: &str,
    staging_root: &Path,
    jobs: Vec<TachimiPdfJobItem>,
) -> Result<Vec<TachimiPdfJobItemResult>, String> {
    let job_path = staging_root.join("tachimi_pdf_job.json");
    let result_path = staging_root.join("tachimi_pdf_result.json");
    let batch = TachimiPdfJobBatch {
        jobs,
        result_path: result_path.to_string_lossy().to_string(),
    };

    let job_json = serde_json::to_string_pretty(&batch)
        .map_err(|e| format!("PDFジョブJSONを作成できません: {}", e))?;
    fs::write(&job_path, job_json).map_err(|e| format!("PDFジョブJSONを書き込めません: {}", e))?;

    let mut child = Command::new(exe_path)
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
            return Err("Tachimi PDF生成がタイムアウトしました。".to_string());
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
    let result_file: TachimiPdfJobResultFile = serde_json::from_str(&result_json)
        .map_err(|e| format!("Tachimi PDFジョブ結果を解析できません: {}", e))?;

    Ok(result_file.results)
}
