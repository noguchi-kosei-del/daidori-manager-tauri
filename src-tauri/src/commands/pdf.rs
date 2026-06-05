use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use pdfium_render::prelude::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::native_jpeg::jpeg::write_jpeg_mozjpeg_to_file;
use crate::types::FileInfo;

const TARGET_DPI: f32 = 350.0;
const JPEG_QUALITY: f32 = 95.0;
const MAX_PAGES: usize = 300;
const SIDECAR_NAME: &str = ".daiwari-pdf-meta.json";

#[derive(Serialize, Deserialize)]
struct SidecarMeta {
    pdf_path: String,
    pdf_size: u64,
    pdf_mtime_ns: u128,
    page_count: usize,
    dpi: u32,
    encoder: String,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    phase: String,
    current: usize,
    total: usize,
    #[serde(rename = "pdfName")]
    pdf_name: String,
}

fn emit_progress(app: &AppHandle, phase: &str, current: usize, total: usize, pdf_name: &str) {
    let _ = app.emit(
        "pdf-rasterize-progress",
        ProgressPayload {
            phase: phase.to_string(),
            current,
            total,
            pdf_name: pdf_name.to_string(),
        },
    );
}

fn mtime_ns(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

// ===== pdfium.dll 取得・配置（G:\共有ドライブ自動コピー） =====

/// ローカルキャッシュの pdfium.dll 配置先（%LOCALAPPDATA%\daidori-manager\binaries\pdfium.dll）
fn local_pdfium_cache_path() -> Option<PathBuf> {
    dirs::cache_dir().map(|d| {
        d.join("daidori-manager")
            .join("binaries")
            .join("pdfium.dll")
    })
}

/// 共有ドライブ（G:）上の pdfium.dll 候補パス。
/// montblanc の `install-ai-models.ps1` と同様、Google Drive 共有ドライブ
/// 配下に配置されている想定。優先順位:
///   1. ソニーからのデータ受領\…\DTP制作部\Daiwari PDF\bin\ ← bblanchon アーカイブ展開時
///   2. ソニーからのデータ受領\…\DTP制作部\Daiwari PDF\ ← DLL のみ平置きした場合
///   3. 編集企画_AT業務推進\DTP制作部 直下（フォールバック）
///   4. 編集企画_AT業務推進\DTP制作部\Daiwari Manager\（旧運用想定）
///   5. 編集企画_AT業務推進\DTP制作部\daidori-manager\（英字運用想定）
fn shared_pdfium_candidates() -> Vec<PathBuf> {
    let sony_daiwari = PathBuf::from(
        r"G:\共有ドライブ\ソニーからのデータ受領\編集企画_AT業務推進\DTP制作部\Daiwari PDF",
    );
    let direct_dtp = PathBuf::from(r"G:\共有ドライブ\編集企画_AT業務推進\DTP制作部");
    vec![
        sony_daiwari.join("bin").join("pdfium.dll"),
        sony_daiwari.join("pdfium.dll"),
        direct_dtp.join("pdfium.dll"),
        direct_dtp.join("Daiwari Manager").join("pdfium.dll"),
        direct_dtp.join("daidori-manager").join("pdfium.dll"),
    ]
}

/// G: ドライブから pdfium.dll をローカルキャッシュにコピーする。
/// コピー成功時はキャッシュ側のパスを返す。
/// 共有先候補がいずれもアクセス不能ならエラー。
fn fetch_pdfium_from_shared(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    let cache_path = local_pdfium_cache_path()
        .ok_or_else(|| "ローカルキャッシュディレクトリが取得できません".to_string())?;

    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("キャッシュフォルダ作成失敗: {}: {}", parent.display(), e))?;
    }

    for src in shared_pdfium_candidates() {
        if !src.exists() {
            continue;
        }
        if file_size(&src) < 1024 * 1024 {
            // 共有先にも壊れたファイルがある可能性。スキップして次へ
            continue;
        }
        if let Some(app) = app {
            emit_dll_progress(app, "fetching", 0, 1, &src);
        }
        fs::copy(&src, &cache_path).map_err(|e| {
            format!(
                "pdfium.dll のコピーに失敗 ({} → {}): {}",
                src.display(),
                cache_path.display(),
                e
            )
        })?;
        if let Some(app) = app {
            emit_dll_progress(app, "fetched", 1, 1, &src);
        }
        return Ok(cache_path);
    }

    Err(format!(
        "pdfium.dll が見つかりません。\n\
         G:\\共有ドライブ\\ソニーからのデータ受領\\編集企画_AT業務推進\\DTP制作部\\Daiwari PDF\\bin\\pdfium.dll \n\
         が存在するか確認するか、手動で {} に配置してください。\n\
         （Visual C++ ランタイムが必要）",
        cache_path.display()
    ))
}

fn emit_dll_progress(app: &AppHandle, phase: &str, current: usize, total: usize, src: &Path) {
    let label = src.display().to_string();
    let _ = app.emit(
        "pdf-rasterize-progress",
        ProgressPayload {
            phase: phase.to_string(),
            current,
            total,
            pdf_name: label,
        },
    );
}

/// 1MB 以上で有効な pdfium.dll を返す既存パスを探す
fn find_existing_pdfium() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = exe_dir {
        candidates.push(dir.join("pdfium.dll"));
        candidates.push(dir.join("resources").join("binaries").join("pdfium.dll"));
    }
    if let Some(local) = local_pdfium_cache_path() {
        candidates.push(local);
    }
    // 開発時 (cargo run / npm run tauri dev) のフォールバック
    candidates.push(PathBuf::from("binaries").join("pdfium.dll"));
    candidates.push(PathBuf::from("../src-tauri/binaries/pdfium.dll"));
    candidates.push(PathBuf::from("src-tauri/binaries/pdfium.dll"));

    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        // プレースホルダ検出: 本物のpdfium.dllは数MB
        if file_size(&candidate) < 1024 * 1024 {
            continue;
        }
        return Some(candidate);
    }
    None
}

/// pdfium.dll を読み込んで Pdfium インスタンスを作成する
///
/// Pdfium は `Send` ではないため、呼び出しごとに（spawn_blocking スレッド内で）
/// 生成する。DLL ロード自体は OS がキャッシュするため繰り返しオーバヘッドは
/// 数十ms 程度で、レンダリング時間に比べて無視できる。
///
/// 読み込み順序:
///   1. 既存のローカル候補（exe 同階層 / resources / cache / dev binaries）
///   2. 見つからなければ G:\共有ドライブ から自動コピー → 再試行
///   3. それでも駄目ならシステムライブラリ
fn create_pdfium(app: Option<&AppHandle>) -> Result<Pdfium, String> {
    // 1) 既存配置済みの DLL を探す
    if let Some(path) = find_existing_pdfium() {
        return Pdfium::bind_to_library(path.to_string_lossy().as_ref())
            .map(Pdfium::new)
            .map_err(|e| format!("pdfium.dll の読み込みに失敗: {:?}", e));
    }

    // 2) 共有ドライブから取得を試行
    match fetch_pdfium_from_shared(app) {
        Ok(cached) => {
            return Pdfium::bind_to_library(cached.to_string_lossy().as_ref())
                .map(Pdfium::new)
                .map_err(|e| format!("pdfium.dll の読み込みに失敗: {:?}", e));
        }
        Err(fetch_err) => {
            // 3) 最終フォールバック: システムライブラリ
            return Pdfium::bind_to_system_library()
                .map(Pdfium::new)
                .map_err(|sys_err| {
                    format!("{}\nシステムライブラリも未検出: {:?}", fetch_err, sys_err)
                });
        }
    }
}

fn sanitize_stem(stem: &str) -> String {
    // Windows禁止文字を除去
    stem.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect()
}

fn make_output_dir(pdf_path: &Path) -> Result<PathBuf, String> {
    let parent = pdf_path
        .parent()
        .ok_or_else(|| "PDFの親フォルダが取得できません".to_string())?;
    let stem = pdf_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "PDFのファイル名が取得できません".to_string())?;
    let safe_stem = sanitize_stem(stem);
    let dir = parent.join(format!("{}_pages", safe_stem));
    fs::create_dir_all(&dir).map_err(|e| format!("出力フォルダ作成失敗: {}", e))?;
    Ok(dir)
}

fn jpeg_name(index: usize) -> String {
    format!("p{:04}.jpg", index + 1)
}

fn collect_existing_jpegs(dir: &Path, count: usize) -> Option<Vec<PathBuf>> {
    let mut paths = Vec::with_capacity(count);
    for i in 0..count {
        let p = dir.join(jpeg_name(i));
        if !p.exists() {
            return None;
        }
        paths.push(p);
    }
    Some(paths)
}

fn read_sidecar(dir: &Path) -> Option<SidecarMeta> {
    let path = dir.join(SIDECAR_NAME);
    let bytes = fs::read(&path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_sidecar(dir: &Path, meta: &SidecarMeta) -> Result<(), String> {
    let path = dir.join(SIDECAR_NAME);
    let json = serde_json::to_vec_pretty(meta)
        .map_err(|e| format!("サイドカーメタの書き出しに失敗: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("サイドカーメタの保存に失敗: {}", e))?;
    Ok(())
}

fn build_file_info(path: &Path) -> FileInfo {
    let meta = fs::metadata(path);
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .as_ref()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    FileInfo {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
        size,
        modified_time: mtime,
        file_type: "jpg".to_string(),
    }
}

/// 1つのPDFをラスタライズしてJPEG群に展開する
#[tauri::command]
pub async fn rasterize_pdf(
    pdf_path: String,
    app_handle: AppHandle,
) -> Result<Vec<FileInfo>, String> {
    let pdf_path_owned = pdf_path.clone();
    tokio::task::spawn_blocking(move || rasterize_pdf_blocking(&pdf_path_owned, &app_handle))
        .await
        .map_err(|e| format!("ラスタライズタスクの実行に失敗: {}", e))?
}

fn rasterize_pdf_blocking(pdf_path: &str, app: &AppHandle) -> Result<Vec<FileInfo>, String> {
    let path = Path::new(pdf_path);
    if !path.exists() || !path.is_file() {
        return Err(format!("PDFファイルが見つかりません: {}", pdf_path));
    }

    let pdf_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| pdf_path.to_string());

    emit_progress(app, "loading", 0, 0, &pdf_name);

    let out_dir = make_output_dir(path)?;
    let pdf_size = file_size(path);
    let pdf_mtime = mtime_ns(path);

    let pdfium = create_pdfium(Some(app))?;

    let raw_pages: Vec<(u32, u32, Vec<u8>)>;
    let page_count: usize;
    {
        let document = pdfium
            .load_pdf_from_file(path, None)
            .map_err(classify_load_error)?;

        page_count = document.pages().len() as usize;
        if page_count == 0 {
            return Err("PDFにページがありません".to_string());
        }
        if page_count > MAX_PAGES {
            return Err(format!(
                "ページ数が多すぎます: {} ページ（上限 {} ページ）",
                page_count, MAX_PAGES
            ));
        }

        // キャッシュチェック: サイドカー一致 & 全JPEGが揃っていればスキップ
        if let Some(existing) = collect_existing_jpegs(&out_dir, page_count) {
            if let Some(meta) = read_sidecar(&out_dir) {
                if meta.pdf_size == pdf_size
                    && meta.pdf_mtime_ns == pdf_mtime
                    && meta.page_count == page_count
                    && (meta.dpi as f32 - TARGET_DPI).abs() < 0.5
                {
                    emit_progress(app, "done", page_count, page_count, &pdf_name);
                    return Ok(existing.iter().map(|p| build_file_info(p)).collect());
                }
            }
        }

        // ステップ1: 直列レンダリング（pdfium-render の thread_safe は内部 mutex で並列化メリットなし）
        emit_progress(app, "rendering", 0, page_count, &pdf_name);

        let mut acc: Vec<(u32, u32, Vec<u8>)> = Vec::with_capacity(page_count);
        for (idx, page) in document.pages().iter().enumerate() {
            let width_pts = page.width().value;
            let height_pts = page.height().value;
            let scale = TARGET_DPI / 72.0;
            let target_w = (width_pts * scale).round().max(1.0) as i32;
            let target_h = (height_pts * scale).round().max(1.0) as i32;

            let config = PdfRenderConfig::new()
                .set_target_width(target_w)
                .set_target_height(target_h);

            let bitmap = page
                .render_with_config(&config)
                .map_err(|e| format!("ページ {} のレンダリングに失敗: {:?}", idx + 1, e))?;

            let dyn_image = bitmap.as_image();
            let rgb = dyn_image.to_rgb8();
            let (w, h) = rgb.dimensions();
            acc.push((w, h, rgb.into_raw()));

            emit_progress(app, "rendering", idx + 1, page_count, &pdf_name);
        }
        raw_pages = acc;
        // document はここで drop され pdfium インスタンスを解放
    }
    drop(pdfium);

    // ステップ2: 並列 MozJPEG エンコード & ファイル書き出し
    emit_progress(app, "encoding", 0, page_count, &pdf_name);
    let out_dir_arc = out_dir.clone();
    let pdf_name_arc = pdf_name.clone();
    let app_arc = app.clone();
    let done = std::sync::atomic::AtomicUsize::new(0);

    let encode_result: Result<Vec<PathBuf>, String> = raw_pages
        .par_iter()
        .enumerate()
        .map(|(idx, (w, h, rgb))| -> Result<PathBuf, String> {
            let out_path = out_dir_arc.join(jpeg_name(idx));
            write_jpeg_mozjpeg_to_file(rgb, *w, *h, JPEG_QUALITY, &out_path)
                .map_err(|e| format!("ページ {} の JPEG エンコードに失敗: {}", idx + 1, e))?;
            let n = done.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            emit_progress(&app_arc, "encoding", n, page_count, &pdf_name_arc);
            Ok(out_path)
        })
        .collect();

    let written = encode_result?;

    // サイドカー保存
    let _ = write_sidecar(
        &out_dir,
        &SidecarMeta {
            pdf_path: pdf_path.to_string(),
            pdf_size,
            pdf_mtime_ns: pdf_mtime,
            page_count,
            dpi: TARGET_DPI as u32,
            encoder: format!("mozjpeg-q{}", JPEG_QUALITY as u32),
        },
    );

    emit_progress(app, "done", page_count, page_count, &pdf_name);
    Ok(written.iter().map(|p| build_file_info(p)).collect())
}

fn classify_load_error(err: PdfiumError) -> String {
    let msg = format!("{:?}", err);
    if msg.to_lowercase().contains("password") {
        "パスワード保護されたPDFは読み込めません".to_string()
    } else {
        format!("PDFの読み込みに失敗しました: {}", msg)
    }
}
