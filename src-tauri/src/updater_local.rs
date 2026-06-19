//! G:共有ドライブからの自動更新（脱github・手順書 03_/12_ §13）。
//! 実行時の更新確認は共有フォルダ 更新置き場\daidori-manager\ だけを見る。信頼基盤は minisign 署名。
//! 更新先・公開鍵はアドレス直書き（割符外付けは終盤フェーズで導入予定）。最終ゲートは minisign 検証。

use serde::Serialize;
use std::path::PathBuf;

const APP_UPDATE_SUBDIR: &str = "daidori-manager";
const UPDATE_LOCAL_DIR: &str =
    r"G:\共有ドライブ\CLLENN\編集部フォルダ\編集企画部\編集企画_C班(AT業務推進)\DTP制作部\App_installer";
/// daidori updater 公開鍵（minisign・二重base64）。秘密鍵は鍵フォルダのみ。
const UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ1N0Y2RTQ4NDRFMjEwMDEKUldRQkVPSkVTRzUvMWVWbHA1MVlxRnZUWmkrdmt0cUFLc3RVQUlsTnZkYVZaVTRLVnBtOEJsbmMK";

#[derive(Serialize, Clone)]
pub struct LocalUpdateInfo {
    pub version: String,
    pub file_name: String,
    pub setup_path: String,
}

fn version_tuple(v: &str) -> Option<(u32, u32, u32)> {
    let mut it = v.split('.');
    let a = it.next()?.parse::<u32>().ok()?;
    let b = it.next()?.parse::<u32>().ok()?;
    let c = it.next()?.parse::<u32>().ok()?;
    if it.next().is_some() {
        return None;
    }
    Some((a, b, c))
}

fn version_from_filename(name: &str) -> Option<String> {
    let stem = name.strip_suffix("_x64-setup.exe")?;
    let ver = stem.rsplit('_').next()?;
    version_tuple(ver).map(|_| ver.to_string())
}

fn app_temp() -> PathBuf {
    std::env::temp_dir().join(APP_UPDATE_SUBDIR)
}

fn resolve_update_dir() -> Result<Option<PathBuf>, String> {
    let base_dir = match std::fs::canonicalize(UPDATE_LOCAL_DIR) {
        Ok(d) if d.is_dir() => d,
        _ => return Ok(None),
    };
    let sub = base_dir.join(APP_UPDATE_SUBDIR);
    if sub.is_dir() {
        Ok(Some(std::fs::canonicalize(&sub).map_err(|_| "解決失敗".to_string())?))
    } else {
        Ok(Some(base_dir))
    }
}

fn verify_minisign(pubkey_b64: &str, sig_file_b64: &str, data: &[u8]) -> Result<(), String> {
    use base64::Engine;
    let dec = |s: &str| base64::engine::general_purpose::STANDARD.decode(s.trim());
    let pk_text = String::from_utf8(dec(pubkey_b64).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let public_key = minisign_verify::PublicKey::decode(pk_text.trim()).map_err(|e| e.to_string())?;
    let sg_text = String::from_utf8(dec(sig_file_b64).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let signature = minisign_verify::Signature::decode(&sg_text).map_err(|e| e.to_string())?;
    public_key
        .verify(data, &signature, true)
        .map_err(|e| format!("署名検証失敗(未署名/改ざん): {}", e))
}

#[tauri::command]
pub async fn check_local_update() -> Result<Option<LocalUpdateInfo>, String> {
    let dir = match resolve_update_dir()? {
        Some(d) => d,
        None => return Ok(None),
    };
    let current = version_tuple(env!("CARGO_PKG_VERSION")).unwrap_or((0, 0, 0));

    let mut best: Option<((u32, u32, u32), String, PathBuf)> = None;
    for entry in std::fs::read_dir(&dir).map_err(|_| "更新置き場を読めません".to_string())? {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with("_x64-setup.exe") {
            continue;
        }
        let Some(ver_str) = version_from_filename(&name) else { continue };
        let Some(ver) = version_tuple(&ver_str) else { continue };
        if ver <= current {
            continue;
        }
        if best.as_ref().map(|(bv, _, _)| ver > *bv).unwrap_or(true) {
            best = Some((ver, ver_str, entry.path()));
        }
    }
    let Some((_, ver_str, setup_path)) = best else { return Ok(None) };

    let sig_path = setup_path.with_file_name(format!(
        "{}.sig",
        setup_path.file_name().and_then(|n| n.to_str()).unwrap_or_default()
    ));
    let exe_bytes = std::fs::read(&setup_path).map_err(|_| "更新ファイルを読めません".to_string())?;
    let sig_text = std::fs::read_to_string(&sig_path).map_err(|_| "署名ファイルがありません".to_string())?;
    verify_minisign(UPDATER_PUBKEY, &sig_text, &exe_bytes)?;

    Ok(Some(LocalUpdateInfo {
        version: ver_str,
        file_name: setup_path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string(),
        setup_path: setup_path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
pub async fn apply_local_update(app: tauri::AppHandle, setup_path: String) -> Result<(), String> {
    let info = check_local_update().await?.ok_or_else(|| "適用可能な更新がありません".to_string())?;
    if PathBuf::from(&setup_path) != PathBuf::from(&info.setup_path) {
        return Err("更新ファイルが一致しません".to_string());
    }
    let src = PathBuf::from(&info.setup_path);

    // 更新インストーラは temp の update カテゴリ配下にステージング（分類管理）。
    let temp = app_temp().join("update");
    std::fs::create_dir_all(&temp).map_err(|_| "temp 作成失敗".to_string())?;
    let local = temp.join(&info.file_name);
    std::fs::copy(&src, &local).map_err(|_| "コピー失敗".to_string())?;
    let sig_src = src.with_file_name(format!("{}.sig", info.file_name));
    let sig_text = std::fs::read_to_string(&sig_src).map_err(|_| "署名ファイルがありません".to_string())?;
    let exe_bytes = std::fs::read(&local).map_err(|_| "更新ファイルを読めません".to_string())?;
    verify_minisign(UPDATER_PUBKEY, &sig_text, &exe_bytes)?;

    std::process::Command::new(&local)
        // /S=サイレント /UPDATE=更新モード。更新後の再起動は NSIS フック(IfSilent+Exec)が担う。
        .args(["/S", "/UPDATE"])
        .current_dir(&temp)
        .spawn()
        .map_err(|_| "更新の起動に失敗しました".to_string())?;
    app.exit(0);
    Ok(())
}
