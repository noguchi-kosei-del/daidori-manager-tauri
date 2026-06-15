use sha2::{Digest, Sha256};
use std::{fs, path::Path};

fn sha256_hex(path: &Path) -> Option<String> {
    let data = fs::read(path).ok()?;
    let mut h = Sha256::new();
    h.update(&data);
    Some(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

fn main() {
    // ★ 改ざん検知: 同梱 scripts/*.jsx の SHA-256 を exe へ焼き込む（手順書 03_/12_ §5）。
    //   実行時 integrity.rs が Photoshop へ渡す前に照合し、差し替えられた JSX を拒否する。
    let dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let scripts = Path::new(&dir).join("scripts");
    println!("cargo:rerun-if-changed=scripts");
    let mut entries: Vec<(String, String)> = Vec::new();
    if let Ok(read) = fs::read_dir(&scripts) {
        let mut files: Vec<_> = read
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "jsx").unwrap_or(false))
            .collect();
        files.sort();
        for f in files {
            if let (Some(n), Some(h)) = (f.file_name().and_then(|n| n.to_str()), sha256_hex(&f)) {
                entries.push((n.to_string(), h));
            }
        }
    }
    // fail-closed: 1件も無ければビルド中止（空マニフェスト＝ゲート無効化を防ぐ）
    if entries.is_empty() {
        panic!("integrity build: scripts/*.jsx を1件もハッシュ化できませんでした（{}）", scripts.display());
    }
    let out = std::env::var("OUT_DIR").expect("OUT_DIR");
    let mut src = String::from("pub static SCRIPT_HASHES: &[(&str, &str)] = &[\n");
    for (n, h) in &entries {
        src.push_str(&format!("    ({:?}, {:?}),\n", n, h));
    }
    src.push_str("];\n");
    fs::write(Path::new(&out).join("integrity_manifest.rs"), src).expect("write manifest");

    // Windows: テストexeに comctl32 v6 マニフェストを埋め込む（cargo test 起動のため・本体ビルドに影響なし）。
    #[cfg(windows)]
    {
        let manifest = std::env::current_dir()
            .expect("CWD取得失敗")
            .join("tests-manifest.xml");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
        println!("cargo:rerun-if-changed=tests-manifest.xml");
    }
    tauri_build::build()
}
