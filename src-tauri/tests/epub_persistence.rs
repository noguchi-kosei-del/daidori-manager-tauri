// EPUB生成→内部整合性チェックの統合テスト + .daiw epub_state 往復テスト
//
// 注意: テストexeは build.rs が tests-manifest.xml（comctl32 v6）を埋め込む。
// これが無いと tao の TaskDialogIndirect インポートが解決できず
// STATUS_ENTRYPOINT_NOT_FOUND でテストexe自体が起動しない。

use daidori_manager_tauri_lib::commands::epub_verify::verify_internal;
use daidori_manager_tauri_lib::epub::EpubBuilder;
use daidori_manager_tauri_lib::types::{
    AuthorInfo, AuthorRole, EpubFormat, EpubGenerateConfig, EpubImageColorPolicy, EpubMetadata,
    EpubPage, ProjectFile,
};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

fn test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("daidori_epub_verify_test_{}", name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_test_jpeg(path: &Path, w: u32, h: u32) {
    let img = image::RgbImage::from_pixel(w, h, image::Rgb([255u8, 255, 255]));
    img.save(path).unwrap();
}

fn make_metadata(format: EpubFormat) -> EpubMetadata {
    EpubMetadata {
        title: "テスト作品".to_string(),
        title_file_as: Some("テストサクヒン".to_string()),
        authors: vec![AuthorInfo {
            name: "著者A".to_string(),
            file_as: Some("チョシャエー".to_string()),
            role: AuthorRole::Author,
            role_display: None,
        }],
        publisher: "CLLENN".to_string(),
        publisher_file_as: Some("シレン".to_string()),
        language: "ja".to_string(),
        page_direction: Default::default(),
        viewport_width: 1442,
        viewport_height: 2048,
        spread_mode: Default::default(),
        orientation: Default::default(),
        book_uuid: "12345678-1234-1234-1234-123456789abc".to_string(),
        output_format: format,
        allow_missing_colophon: false,
        hybrid_css_profile: Default::default(),
        // テストではICCファイル探索（OS/Adobe依存）に依らない方針を使う
        image_color_policy: EpubImageColorPolicy::NoIcc,
    }
}

fn page(id: &str, filename: &str, source: &Path, is_cover: bool, is_colophon: bool) -> EpubPage {
    EpubPage {
        id: id.to_string(),
        filename: filename.to_string(),
        source_path: source.to_string_lossy().into_owned(),
        width: 100,
        height: 150,
        is_cover,
        is_colophon,
        is_blank: false,
        source_color_mode: Some("RGB".to_string()),
        image_profile_override: Default::default(),
        pre_normalized: false,
    }
}

fn build_epub(format: EpubFormat, dir: &Path) -> String {
    let cover = dir.join("cover_src.jpg");
    let body = dir.join("body_src.jpg");
    let colophon = dir.join("colophon_src.jpg");
    write_test_jpeg(&cover, 100, 150);
    write_test_jpeg(&body, 100, 150);
    write_test_jpeg(&colophon, 100, 150);

    let output_path = dir.join("out.epub");
    let config = EpubGenerateConfig {
        metadata: make_metadata(format),
        pages: vec![
            page("p-cover", "cover.jpg", &cover, true, false),
            page("p-001", "0001.jpg", &body, false, false),
            page("p-colophon", "colophon.jpg", &colophon, false, true),
        ],
        output_path: output_path.to_string_lossy().into_owned(),
        custom_css: None,
    };
    let resp = EpubBuilder::new(config).build().expect("EPUB build failed");
    assert!(resp.success, "EPUB build response error: {:?}", resp.error);
    output_path.to_string_lossy().into_owned()
}

// EpubBuilderの実出力（3形式）が内部整合性チェックを通ること。
// 生成器とチェッカー双方の回帰をまとめて検出する（テンプレート変更で参照がズレたら落ちる）。
#[test]
fn built_epub_passes_internal_verify_for_all_formats() {
    for (name, format) in [
        ("kadokawa", EpubFormat::Kadokawa),
        ("hybrid", EpubFormat::Hybrid),
        ("oebps", EpubFormat::Oebps),
    ] {
        let dir = test_dir(name);
        let epub_path = build_epub(format, &dir);
        let result = verify_internal(&epub_path);
        assert!(
            result.errors.is_empty(),
            "{}: 予期しないエラー: {:?}",
            name,
            result.errors
        );
        assert!(result.is_valid, "{}: is_valid であるべき", name);
        let _ = fs::remove_dir_all(&dir);
    }
}

// 参照切れ（manifest→ZIP実体なし / spine→manifestなし）を検出できること
#[test]
fn detects_missing_image_and_bad_spine() {
    let dir = test_dir("broken");
    let path = dir.join("broken.epub");
    let file = fs::File::create(&path).unwrap();
    let mut zipw = zip::ZipWriter::new(file);
    let stored: zip::write::FileOptions =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let deflated: zip::write::FileOptions =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zipw.start_file("mimetype", stored).unwrap();
    zipw.write_all(b"application/epub+zip").unwrap();
    zipw.start_file("META-INF/container.xml", deflated).unwrap();
    zipw
        .write_all(
            br#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="item/standard.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#,
        )
        .unwrap();
    zipw.start_file("item/standard.opf", deflated).unwrap();
    zipw
        .write_all(
            br#"<package><manifest><item id="i-001" href="image/i-001.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="i-001"/><itemref idref="ghost"/></spine></package>"#,
        )
        .unwrap();
    zipw.finish().unwrap();

    let result = verify_internal(path.to_string_lossy().as_ref());
    assert!(!result.is_valid, "壊れEPUBが valid 判定: {:?}", result);
    assert!(
        result.errors.iter().any(|e| e.contains("i-001.jpg")),
        "manifest参照切れ未検出: {:?}",
        result.errors
    );
    assert!(
        result.errors.iter().any(|e| e.contains("ghost")),
        "spine idref切れ未検出: {:?}",
        result.errors
    );
    let _ = fs::remove_dir_all(&dir);
}

// mimetype が圧縮されている場合を検出できること
#[test]
fn detects_bad_mimetype() {
    let dir = test_dir("badmime");
    let path = dir.join("badmime.epub");
    let file = fs::File::create(&path).unwrap();
    let mut zipw = zip::ZipWriter::new(file);
    let deflated: zip::write::FileOptions =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // mimetype を圧縮して書く（仕様違反）
    zipw.start_file("mimetype", deflated).unwrap();
    zipw.write_all(b"application/epub+zip").unwrap();
    zipw.start_file("META-INF/container.xml", deflated).unwrap();
    zipw
        .write_all(
            br#"<container><rootfiles><rootfile full-path="item/standard.opf"/></rootfiles></container>"#,
        )
        .unwrap();
    zipw.start_file("item/standard.opf", deflated).unwrap();
    zipw
        .write_all(
            br#"<package><manifest></manifest><spine><itemref idref="x"/></spine></package>"#,
        )
        .unwrap();
    zipw.finish().unwrap();

    let result = verify_internal(path.to_string_lossy().as_ref());
    assert!(
        result.errors.iter().any(|e| e.contains("Stored")),
        "mimetype圧縮を未検出: {:?}",
        result.errors
    );
    let _ = fs::remove_dir_all(&dir);
}

// epub_state（フロント管理の不透明JSON）が .daiw の保存・読込で保持されること
#[test]
fn project_file_epub_state_roundtrip() {
    let json = r#"{
        "version":"1.0","name":"t","created_at":"c","modified_at":"m","base_path":"b",
        "chapters":[],
        "epub_state":{
            "bookUuid":"book-uuid-1",
            "title":"テスト作品",
            "split":{"enabled":true,"baseName":"base","suffixStart":1,"suffixDigits":3,"suffixSeparator":"_",
                     "ranges":[{"startIndex":0,"endIndex":2}],
                     "volumes":[{"key":"base_001","bookUuid":"vol-uuid-1","title":"1巻"}]}
        }
    }"#;
    let project: ProjectFile = serde_json::from_str(json).unwrap();
    let state = project.epub_state.clone().expect("epub_state should load");
    assert_eq!(state["bookUuid"], "book-uuid-1");
    assert_eq!(state["split"]["volumes"][0]["key"], "base_001");
    assert_eq!(state["split"]["volumes"][0]["bookUuid"], "vol-uuid-1");

    // 再シリアライズ（save時）でも内容が保持される
    let out = serde_json::to_string(&project).unwrap();
    assert!(out.contains("\"epub_state\""));
    assert!(out.contains("base_001"));
    assert!(out.contains("vol-uuid-1"));
}

// 旧 .daiw（epub_stateなし）が読めて、保存時にキー自体を出力しないこと（後方互換）
#[test]
fn project_file_without_epub_state_is_backward_compatible() {
    let json = r#"{"version":"1.0","name":"t","created_at":"c","modified_at":"m","base_path":"b","chapters":[],"ui_state":null}"#;
    let project: ProjectFile = serde_json::from_str(json).unwrap();
    assert!(project.epub_state.is_none());

    let out = serde_json::to_string(&project).unwrap();
    assert!(!out.contains("epub_state"));
}
