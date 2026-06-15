use crate::constants::SUPPORTED_EXTENSIONS;
use crate::image_utils::get_file_type;
use crate::types::FileInfo;
use std::fs;
use std::path::Path;

/// 指定フォルダを（親も含めて）作成する。既に存在する場合は何もしない。
/// EPUB/プロジェクトの既定保存先（Script_Output/台割/EPUB・Project 等）を
/// 保存ダイアログ表示前に用意するために使う。
#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    // ダイアログ由来の保存先を許可リストへ → 書込検証（保護パス/ドライブ直下は拒否）
    if let Some(parent) = Path::new(&path).parent() {
        let _ = crate::security::grant_user_path(parent);
    }
    let path = crate::security::ensure_write_path(&path)?;
    fs::create_dir_all(&path).map_err(|e| format!("フォルダ作成エラー: {}", e))
}

#[tauri::command]
pub fn get_folder_contents(folder_path: String) -> Result<Vec<FileInfo>, String> {
    // ダイアログ/D&D で選んだフォルダを許可リストへ → 列挙検証（保護パスは拒否）
    let _ = crate::security::grant_user_path(&folder_path);
    // 検証は正規化パスで（許可リスト/保護パス判定）。ただし戻り値のファイルパスは「元パス」基準で組み立てる。
    // fs::canonicalize は Windows で \\?\ 前置を付けるため、それで列挙するとフロントの
    // imagePaths.includes(f.path) 比較（D&Dイベントの素のパスと突合）が外れ、ファイルD&Dが無反応になる。
    crate::security::ensure_directory_read_path(&folder_path)?;
    let path = Path::new(&folder_path);

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
            .map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64
            })
            .unwrap_or(0);

        files.push(FileInfo {
            path: entry_path.to_string_lossy().to_string(),
            name: entry_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            size: metadata.len(),
            modified_time,
            file_type: file_type.to_string(),
        });
    }

    // ファイル名で自然順ソート
    files.sort_by(|a, b| natord::compare(&a.name, &b.name));

    Ok(files)
}
