//! KENBAN（検番・差分比較ツール）連携。
//!
//! JPEG/TIFF 生成の完了後、原稿(PSD)と出力(JPEG/TIFF)のペアを KENBAN に渡して
//! 差分比較画面を開く。COMIC-Bridge の `launch_diff_tool` と同じ CLI 契約
//! （`kenban.exe --diff <mode> <folderA> <folderB> [selectionJsonPath]`）を使うため、
//! KENBAN 側は無改修で受けられる。
//!
//! 原稿は「出力ファイル名に合わせた名前」で単一の一時フォルダへハードリンク（=ステージング）
//! してから渡す。これにより:
//!   1. 複数フォルダの原稿でも単一フォルダに集約され、KENBAN の許可リスト（許可ディレクトリ
//!      配下の prefix 一致）で確実に読める。
//!   2. 出力(filesB)と同じ語幹になり、KENBAN が filesA/filesB をそれぞれ名前順ソートしても
//!      ペアの並びが一致する。

use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// kenban.exe として妥当か（存在 + ファイル名 "kenban(.exe)" の case-insensitive 一致）
fn is_kenban_exe(p: &Path) -> bool {
    if !p.is_file() {
        return false;
    }
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    name == "kenban.exe" || name == "kenban"
}

/// 既知の候補から kenban.exe を探す（hint=前回成功パスを最優先）。
fn find_kenban_exe(hint: Option<&str>) -> Option<PathBuf> {
    if let Some(h) = hint {
        let p = PathBuf::from(h);
        if is_kenban_exe(&p) {
            return Some(p);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    // インストール版（NSIS per-user 既定 = %LOCALAPPDATA%\KENBAN）+ Program Files 系。
    for env_key in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(base) = std::env::var(env_key) {
            let base_path = PathBuf::from(base);
            candidates.push(base_path.join("KENBAN").join("kenban.exe"));
            candidates.push(base_path.join("Programs").join("KENBAN").join("kenban.exe"));
        }
    }

    // デスクトップ直下 / 開発ビルド（保険）。
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Desktop").join("KENBAN").join("kenban.exe"));
        let dev = home
            .join("Desktop")
            .join("KENBAN_開発")
            .join("src-tauri")
            .join("target");
        candidates.push(dev.join("release").join("kenban.exe"));
        candidates.push(dev.join("debug").join("kenban.exe"));
    }

    candidates.into_iter().find(|c| is_kenban_exe(c))
}

/// kenban.exe を自動検出。前回成功パスを hint として優先し、無ければ既知の候補を探索する。
#[tauri::command]
pub async fn detect_kenban_exe(hint: Option<String>) -> Option<String> {
    find_kenban_exe(hint.as_deref()).map(|p| p.to_string_lossy().to_string())
}

/// 比較ペア1件（原稿 → 生成済み出力）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KenbanDiffPair {
    /// 原稿ファイル（PSD 等）の絶対パス
    pub source_path: String,
    /// 生成済み出力（JPEG/TIFF）の絶対パス
    pub output_path: String,
    /// このペア固有のクロップ範囲（ページ別bounds）。未指定なら代表範囲を使う。
    #[serde(default)]
    pub bounds: Option<KenbanBounds>,
}

/// 断ち切り（クロップ）範囲。原稿座標系の絶対ピクセル。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KenbanBounds {
    pub left: i64,
    pub top: i64,
    pub right: i64,
    pub bottom: i64,
}

/// 原稿の画像サイズを読む（PSD/PSB はヘッダ直読、その他は image クレート）。
/// 断ち切りなし時に「全体クロップ範囲」を作るために使う。
fn read_source_dims(path: &Path) -> Option<(u32, u32)> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "psd" || ext == "psb" {
        use std::io::Read;
        let mut f = fs::File::open(path).ok()?;
        let mut header = [0u8; 26];
        f.read_exact(&mut header).ok()?;
        if &header[0..4] != b"8BPS" {
            return None;
        }
        let height = u32::from_be_bytes([header[14], header[15], header[16], header[17]]);
        let width = u32::from_be_bytes([header[18], header[19], header[20], header[21]]);
        if width == 0 || height == 0 {
            return None;
        }
        Some((width, height))
    } else {
        image::image_dimensions(path).ok()
    }
}

fn link_or_copy(src: &Path, dest: &Path) -> Result<(), String> {
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

/// 原稿(PSD)↔出力(JPEG/TIFF) を KENBAN の psd-tiff 差分比較で開く。
///
/// - `output_dir`: 出力フォルダ（folderB）。filesB はこの配下に集まっている前提。
/// - `pairs`: 原稿 → 出力 の対応。原稿は output 名に合わせてステージングする。
/// - `bounds`: 断ち切りクロップ範囲（クロップ系のときのみ。None=全体比較）。
/// - `exe_path`: 既知の kenban.exe（フロントの localStorage ヒント）。無効なら自動検出。
#[tauri::command]
pub async fn launch_kenban_diff(
    output_dir: String,
    pairs: Vec<KenbanDiffPair>,
    bounds: Option<KenbanBounds>,
    exe_path: Option<String>,
) -> Result<(), String> {
    let exe = find_kenban_exe(exe_path.as_deref())
        .ok_or_else(|| "KENBAN の実行ファイル (kenban.exe) が見つかりません。".to_string())?;

    if pairs.is_empty() {
        return Err("KENBAN に渡せる比較ペアがありません。".to_string());
    }

    // ステージング先（ジョブごとに一意な temp。KENBAN には folderA として渡す）。
    let staging_root = crate::security::temp_subdir("work")
        .join("daidori_kenban_src")
        .join(uuid::Uuid::new_v4().simple().to_string());
    let _ = fs::remove_dir_all(&staging_root);
    fs::create_dir_all(&staging_root)
        .map_err(|e| format!("KENBAN 連携用の一時フォルダを作成できません: {}", e))?;

    let mut files_a: Vec<String> = Vec::new();
    let mut files_b: Vec<String> = Vec::new();
    let mut used: HashSet<String> = HashSet::new();
    // ページ別bounds: ステージング後のファイル名（KENBAN 側の file.name）→ クロップ範囲。
    // KENBAN は filesA/filesB を名前順ソートするため、配列インデックスではなくファイル名でひく。
    let mut bounds_by_file = serde_json::Map::new();

    let mut missing_outputs = 0usize;
    for pair in &pairs {
        let src = Path::new(&pair.source_path);
        if !src.is_file() {
            continue;
        }
        // 出力(生成済みJPEG/TIFF)が実在しないペアは渡さない。
        // KENBAN は読めないパスを FORBIDDEN_PATH で弾くため、ここで除外して
        // 「出力が見つからない」を明示エラーにする（cryptic な FORBIDDEN を避ける）。
        if !Path::new(&pair.output_path).is_file() {
            missing_outputs += 1;
            continue;
        }
        let src_ext = src
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("psd")
            .to_lowercase();
        // 出力名の語幹に合わせる → KENBAN が filesA/filesB を名前順ソートしても並びが一致する。
        let out_stem = Path::new(&pair.output_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("page")
            .to_string();
        let mut staged_name = format!("{}.{}", out_stem, src_ext);
        let mut n = 2;
        while !used.insert(staged_name.to_lowercase()) {
            staged_name = format!("{}_{}.{}", out_stem, n, src_ext);
            n += 1;
        }
        let dest = staging_root.join(&staged_name);
        link_or_copy(src, &dest)?;
        files_a.push(dest.to_string_lossy().to_string());
        files_b.push(pair.output_path.clone());
        // このペアのクロップ範囲をステージング名で登録（ページ別bounds）。
        if let Some(b) = &pair.bounds {
            bounds_by_file.insert(
                staged_name.clone(),
                serde_json::json!({ "left": b.left, "top": b.top, "right": b.right, "bottom": b.bottom }),
            );
        }
    }

    if files_a.is_empty() {
        let _ = fs::remove_dir_all(&staging_root);
        if missing_outputs > 0 {
            return Err(format!(
                "生成された出力ファイルが見つかりませんでした（{}件）。出力先が移動・削除されていないか確認してください。",
                missing_outputs
            ));
        }
        return Err("KENBAN に渡せる原稿ファイルが見つかりませんでした。".to_string());
    }

    // 断ち切りクロップ範囲を確定する。
    // KENBAN の psd-tiff 差分は cropBounds(u32) が必須で、selectionRanges を空にすると
    // KENBAN 内部が {right:-1, bottom:-1} のセンチネルを作り u32 コマンドで弾かれる。
    // そのため「断ち切りなし」のときは先頭原稿の全体サイズ {0,0,幅,高さ}=全体クロップ（実質クロップなし）を渡す。
    let effective_bounds = match bounds {
        Some(b) => Some(b),
        None => pairs
            .iter()
            .map(|p| PathBuf::from(&p.source_path))
            .find_map(|p| read_source_dims(&p))
            .map(|(w, h)| KenbanBounds {
                left: 0,
                top: 0,
                right: w as i64,
                bottom: h as i64,
            }),
    };

    // 選択範囲JSON（COMIC-Bridge と同じ形式: selectionRanges / filesA / filesB）。
    let selection_ranges = match &effective_bounds {
        Some(b) => serde_json::json!([{
            "bounds": { "left": b.left, "top": b.top, "right": b.right, "bottom": b.bottom }
        }]),
        None => serde_json::json!([]),
    };
    let payload = serde_json::json!({
        "selectionRanges": selection_ranges,
        "filesA": files_a,
        "filesB": files_b,
        // ページ別bounds（KENBAN が対応していればこちらを優先。未対応なら selectionRanges を使う）。
        "boundsByFile": serde_json::Value::Object(bounds_by_file),
    });

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let json_path = crate::security::temp_subdir("work").join(format!(
        "kenban_diff_selection_{}_{}.json",
        std::process::id(),
        now
    ));
    fs::write(&json_path, payload.to_string())
        .map_err(|e| format!("KENBAN 連携用JSONの書き込みに失敗: {}", e))?;

    // kenban.exe --diff psd-tiff <stagingDir(folderA)> <outputDir(folderB)> <jsonPath>
    // （folderA/folderB/jsonPath は KENBAN 起動時に許可リストへ登録される）
    Command::new(&exe)
        .arg("--diff")
        .arg("psd-tiff")
        .arg(staging_root.to_string_lossy().to_string())
        .arg(&output_dir)
        .arg(json_path.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| format!("KENBAN の起動に失敗: {}", e))?;

    Ok(())
}
