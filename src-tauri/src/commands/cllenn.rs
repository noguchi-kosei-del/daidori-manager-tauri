//! CLLENN の共有ドライブ上の JSON（縮尺/断ち切り範囲・ぼかし）を参照するコマンド群。
//!
//! JSON は固定フォルダ（共有ドライブ）配下に「レーベル別フォルダ → 作品名.json」で置かれている。
//! 各 JSON の `presetData.selectionRanges[]` に断ち切り範囲(bounds)・基準サイズ(documentSize)・
//! ぼかし半径(blurRadius) が入っており、台割の「JSONの縮尺を利用する」断ち切り方式で使う。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// 縮尺JSONの固定フォルダ（共有ドライブ）。UI で表示し、ここからレーベル/作品を辿る。
pub const CLLENN_JSON_DIR: &str = "G:\\共有ドライブ\\CLLENN\\編集部フォルダ\\編集企画部\\編集企画_C班(AT業務推進)\\DTP制作部\\JSONフォルダ";

/// 固定フォルダのパスを返す（UI 表示用）。
#[tauri::command]
pub fn get_cllenn_json_dir() -> String {
    CLLENN_JSON_DIR.to_string()
}

/// レーベル（直下のサブフォルダ名）一覧を返す。アクセス不可・未接続なら空。
#[tauri::command]
pub fn list_cllenn_labels() -> Result<Vec<String>, String> {
    let dir = Path::new(CLLENN_JSON_DIR);
    if !dir.is_dir() {
        return Err(format!(
            "共有フォルダにアクセスできません（G:ドライブ未接続の可能性）: {}",
            CLLENN_JSON_DIR
        ));
    }
    let mut labels: Vec<String> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("フォルダ読み込みエラー: {}", e))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                // 補助フォルダ（先頭 "_"）は除外
                if !name.starts_with('_') {
                    labels.push(name.to_string());
                }
            }
        }
    }
    labels.sort();
    Ok(labels)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CllennWork {
    pub name: String,
    pub path: String,
}

/// 指定レーベル配下の作品（.json ファイル）一覧を返す。
#[tauri::command]
pub fn list_cllenn_works(label: String) -> Result<Vec<CllennWork>, String> {
    let dir = PathBuf::from(CLLENN_JSON_DIR).join(&label);
    if !dir.is_dir() {
        return Err(format!("レーベルフォルダが見つかりません: {}", label));
    }
    let mut works: Vec<CllennWork> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("フォルダ読み込みエラー: {}", e))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_file() {
            let is_json = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("json"))
                .unwrap_or(false);
            if is_json {
                if let Some(stem) = path.file_stem().and_then(|n| n.to_str()) {
                    // 補助ファイル（先頭 "_"）は除外
                    if !stem.starts_with('_') {
                        works.push(CllennWork {
                            name: stem.to_string(),
                            path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }
    works.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(works)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CllennBounds {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CllennRange {
    pub label: String,
    pub bounds: CllennBounds,
    pub doc_width: f64,
    pub doc_height: f64,
    pub blur_radius: f64,
}

/// 指定した作品 JSON の `presetData.selectionRanges[]` を読み取って返す。
#[tauri::command]
pub fn read_cllenn_ranges(path: String) -> Result<Vec<CllennRange>, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("JSON読み込みエラー: {}", e))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("JSON解析エラー: {}", e))?;

    let ranges = v
        .get("presetData")
        .and_then(|p| p.get("selectionRanges"))
        .and_then(|r| r.as_array())
        .ok_or_else(|| "このJSONには selectionRanges がありません".to_string())?;

    let num = |o: &serde_json::Value, k: &str| -> f64 { o.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0) };

    let mut out: Vec<CllennRange> = Vec::new();
    for (i, r) in ranges.iter().enumerate() {
        let bounds = r.get("bounds");
        let (left, top, right, bottom) = match bounds {
            Some(b) => (num(b, "left"), num(b, "top"), num(b, "right"), num(b, "bottom")),
            None => (0.0, 0.0, 0.0, 0.0),
        };
        // 基準サイズ: documentSize 優先、無ければ size、それも無ければ bounds の右下
        let doc = r.get("documentSize").or_else(|| r.get("size"));
        let (doc_w, doc_h) = match doc {
            Some(d) => (num(d, "width"), num(d, "height")),
            None => (right, bottom),
        };
        let label = r
            .get("label")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("範囲 {}", i + 1));
        let blur_radius = r.get("blurRadius").and_then(|x| x.as_f64()).unwrap_or(0.0);

        out.push(CllennRange {
            label,
            bounds: CllennBounds {
                left,
                top,
                right,
                bottom,
            },
            doc_width: if doc_w > 0.0 { doc_w } else { right },
            doc_height: if doc_h > 0.0 { doc_h } else { bottom },
            blur_radius,
        });
    }
    Ok(out)
}
