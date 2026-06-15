//! 同梱 JSX の改ざん検知（手順書 03_/12_ §6）。build.rs が焼き込んだ期待ハッシュと照合する。
include!(concat!(env!("OUT_DIR"), "/integrity_manifest.rs")); // SCRIPT_HASHES
use sha2::{Digest, Sha256};
use std::path::Path;

fn sha256_file(path: &Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|_| "スクリプトを読めません".to_string())?;
    let mut h = Sha256::new();
    h.update(&data);
    Ok(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

fn expected(name: &str) -> Option<&'static str> {
    SCRIPT_HASHES.iter().find(|(n, _)| *n == name).map(|(_, h)| *h)
}

/// 同梱 JSX のハッシュを期待値と照合（Photoshop へ渡す前に呼ぶ）。
/// 未登録/不一致は実行拒否（fail-closed）。
pub fn verify_script(name: &str, path: &Path) -> Result<(), String> {
    match expected(name) {
        Some(exp) => {
            let actual = sha256_file(path)?;
            if actual.eq_ignore_ascii_case(exp) {
                Ok(())
            } else {
                Err(format!(
                    "整合性NG: {} が改ざん／別ファイルの可能性があります。安全のため処理を中止しました。",
                    name
                ))
            }
        }
        None => Err(format!("整合性NG: 未登録のスクリプト {} は実行できません。", name)),
    }
}
