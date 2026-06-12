use super::photoshop::{
    copy_script_with_bom, create_unique_output_dir, find_photoshop_path, find_script_path,
    get_script_run_path, write_settings_json,
};
use crate::types::{TiffConvertConfig, TiffConvertResponse, TiffResultsWrapper};
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

/// Photoshopがインストールされているかチェック
#[tauri::command]
pub async fn check_photoshop_installed() -> Result<bool, String> {
    Ok(find_photoshop_path().is_some())
}

/// Photoshopを使用してPSDをTIFFに変換
#[tauri::command]
pub async fn run_photoshop_tiff_convert(
    app_handle: tauri::AppHandle,
    config: TiffConvertConfig,
    output_dir: String,
    jpg_output_dir: Option<String>,
) -> Result<TiffConvertResponse, String> {
    let ps_path = find_photoshop_path().ok_or_else(|| {
        "Photoshopが見つかりません。Adobe Photoshopをインストールしてください。".to_string()
    })?;

    // スクリプトパスを取得
    let script_path_str = find_script_path(&app_handle, "tiff_convert.jsx", "TIFF Convert")?;

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("daidori_tiff_settings.json");
    let output_path = temp_dir.join("daidori_tiff_results.json");

    // 既存の結果ファイルを削除
    let _ = fs::remove_file(&output_path);

    // 出力ディレクトリ: 既存の場合は連番で新規作成
    let final_output_dir = create_unique_output_dir(&output_dir, "TIFF Convert")?;

    // JPG出力ディレクトリ: 既存の場合は連番で新規作成
    let final_jpg_output_dir = if let Some(ref jdir) = jpg_output_dir {
        if !jdir.is_empty() {
            let base_path = Path::new(jdir);
            let resolved = if base_path.exists() {
                let base = jdir.clone();
                let mut counter = 1;
                loop {
                    let candidate = format!("{} ({})", base, counter);
                    if !Path::new(&candidate).exists() {
                        break candidate;
                    }
                    counter += 1;
                }
            } else {
                jdir.clone()
            };
            eprintln!("TIFF Convert - JPG Output dir: {}", resolved);
            let _ = fs::create_dir_all(&resolved);
            Some(resolved)
        } else {
            None
        }
    } else {
        None
    };

    // 設定JSONを作成（outputPathを最終出力ディレクトリに書き換え）
    let mut config_with_output = config;

    // アクションセット(.atn)が指定されていれば、ヘッダからセット名を解析して action_set に補完。
    // 解析失敗時はファイル名（拡張子なし）でフォールバック。
    if config_with_output.global_settings.run_action {
        if let Some(atn_path) = config_with_output.global_settings.action_set_path.clone() {
            if !atn_path.is_empty() {
                let set_name = parse_atn_set_name(&atn_path).or_else(|| filename_stem(&atn_path));
                eprintln!("TIFF Convert - Action set '.atn': {} -> set name: {:?}", atn_path, set_name);
                config_with_output.global_settings.action_set = set_name;
            }
        }
    }

    let output_dir_fwd = output_dir.replace('\\', "/");
    let final_dir_fwd = final_output_dir.replace('\\', "/");

    for file_config in &mut config_with_output.files {
        // outputPathを書き換え
        file_config.output_path = file_config
            .output_path
            .replace(&output_dir_fwd, &final_dir_fwd);

        // jpgOutputPathも書き換え
        if let (Some(ref orig_jpg), Some(ref final_jpg)) = (&jpg_output_dir, &final_jpg_output_dir)
        {
            if let Some(ref mut jpg_path) = file_config.jpg_output_path {
                let orig_fwd = orig_jpg.replace('\\', "/");
                let final_fwd = final_jpg.replace('\\', "/");
                *jpg_path = jpg_path.replace(&orig_fwd, &final_fwd);
            }
        }
    }

    // 設定ファイルを書き込み（UTF-8 BOM付き）
    write_settings_json(&settings_path, &config_with_output)?;

    // スクリプトをtempにコピー（UTF-8 BOM付きで書き出し）
    let temp_script = copy_script_with_bom(&script_path_str, "daidori_tiff_convert_temp.jsx")?;
    let script_to_run = get_script_run_path(&temp_script);

    eprintln!("TIFF Convert - Photoshop: {}", ps_path);
    eprintln!("TIFF Convert - Script: {}", script_to_run);

    // Photoshopを起動してスクリプトを実行
    let _child = Command::new(&ps_path)
        .args(["-r", &script_to_run])
        .spawn()
        .map_err(|e| format!("Photoshopの起動に失敗: {}", e))?;

    eprintln!("TIFF Convert - Launched: {} -r {}", ps_path, script_to_run);

    // 結果をポーリング（ハートビートベース）
    let file_count = config_with_output.files.len().max(1);
    let poll_interval_ms: u64 = 500;
    let initial_timeout_secs: u64 = 600; // 10分（PS起動 + 最初のファイル）
    let final_timeout_secs: u64 = 120; // 2分（最後のファイル後）
    let progress_path = temp_dir.join("daidori_tiff_progress.txt");
    let _ = fs::remove_file(&progress_path);
    let mut last_progress = String::new();
    let mut polls_since_progress: u64 = 0;
    let mut all_done = false;

    eprintln!(
        "TIFF Convert - Heartbeat: {}s initial, no timeout during processing, {} files",
        initial_timeout_secs, file_count
    );

    loop {
        // 結果ファイルをチェック
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('{') && content.contains("results") {
                    eprintln!("TIFF Convert output ready");
                    break;
                }
            }
        }

        // 進捗ファイルをチェック（"X/N"形式）
        if let Ok(content) = fs::read_to_string(&progress_path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() && trimmed != last_progress {
                eprintln!("TIFF Convert progress: {}", trimmed);
                last_progress = trimmed.clone();
                polls_since_progress = 0;
                // "X/N"をパースして完了チェック
                if let Some((current, total)) = trimmed.split_once('/') {
                    if let (Ok(c), Ok(t)) = (current.parse::<u64>(), total.parse::<u64>()) {
                        all_done = c >= t && t > 0;
                    }
                }
            }
        }

        polls_since_progress += 1;

        // タイムアウト計算: 最初のハートビート前と全完了後のみ適用
        let timeout_polls = if last_progress.is_empty() {
            (initial_timeout_secs * 1000) / poll_interval_ms
        } else if all_done {
            (final_timeout_secs * 1000) / poll_interval_ms
        } else {
            (1800 * 1000) / poll_interval_ms // 処理中は最大30分
        };

        if polls_since_progress >= timeout_polls {
            if last_progress.is_empty() {
                eprintln!(
                    "TIFF Convert timed out (Photoshopからの応答なし: {}秒)",
                    initial_timeout_secs
                );
            } else {
                eprintln!("TIFF Convert timed out (結果ファイルが書き込まれませんでした)");
            }
            break;
        }

        tokio::time::sleep(std::time::Duration::from_millis(poll_interval_ms)).await;

        if polls_since_progress > 0 && polls_since_progress.is_multiple_of(60) {
            eprintln!(
                "Still waiting for Photoshop TIFF convert... ({}s since last progress, {})",
                polls_since_progress * poll_interval_ms / 1000,
                if last_progress.is_empty() {
                    "waiting for start"
                } else {
                    &last_progress
                }
            );
        }
    }

    let _ = fs::remove_file(&progress_path);

    // 結果を読み取り
    if output_path.exists() {
        let results_json =
            fs::read_to_string(&output_path).map_err(|e| format!("結果の読み取りに失敗: {}", e))?;

        let wrapper: TiffResultsWrapper = serde_json::from_str(&results_json)
            .map_err(|e| format!("結果のパースに失敗: {}. JSON: {}", e, results_json))?;

        // 一時ファイルを削除
        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&temp_script);

        // ウィンドウを前面に復帰
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(TiffConvertResponse {
            results: wrapper.results,
            output_dir: final_output_dir,
            jpg_output_dir: final_jpg_output_dir,
        })
    } else {
        let _ = fs::remove_file(&temp_script);
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err(
            "Photoshopが出力ファイルを生成しませんでした。スクリプトが失敗した可能性があります。"
                .to_string(),
        )
    }
}

/// アクションごとの切り抜き想定サイズ（断ち切り座標から逆算した想定原稿サイズ）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtnActionCrop {
    pub name: String,
    /// 切り抜き範囲の右端(px) ≈ 想定原稿幅。切り抜きが無ければ 0
    pub width: u32,
    /// 切り抜き範囲の下端(px) ≈ 想定原稿高さ。切り抜きが無ければ 0
    pub height: u32,
}

/// .atn 解析結果（フロントのドロップダウン用）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtnInfo {
    pub set_name: Option<String>,
    pub actions: Vec<String>,
    /// アクションごとの想定サイズ（サイズ不一致警告用）
    pub action_crops: Vec<AtnActionCrop>,
}

/// .atn ファイルからアクションセット名とアクション名一覧を読み取る。
/// フロントエンドでアクション名をドロップダウン選択させるために使用する。
#[tauri::command]
pub fn read_atn_actions(path: String) -> Result<AtnInfo, String> {
    let bytes = fs::read(&path).map_err(|e| format!(".atnの読み込みに失敗: {}", e))?;
    let set_name = parse_atn_set_name(&path).or_else(|| filename_stem(&path));
    let actions = parse_atn_action_names(&bytes);
    let action_crops = parse_atn_action_crops(&bytes);
    Ok(AtnInfo {
        set_name,
        actions,
        action_crops,
    })
}

/// アクション名とその開始バイト位置（アクションヘッダ位置）の一覧を返す。
/// parse_atn_action_names と同じ検出ロジックだが、各アクションのバイト範囲を切り出すため
/// 位置も保持する。
fn find_action_names_with_pos(bytes: &[u8]) -> Vec<(usize, String)> {
    let n = bytes.len();
    let mut out: Vec<(usize, String)> = Vec::new();
    if n < 16 {
        return out;
    }
    let mut i = 0usize;
    while i + 10 < n {
        if bytes[i] == 0
            && bytes[i + 1] == 0
            && bytes[i + 2] == 0
            && bytes[i + 3] == 0
            && bytes[i + 4] == 0
            && bytes[i + 5] == 0
        {
            let len_off = i + 6;
            let len = u32::from_be_bytes([
                bytes[len_off],
                bytes[len_off + 1],
                bytes[len_off + 2],
                bytes[len_off + 3],
            ]) as usize;
            if (2..=40).contains(&len) {
                let start = len_off + 4;
                let end = start + len * 2;
                if end <= n {
                    let mut units: Vec<u16> = Vec::with_capacity(len);
                    let mut ok = true;
                    for j in 0..len {
                        let o = start + j * 2;
                        let c = u16::from_be_bytes([bytes[o], bytes[o + 1]]);
                        if j == len - 1 && c == 0 {
                        } else if (32..65500).contains(&c) {
                            units.push(c);
                        } else {
                            ok = false;
                            break;
                        }
                    }
                    if ok && units.len() >= 2 {
                        let name = String::from_utf16_lossy(&units)
                            .trim_end_matches('\u{0}')
                            .trim()
                            .to_string();
                        if !name.is_empty() && !out.iter().any(|(_, nm)| nm == &name) {
                            out.push((i, name));
                            i = end;
                            continue;
                        }
                    }
                }
            }
        }
        i += 1;
    }
    out
}

/// バイト範囲内の Crop 記述子から最大の右端/下端(px)を取り出す。
/// 記述子の UnitFloat は [key:4][type:"UntF"][unit:4][double:8] の並びで格納される。
/// 切り抜き座標は key="Rght"/"Btom"、単位 "#Pxl"。リサイズの Wdth/Hght は対象外。
fn max_crop_extent_pixels(data: &[u8]) -> (u32, u32) {
    let mut max_w = 0f64;
    let mut max_h = 0f64;
    let mut p = 4usize;
    while p + 16 <= data.len() {
        if &data[p..p + 4] == b"UntF" && &data[p + 4..p + 8] == b"#Pxl" {
            let key = &data[p - 4..p];
            let val = f64::from_be_bytes([
                data[p + 8],
                data[p + 9],
                data[p + 10],
                data[p + 11],
                data[p + 12],
                data[p + 13],
                data[p + 14],
                data[p + 15],
            ]);
            if val.is_finite() && val > 0.0 && val < 1_000_000.0 {
                if key == b"Rght" && val > max_w {
                    max_w = val;
                }
                if key == b"Btom" && val > max_h {
                    max_h = val;
                }
            }
        }
        p += 1;
    }
    (max_w.round() as u32, max_h.round() as u32)
}

/// アクションごとの切り抜き想定サイズを解析する。
fn parse_atn_action_crops(bytes: &[u8]) -> Vec<AtnActionCrop> {
    let names = find_action_names_with_pos(bytes);
    let mut result = Vec::new();
    for (idx, (start, name)) in names.iter().enumerate() {
        let end = if idx + 1 < names.len() {
            names[idx + 1].0
        } else {
            bytes.len()
        };
        let (w, h) = max_crop_extent_pixels(&bytes[*start..end]);
        result.push(AtnActionCrop {
            name: name.clone(),
            width: w,
            height: h,
        });
    }
    result
}

/// .atn 内のアクション名一覧を解析する。
/// 各アクションはキーボードショートカット無しの場合 6バイトのゼロ（index/shift/command/colorIndex）
/// に続いて UnicodeString 名が来る。この境界を走査して名前を収集する。
fn parse_atn_action_names(bytes: &[u8]) -> Vec<String> {
    let n = bytes.len();
    let mut names: Vec<String> = Vec::new();
    if n < 16 {
        return names;
    }
    let mut i = 0usize;
    while i + 10 < n {
        // 6バイトのゼロ（アクションヘッダ: index2 + shift1 + command1 + colorIndex2）
        if bytes[i] == 0
            && bytes[i + 1] == 0
            && bytes[i + 2] == 0
            && bytes[i + 3] == 0
            && bytes[i + 4] == 0
            && bytes[i + 5] == 0
        {
            let len_off = i + 6;
            let len = u32::from_be_bytes([
                bytes[len_off],
                bytes[len_off + 1],
                bytes[len_off + 2],
                bytes[len_off + 3],
            ]) as usize;
            if (2..=40).contains(&len) {
                let start = len_off + 4;
                let end = start + len * 2;
                if end <= n {
                    let mut units: Vec<u16> = Vec::with_capacity(len);
                    let mut ok = true;
                    for j in 0..len {
                        let o = start + j * 2;
                        let c = u16::from_be_bytes([bytes[o], bytes[o + 1]]);
                        if j == len - 1 && c == 0 {
                            // 末尾ヌルは許容
                        } else if (32..65500).contains(&c) {
                            units.push(c);
                        } else {
                            ok = false;
                            break;
                        }
                    }
                    if ok && units.len() >= 2 {
                        let name = String::from_utf16_lossy(&units)
                            .trim_end_matches('\u{0}')
                            .trim()
                            .to_string();
                        if !name.is_empty() && !names.contains(&name) {
                            names.push(name);
                            i = end;
                            continue;
                        }
                    }
                }
            }
        }
        i += 1;
    }
    names
}

/// Photoshop アクションセット(.atn)ファイルのヘッダからセット名を解析する。
/// ATN形式: [4byte version][4byte 名前長(UTF-16単位数, BE, 終端null含む)][UTF-16BE 名前...]
/// EPUB の Photoshop 変換（srgb_convert）からも同じ補完に再利用するため pub(crate)。
pub(crate) fn parse_atn_set_name(path: &str) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 8 {
        return None;
    }
    // 名前長（UTF-16 コードユニット数。末尾のヌル終端を含む）
    let len = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    if len == 0 || len > 1024 {
        return None;
    }
    let start = 8usize;
    let end = start + len * 2;
    if end > bytes.len() {
        return None;
    }
    let mut units: Vec<u16> = Vec::with_capacity(len);
    let mut i = start;
    while i + 1 < end {
        units.push(u16::from_be_bytes([bytes[i], bytes[i + 1]]));
        i += 2;
    }
    let s = String::from_utf16_lossy(&units);
    let trimmed = s.trim_end_matches('\u{0}').trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// ファイルパスから拡張子を除いたファイル名を取得（.atn セット名のフォールバック用）
pub(crate) fn filename_stem(path: &str) -> Option<String> {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
}
