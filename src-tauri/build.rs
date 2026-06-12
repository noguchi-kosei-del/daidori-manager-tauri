fn main() {
    // Windows: テストexeに comctl32 v6 マニフェストを埋め込む。
    // tao(tauri) が v6 専用の TaskDialogIndirect を静的インポートするため、
    // マニフェスト無しのテストexeは旧 comctl32 が束縛され
    // STATUS_ENTRYPOINT_NOT_FOUND で起動できない（本体exeは tauri-build が埋め込み済み）。
    // rustc-link-arg-tests はテストターゲット限定なので本体ビルドには影響しない。
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
