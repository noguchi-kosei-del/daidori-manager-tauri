//! パス検証・許可リスト（手順書 02_/12_ §2 準拠）。
//! すべてのファイル読み書きは ensure_*_path を通す: canonical化 → 保護パス拒否 → 許可リスト照合。
//! 許可ルート = アプリ内部(temp/cache) / ホーム標準 / 業務固定(G:) / 利用者選択(grant) のみ。

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const FORBIDDEN_PATH: &str = "forbidden path";
const APP_NAME: &str = "daidori-manager";

static ALLOWED_ROOTS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

const USER_FOLDERS: &[&str] = &[
    "Documents", "Desktop", "Downloads", "Pictures", "Videos", "Music",
    "Contacts", "Favorites", "Links", "Searches", "Saved Games",
];
/// 業務で使う共有ドライブ固定フォルダ（更新置き場・JSONフォルダ・PDF読み取り）。直書き。
const BUSINESS_PATHS: &[&str] = &[
    r"G:\共有ドライブ\CLLENN\編集部フォルダ\編集企画部\編集企画_C班(AT業務推進)\DTP制作部\更新置き場",
    r"G:\共有ドライブ\CLLENN\編集部フォルダ\編集企画部\編集企画_C班(AT業務推進)\DTP制作部\JSONフォルダ",
    r"G:\共有ドライブ\ソニーからのデータ受領\編集企画_AT業務推進\DTP制作部\Daiwari PDF",
];

pub fn app_temp_dir() -> PathBuf {
    std::env::temp_dir().join(APP_NAME)
}

/// 一時データのカテゴリ別サブフォルダを返す（無ければ作成）。
/// 例: `update`(更新インストーラ) / `convert`(Photoshop連携) / `pdf`(PDF中間) / `work`(EPUB・Tachimi作業)。
/// 一時ファイルを分類して管理しやすくするための区分け。
pub fn temp_subdir(category: &str) -> PathBuf {
    let dir = app_temp_dir().join(category);
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 起動時に前回セッションの残存一時ファイルを掃除（best-effort・使用中はスキップ）。
/// `%TEMP%\daidori-manager` 配下は再生成可能な一時データのみのため全削除して問題ない
/// （サムネイル/ pdfium キャッシュは %LOCALAPPDATA% 側で対象外）。掃除後にカテゴリdirを作り直す。
pub fn cleanup_temp_on_startup() {
    let root = app_temp_dir();
    let _ = fs::create_dir_all(&root);
    if let Ok(entries) = fs::read_dir(&root) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                let _ = fs::remove_dir_all(&p);
            } else {
                let _ = fs::remove_file(&p);
            }
        }
    }
    // 旧バージョンで %TEMP% 直下に散在していた作業dirを後始末（best-effort）
    let t = std::env::temp_dir();
    for old in [
        "daidori_tachimi_pdf_jobs",
        "daidori_tachimi_capability_check",
        "daidori_tachimi_pdf_jpeg",
    ] {
        let _ = fs::remove_dir_all(t.join(old));
    }
    for c in ["update", "convert", "pdf", "work"] {
        let _ = fs::create_dir_all(root.join(c));
    }
}

pub fn harden_temp_dir() {
    static DONE: OnceLock<()> = OnceLock::new();
    let _ = DONE.get_or_init(|| {
        let dir = app_temp_dir();
        let _ = fs::create_dir_all(&dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            if let Ok(user) = std::env::var("USERNAME") {
                let _ = std::process::Command::new("icacls")
                    .arg(&dir)
                    .args([
                        "/inheritance:r",
                        "/grant:r",
                        &format!("{}:(OI)(CI)F", user),
                        "/grant:r",
                        "SYSTEM:(OI)(CI)F",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }
    });
}

pub fn init() {
    let _ = roots();
}

fn roots() -> &'static Mutex<HashSet<PathBuf>> {
    ALLOWED_ROOTS.get_or_init(|| {
        let mut set = HashSet::new();
        add_default_root(&mut set, app_temp_dir(), true);
        if let Ok(lad) = std::env::var("LOCALAPPDATA") {
            add_default_root(&mut set, Path::new(&lad).join(APP_NAME), true);
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            add_default_root(&mut set, Path::new(&appdata).join(APP_NAME), true);
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            let home = Path::new(&home);
            for name in USER_FOLDERS {
                add_default_root(&mut set, home.join(name), false);
            }
            add_default_root(&mut set, home.join("Desktop").join("Script_Output"), false);
            if let Ok(entries) = fs::read_dir(home) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        if let Some(n) = p.file_name().and_then(|n| n.to_str()) {
                            if n.starts_with("OneDrive") {
                                add_default_root(&mut set, p, false);
                            }
                        }
                    }
                }
            }
        }
        for p in BUSINESS_PATHS {
            add_default_root(&mut set, PathBuf::from(p), false);
        }
        Mutex::new(set)
    })
}

fn add_default_root(set: &mut HashSet<PathBuf>, path: PathBuf, create: bool) {
    if create {
        let _ = fs::create_dir_all(&path);
    }
    if let Ok(canon) = fs::canonicalize(&path) {
        set.insert(canon);
    }
}

/// 利用者がダイアログ/D&D で選んだ場所を許可リストへ動的追加（ファイルなら親フォルダ）。
pub fn grant_user_path(path: impl AsRef<Path>) -> Result<(), String> {
    let path = path.as_ref();
    let root = if path.exists() {
        let canon = canonicalize_existing(path)?;
        if canon.is_file() {
            canon.parent().ok_or_else(|| FORBIDDEN_PATH.to_string())?.to_path_buf()
        } else {
            canon
        }
    } else {
        canonicalize_existing(path.parent().ok_or_else(|| FORBIDDEN_PATH.to_string())?)?
    };
    reject_protected_path(&root)?;
    roots().lock().map_err(|_| FORBIDDEN_PATH.to_string())?.insert(root);
    Ok(())
}

pub fn ensure_read_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let canon = canonicalize_existing(path.as_ref())?;
    reject_protected_path(&canon)?;
    ensure_allowed(&canon)?;
    Ok(canon)
}

pub fn ensure_directory_read_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let canon = ensure_read_path(path)?;
    if !canon.is_dir() {
        return Err(FORBIDDEN_PATH.to_string());
    }
    Ok(canon)
}

pub fn ensure_write_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = path.as_ref();
    let target = if path.exists() {
        canonicalize_existing(path)?
    } else {
        canonicalize_for_new_path(path)?
    };
    reject_protected_path(&target)?;
    ensure_allowed(&target)?;
    Ok(target)
}

pub fn validate_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty() || file_name.trim() != file_name || file_name.ends_with('.') {
        return Err(FORBIDDEN_PATH.to_string());
    }
    if file_name == "." || file_name == ".." || file_name.contains('\\') || file_name.contains('/') {
        return Err(FORBIDDEN_PATH.to_string());
    }
    if file_name.chars().any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err(FORBIDDEN_PATH.to_string());
    }
    let stem = file_name.split('.').next().unwrap_or(file_name).to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem.strip_prefix("COM").and_then(|n| n.parse::<u8>().ok()).map(|n| (1..=9).contains(&n)).unwrap_or(false)
        || stem.strip_prefix("LPT").and_then(|n| n.parse::<u8>().ok()).map(|n| (1..=9).contains(&n)).unwrap_or(false);
    if reserved {
        return Err(FORBIDDEN_PATH.to_string());
    }
    Ok(())
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|_| FORBIDDEN_PATH.to_string())
}

fn canonicalize_for_new_path(path: &Path) -> Result<PathBuf, String> {
    let mut missing = Vec::new();
    let mut cursor = path;
    while !cursor.exists() {
        let name = cursor.file_name().and_then(|n| n.to_str()).ok_or_else(|| FORBIDDEN_PATH.to_string())?;
        validate_file_name(name)?;
        missing.push(name.to_string());
        cursor = cursor.parent().ok_or_else(|| FORBIDDEN_PATH.to_string())?;
    }
    let mut canon = canonicalize_existing(cursor)?;
    for name in missing.iter().rev() {
        canon.push(name);
    }
    Ok(canon)
}

fn ensure_allowed(canon: &Path) -> Result<(), String> {
    let guard = roots().lock().map_err(|_| FORBIDDEN_PATH.to_string())?;
    if guard.iter().any(|root| canon == root || canon.starts_with(root)) {
        return Ok(());
    }
    Err(FORBIDDEN_PATH.to_string())
}

fn reject_protected_path(path: &Path) -> Result<(), String> {
    if is_drive_root(path) || is_user_home_root(path) || is_under_system_root(path) {
        return Err(FORBIDDEN_PATH.to_string());
    }
    Ok(())
}

fn is_drive_root(path: &Path) -> bool {
    path.parent().is_none()
        || path.components().filter(|c| !matches!(c, Component::Prefix(_) | Component::RootDir)).count() == 0
}

fn is_user_home_root(path: &Path) -> bool {
    std::env::var("USERPROFILE").ok().and_then(|h| fs::canonicalize(h).ok()).map(|h| path == h).unwrap_or(false)
}

fn is_under_system_root(path: &Path) -> bool {
    let mut protected = Vec::new();
    for var in ["WINDIR", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
        if let Ok(v) = std::env::var(var) {
            if let Ok(c) = fs::canonicalize(v) {
                protected.push(c);
            }
        }
    }
    protected.iter().any(|root| path == root || path.starts_with(root))
}

/// フロント（ダイアログ選択・JS由来D&D）から得たパスを許可リストへ登録する。
/// OS選択/実D&D由来の正規パスを想定。保護パスは拒否（XSS時の悪用は reject_protected_path で緩和）。
#[tauri::command]
pub fn register_paths(paths: Vec<String>) -> Result<(), String> {
    for p in &paths {
        let _ = grant_user_path(p);
    }
    Ok(())
}
