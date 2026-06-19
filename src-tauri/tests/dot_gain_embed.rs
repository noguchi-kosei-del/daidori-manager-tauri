// モノクロ(グレースケール)ページに Dot Gain プロファイルが、カラー(RGB)ページに
// sRGB プロファイルが EPUB の画像へ実際に埋め込まれることを検証する統合テスト。
//
// DAIDORI_DOT_GAIN_ICC に抽出済みの「Dot Gain 20%.icc」を指して、Auto ポリシーで
// グレースケール本文 → Dot Gain、カラー本文 → sRGB になることを確認する。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use daidori_manager_tauri_lib::epub::EpubBuilder;
use daidori_manager_tauri_lib::types::{
    AuthorInfo, AuthorRole, EpubFormat, EpubGenerateConfig, EpubImageColorPolicy, EpubMetadata,
    EpubPage, EpubPageImageProfileOverride,
};

fn test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("daidori_dotgain_test_{}", name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_gray_jpeg(path: &Path, w: u32, h: u32) {
    let img = image::GrayImage::from_pixel(w, h, image::Luma([200u8]));
    img.save(path).unwrap();
}

fn write_rgb_jpeg(path: &Path, w: u32, h: u32) {
    let img = image::RgbImage::from_pixel(w, h, image::Rgb([180u8, 120, 60]));
    img.save(path).unwrap();
}

fn metadata() -> EpubMetadata {
    EpubMetadata {
        title: "テスト".to_string(),
        title_file_as: None,
        authors: vec![AuthorInfo {
            name: "著者".to_string(),
            file_as: None,
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
        output_format: EpubFormat::Kadokawa,
        allow_missing_colophon: false,
        hybrid_css_profile: Default::default(),
        // ユーザー要望: 本文モノクロ→Dot Gain / カラー→sRGB を自動判定
        image_color_policy: EpubImageColorPolicy::Auto,
    }
}

fn page(id: &str, filename: &str, source: &Path, color_mode: &str) -> EpubPage {
    EpubPage {
        id: id.to_string(),
        filename: filename.to_string(),
        source_path: source.to_string_lossy().into_owned(),
        width: 100,
        height: 150,
        is_cover: false,
        is_colophon: false,
        is_blank: false,
        source_color_mode: Some(color_mode.to_string()),
        image_profile_override: Default::default(),
        pre_normalized: false,
    }
}

/// JPEG の APP2(0xFFE2) ICC_PROFILE セグメントを連結して ICC バイト列を取り出す。
fn extract_icc_from_jpeg(data: &[u8]) -> Option<Vec<u8>> {
    let marker = b"ICC_PROFILE\0";
    let mut chunks: Vec<(u8, Vec<u8>)> = Vec::new();
    let mut i = 2usize;
    while i + 4 < data.len() {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }
        let m = data[i + 1];
        if m == 0xD9 || m == 0xDA {
            break;
        }
        if (0xD0..=0xD7).contains(&m) {
            i += 2;
            continue;
        }
        let len = ((data[i + 2] as usize) << 8) | (data[i + 3] as usize);
        if m == 0xE2 {
            let id_start = i + 4;
            if id_start + marker.len() <= data.len() && &data[id_start..id_start + marker.len()] == marker {
                let seq = data[id_start + 12];
                let data_start = id_start + 14;
                let data_len = len.saturating_sub(2 + 14);
                if data_start + data_len <= data.len() {
                    chunks.push((seq, data[data_start..data_start + data_len].to_vec()));
                }
            }
        }
        i += 2 + len;
    }
    if chunks.is_empty() {
        return None;
    }
    chunks.sort_by_key(|(s, _)| *s);
    let mut icc = Vec::new();
    for (_, c) in chunks {
        icc.extend_from_slice(&c);
    }
    Some(icc)
}

fn read_zip_jpeg(epub: &Path, name_contains: &str) -> Vec<u8> {
    let file = fs::File::open(epub).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).unwrap();
        let name = entry.name().to_string();
        if name.contains(name_contains) && name.to_ascii_lowercase().ends_with(".jpg") {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).unwrap();
            return buf;
        }
    }
    panic!("zip entry containing '{}' not found", name_contains);
}

#[test]
fn mono_page_embeds_dot_gain_and_color_page_embeds_srgb() {
    // 抽出済みの純正 Dot Gain 20% を環境変数で指す（シェル環境に依存しない）。
    let local = std::env::var("LOCALAPPDATA").expect("LOCALAPPDATA");
    let dot_gain = PathBuf::from(&local)
        .join("daidori-manager")
        .join("color")
        .join("Dot Gain 20%.icc");
    // Dot Gain プロファイル未配置の環境（CI/他PC）ではスキップして cargo test を壊さない。
    if !dot_gain.exists() {
        eprintln!(
            "skip: Dot Gain プロファイル未配置のためスキップ ({})",
            dot_gain.display()
        );
        return;
    }
    std::env::set_var("DAIDORI_DOT_GAIN_ICC", &dot_gain);

    // 区分独立の検証: カラー表紙 → sRGB / モノクロ本文 → Dot Gain。
    // 表紙がカラーでも本文（モノクロ）の判定には影響しないことを確認する。
    let dir = test_dir("mono_color");
    let cover = dir.join("cover_src.jpg");
    let body = dir.join("body_src.jpg");
    write_rgb_jpeg(&cover, 100, 150); // カラー表紙
    write_gray_jpeg(&body, 100, 150); // モノクロ本文

    let mut cover_page = page("p-cover", "cover.jpg", &cover, "RGB");
    cover_page.is_cover = true;
    let body_page = page("p-001", "0001.jpg", &body, "grayscale");

    let output_path = dir.join("out.epub");
    let config = EpubGenerateConfig {
        metadata: metadata(),
        pages: vec![cover_page, body_page],
        output_path: output_path.to_string_lossy().into_owned(),
        custom_css: None,
    };

    let resp = EpubBuilder::new(config).build().expect("EPUB build failed");
    assert!(resp.success, "build error: {:?}", resp.error);

    let summary = resp.image_profile_summary.expect("profile summary");
    assert_eq!(
        summary.grayscale_dot_gain_count, 1,
        "本文(モノクロ)が Dot Gain で処理されていない: {:?}",
        summary
    );
    assert_eq!(
        summary.rgb_srgb_count, 1,
        "表紙(カラー)が sRGB で処理されていない: {:?}",
        summary
    );
    assert_eq!(
        summary.grayscale_no_profile_count, 0,
        "Dot Gain プロファイル未検出の警告が出ている: {:?}",
        summary
    );

    // 本文(モノクロ)に Dot Gain プロファイルが実際に埋め込まれているか
    // （表紙が idx0 のため本文は i-001.jpg）
    let mono_jpeg = read_zip_jpeg(&output_path, "i-001");
    let mono_icc = extract_icc_from_jpeg(&mono_jpeg).expect("本文画像に ICC が無い");
    assert_eq!(&mono_icc[36..40], b"acsp", "ICC シグネチャ不正");
    assert_eq!(&mono_icc[16..20], b"GRAY", "グレースケール ICC でない");
    let mono_text: String = mono_icc.iter().map(|&b| b as char).collect();
    assert!(
        mono_text.contains("Dot Gain 20%"),
        "埋め込み ICC が Dot Gain 20% でない"
    );

    // 表紙(カラー)に sRGB プロファイルが埋め込まれているか（Kadokawa: cover.jpg）
    let color_jpeg = read_zip_jpeg(&output_path, "cover");
    let color_icc = extract_icc_from_jpeg(&color_jpeg).expect("表紙画像に ICC が無い");
    assert_eq!(&color_icc[36..40], b"acsp", "ICC シグネチャ不正(color)");
    assert_eq!(&color_icc[16..20], b"RGB ", "RGB ICC でない");

    // 検証スクリプト確認用にサンプルEPUBを残す（通常は temp を削除）
    if std::env::var("DAIDORI_KEEP_SAMPLE").is_ok() {
        eprintln!("sample epub: {}", output_path.display());
    } else {
        let _ = fs::remove_dir_all(&dir);
    }
}

// 「自分で指定: モノクロ（ドットゲイン）」= FullMonoDotGain。
// カラー(RGB)原稿でも全ページをグレースケール化して Dot Gain を付与する。
#[test]
fn full_mono_policy_forces_dot_gain_on_color_source() {
    let local = std::env::var("LOCALAPPDATA").expect("LOCALAPPDATA");
    let dot_gain = PathBuf::from(&local)
        .join("daidori-manager")
        .join("color")
        .join("Dot Gain 20%.icc");
    if !dot_gain.exists() {
        eprintln!("skip: Dot Gain プロファイル未配置のためスキップ");
        return;
    }
    std::env::set_var("DAIDORI_DOT_GAIN_ICC", &dot_gain);

    let dir = test_dir("full_mono");
    let color = dir.join("color_src.jpg");
    write_rgb_jpeg(&color, 100, 150);

    let output_path = dir.join("out.epub");
    let mut md = metadata();
    md.image_color_policy = EpubImageColorPolicy::FullMonoDotGain;
    let config = EpubGenerateConfig {
        metadata: md,
        // あえて RGB 原稿を渡す（モノクロ強制になることを確認）
        pages: vec![page("p-1", "0001.jpg", &color, "RGB")],
        output_path: output_path.to_string_lossy().into_owned(),
        custom_css: None,
    };

    let resp = EpubBuilder::new(config).build().expect("EPUB build failed");
    assert!(resp.success, "build error: {:?}", resp.error);
    let summary = resp.image_profile_summary.expect("profile summary");
    assert_eq!(summary.grayscale_dot_gain_count, 1, "{:?}", summary);
    assert_eq!(summary.rgb_srgb_count, 0, "{:?}", summary);

    let jpeg = read_zip_jpeg(&output_path, "i-000");
    let icc = extract_icc_from_jpeg(&jpeg).expect("ICC が無い");
    assert_eq!(&icc[16..20], b"GRAY", "グレースケール化されていない");
    let text: String = icc.iter().map(|&b| b as char).collect();
    assert!(text.contains("Dot Gain 20%"), "Dot Gain でない");

    let _ = fs::remove_dir_all(&dir);
}

// 「カスタム: チャプター種別ごと」は各ページの image_profile_override に反映される。
// 例: モノクロ原稿のチャプターに「カラー（sRGB）」を指定 = override=Srgb → RGB sRGB を強制。
#[test]
fn per_page_override_srgb_forces_color_on_mono_source() {
    let dir = test_dir("override_srgb");
    let mono = dir.join("mono_src.jpg");
    write_gray_jpeg(&mono, 100, 150);

    let output_path = dir.join("out.epub");
    // ポリシーは Auto（おまかせ）。override が最優先される。
    let mut p = page("p-1", "0001.jpg", &mono, "grayscale");
    p.image_profile_override = EpubPageImageProfileOverride::Srgb;
    let config = EpubGenerateConfig {
        metadata: metadata(),
        pages: vec![p],
        output_path: output_path.to_string_lossy().into_owned(),
        custom_css: None,
    };

    let resp = EpubBuilder::new(config).build().expect("EPUB build failed");
    assert!(resp.success, "build error: {:?}", resp.error);
    let summary = resp.image_profile_summary.expect("summary");
    assert_eq!(summary.rgb_srgb_count, 1, "{:?}", summary);
    assert_eq!(summary.grayscale_dot_gain_count, 0, "{:?}", summary);

    let jpeg = read_zip_jpeg(&output_path, "i-000");
    let icc = extract_icc_from_jpeg(&jpeg).expect("ICC が無い");
    assert_eq!(&icc[16..20], b"RGB ", "sRGB(RGB) になっていない");

    let _ = fs::remove_dir_all(&dir);
}

// おまかせ(Auto)では表紙も実際のカラーで判断する（sRGB固定にしない）。
// モノクロの表紙 → Dot Gain、カラーの本文 → sRGB。
#[test]
fn auto_judges_cover_by_actual_color() {
    let local = std::env::var("LOCALAPPDATA").expect("LOCALAPPDATA");
    let dot_gain = PathBuf::from(&local)
        .join("daidori-manager")
        .join("color")
        .join("Dot Gain 20%.icc");
    if !dot_gain.exists() {
        eprintln!("skip: Dot Gain プロファイル未配置のためスキップ");
        return;
    }
    std::env::set_var("DAIDORI_DOT_GAIN_ICC", &dot_gain);

    let dir = test_dir("auto_cover");
    let cover_src = dir.join("cover_src.jpg");
    let body_src = dir.join("body_src.jpg");
    write_gray_jpeg(&cover_src, 100, 150); // モノクロ表紙
    write_rgb_jpeg(&body_src, 100, 150); // カラー本文

    let mut cover = page("p-cover", "cover.jpg", &cover_src, "grayscale");
    cover.is_cover = true;
    let body = page("p-001", "0001.jpg", &body_src, "RGB");

    let output_path = dir.join("out.epub");
    let config = EpubGenerateConfig {
        metadata: metadata(), // Auto
        pages: vec![cover, body],
        output_path: output_path.to_string_lossy().into_owned(),
        custom_css: None,
    };

    let resp = EpubBuilder::new(config).build().expect("EPUB build failed");
    assert!(resp.success, "build error: {:?}", resp.error);
    let summary = resp.image_profile_summary.expect("summary");
    // 表紙=Dot Gain(1) / 本文=sRGB(1)
    assert_eq!(summary.grayscale_dot_gain_count, 1, "表紙がDot Gainで判断されていない: {:?}", summary);
    assert_eq!(summary.rgb_srgb_count, 1, "本文がsRGBで判断されていない: {:?}", summary);

    let cover_jpeg = read_zip_jpeg(&output_path, "cover");
    let cover_icc = extract_icc_from_jpeg(&cover_jpeg).expect("表紙にICCが無い");
    assert_eq!(&cover_icc[16..20], b"GRAY", "表紙がグレースケール(Dot Gain)になっていない");
    let text: String = cover_icc.iter().map(|&b| b as char).collect();
    assert!(text.contains("Dot Gain 20%"), "表紙ICCがDot Gainでない");

    let _ = fs::remove_dir_all(&dir);
}
