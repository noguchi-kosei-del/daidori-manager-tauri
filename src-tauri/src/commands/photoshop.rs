use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Photoshopのインストールパスを検索
pub fn find_photoshop_path() -> Option<String> {
    let possible_paths = [
        // Adobe Photoshop 2026
        r"C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe",
        // Adobe Photoshop 2025
        r"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe",
        // Adobe Photoshop 2024
        r"C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe",
        // Adobe Photoshop 2023
        r"C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe",
        // Adobe Photoshop CC 2022
        r"C:\Program Files\Adobe\Adobe Photoshop 2022\Photoshop.exe",
        // Adobe Photoshop CC 2021
        r"C:\Program Files\Adobe\Adobe Photoshop 2021\Photoshop.exe",
        // Adobe Photoshop CC 2020
        r"C:\Program Files\Adobe\Adobe Photoshop 2020\Photoshop.exe",
        // Adobe Photoshop CC 2019
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2019\Photoshop.exe",
        // Adobe Photoshop CC 2018
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2018\Photoshop.exe",
        // Adobe Photoshop CC
        r"C:\Program Files\Adobe\Adobe Photoshop CC\Photoshop.exe",
        // 32bit versions
        r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2025\Photoshop.exe",
        r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2024\Photoshop.exe",
        r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2023\Photoshop.exe",
    ];

    for path in &possible_paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    // 固定リストに無い場合（新バージョン等）は Adobe フォルダを動的スキャン。
    // 例: "Adobe Photoshop 2026" のような新しいバージョンを自動検出する。
    if let Some(found) = scan_adobe_dirs_for_photoshop() {
        return Some(found);
    }

    None
}

/// Adobe インストールフォルダを走査し、`Adobe Photoshop*` 配下の Photoshop.exe を探す。
/// 複数見つかった場合はフォルダ名の降順（=新しいバージョン優先）で選ぶ。
fn scan_adobe_dirs_for_photoshop() -> Option<String> {
    let adobe_roots = [
        r"C:\Program Files\Adobe",
        r"C:\Program Files (x86)\Adobe",
    ];

    let mut candidates: Vec<(String, String)> = Vec::new(); // (フォルダ名, exeパス)

    for root in &adobe_roots {
        let entries = match fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            // "Adobe Photoshop" を含むフォルダのみ対象（Bridge/Acrobat 等は除外）
            if !dir_name.to_lowercase().contains("photoshop") {
                continue;
            }
            let exe = path.join("Photoshop.exe");
            if exe.exists() {
                candidates.push((dir_name, exe.to_string_lossy().to_string()));
            }
        }
    }

    // フォルダ名の降順でソート（"Adobe Photoshop 2026" > "... 2025"）して最新を優先
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().next().map(|(_, exe)| exe)
}

/// リソースディレクトリからスクリプトパスを検索
pub fn find_script_path(
    app_handle: &tauri::AppHandle,
    script_name: &str,
    log_prefix: &str,
) -> Result<String, String> {
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("リソースディレクトリの取得に失敗: {}", e))?;

    eprintln!("{} - Resource dir: {}", log_prefix, resource_path.display());

    // 検索するパスのリスト（優先順位順）
    let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join(script_name);
    let resource_script = resource_path.join("scripts").join(script_name);
    let resource_root_script = resource_path.join(script_name);

    eprintln!("{} - Checking dev script: {} (exists: {})", log_prefix, dev_script.display(), dev_script.exists());
    eprintln!("{} - Checking resource script: {} (exists: {})", log_prefix, resource_script.display(), resource_script.exists());
    eprintln!("{} - Checking resource root script: {} (exists: {})", log_prefix, resource_root_script.display(), resource_root_script.exists());

    let script_path_str = if dev_script.exists() {
        dev_script.to_string_lossy().to_string()
    } else if resource_script.exists() {
        resource_script.to_string_lossy().to_string()
    } else if resource_root_script.exists() {
        resource_root_script.to_string_lossy().to_string()
    } else {
        return Err(format!(
            "スクリプトが見つかりません: {}\n検索パス:\n- {}\n- {}\n- {}",
            script_name,
            dev_script.display(),
            resource_script.display(),
            resource_root_script.display()
        ));
    };

    eprintln!("{} - Using script: {}", log_prefix, script_path_str);
    Ok(script_path_str)
}

/// 出力ディレクトリを作成（既存の場合は連番で新規作成）
pub fn create_unique_output_dir(output_dir: &str, log_prefix: &str) -> Result<String, String> {
    let final_output_dir = {
        let base_path = Path::new(output_dir);
        if base_path.exists() {
            let base = output_dir.to_string();
            let mut counter = 1;
            loop {
                let candidate = format!("{} ({})", base, counter);
                if !Path::new(&candidate).exists() {
                    break candidate;
                }
                counter += 1;
            }
        } else {
            output_dir.to_string()
        }
    };

    fs::create_dir_all(&final_output_dir)
        .map_err(|e| format!("出力ディレクトリの作成に失敗: {}", e))?;

    eprintln!("{} - Output dir: {}", log_prefix, final_output_dir);
    Ok(final_output_dir)
}

/// スクリプトをtempにコピー（UTF-8 BOM付き）
pub fn copy_script_with_bom(
    script_path: &str,
    temp_script_name: &str,
) -> Result<PathBuf, String> {
    use std::io::Write;

    let temp_dir = std::env::temp_dir();
    let temp_script = temp_dir.join(temp_script_name);

    let script_content = fs::read_to_string(script_path)
        .map_err(|e| format!("スクリプトの読み込みに失敗: {} (元: {})", e, script_path))?;

    // UTF-8 BOM + スクリプト内容を書き出し
    let mut script_file = fs::File::create(&temp_script)
        .map_err(|e| format!("スクリプトファイルの作成に失敗: {}", e))?;
    script_file.write_all(&[0xEF, 0xBB, 0xBF])  // UTF-8 BOM
        .map_err(|e| format!("BOM書き込みに失敗: {}", e))?;
    script_file.write_all(script_content.as_bytes())
        .map_err(|e| format!("スクリプト書き込みに失敗: {}", e))?;
    drop(script_file);

    // コピー後の存在確認
    if !temp_script.exists() {
        return Err(format!("スクリプトのコピー後にファイルが見つかりません: {}", temp_script.display()));
    }

    // コピーしたファイルの内容確認
    let copied_size = fs::metadata(&temp_script)
        .map(|m| m.len())
        .unwrap_or(0);
    if copied_size == 0 {
        return Err("スクリプトファイルが空です".to_string());
    }

    Ok(temp_script)
}

/// tempスクリプトのフルパスを取得（8.3形式を回避、\\?\プレフィックスを削除）
pub fn get_script_run_path(temp_script: &Path) -> String {
    let script_to_run = temp_script.canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| temp_script.to_string_lossy().to_string());

    // \\?\ プレフィックスを削除
    script_to_run.strip_prefix(r"\\?\").unwrap_or(&script_to_run).to_string()
}

/// 設定JSONをファイルに書き込み（UTF-8 BOM付き）
pub fn write_settings_json<T: serde::Serialize>(
    settings_path: &Path,
    config: &T,
) -> Result<(), String> {
    use std::io::Write;

    let settings_json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("JSON変換に失敗: {}", e))?;

    let mut settings_file = fs::File::create(settings_path)
        .map_err(|e| format!("設定ファイルの作成に失敗: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("BOM書き込みに失敗: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("設定の書き込みに失敗: {}", e))?;

    Ok(())
}
