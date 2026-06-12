// EPUB内部整合性チェック（EPUBCheckとは別の自前検査）
//
// 引継ぎ資料 8.14 の「OPF manifest・XHTML内画像参照・実際のZIP内ファイル名の3つが
// 食い違う」事故を生成直後に検出するための軽量検査。
// - mimetype の先頭・非圧縮・内容
// - container.xml → OPF の存在
// - OPF manifest の参照ファイルがZIP内に実在するか
// - 画像拡張子と media-type の一致
// - 表紙画像（cover-image プロパティ）の有無
// - spine の idref が manifest に存在するか
// - 各XHTMLが参照する画像/CSSがZIP内に実在するか
// - 画像のICCプロファイル有無の集計（JPEG APP2 / PNG iCCP の簡易検出）

use serde::Serialize;
use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use zip::ZipArchive;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubInternalCheckResult {
    pub is_valid: bool,
    pub checked_path: String,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub info: Vec<String>,
}

// タグ文字列から name="value" を取り出す（軽量パース。自前生成のEPUBが対象）
fn attr_value(tag: &str, name: &str) -> Option<String> {
    let pat = format!("{}=\"", name);
    let start = tag.find(&pat)? + pat.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

// `<item ...>` のような開始タグを全て切り出す（<itemref を <item と誤認しない）
fn extract_tags<'a>(xml: &'a str, tag_name: &str) -> Vec<&'a str> {
    let open = format!("<{}", tag_name);
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(idx) = xml[pos..].find(open.as_str()) {
        let start = pos + idx;
        let after = xml[start + open.len()..].chars().next();
        match after {
            Some(c) if c.is_whitespace() || c == '/' || c == '>' => {
                if let Some(end_rel) = xml[start..].find('>') {
                    out.push(&xml[start..start + end_rel + 1]);
                    pos = start + end_rel + 1;
                } else {
                    break;
                }
            }
            _ => {
                pos = start + open.len();
            }
        }
    }
    out
}

// base_dir（OPF/XHTMLのあるフォルダ）基準で相対パスをZIP内パスへ正規化
fn resolve_path(base_dir: &str, rel: &str) -> String {
    let mut parts: Vec<&str> = if base_dir.is_empty() {
        Vec::new()
    } else {
        base_dir.split('/').collect()
    };
    for seg in rel.split('/') {
        match seg {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(idx) => path[..idx].to_string(),
        None => String::new(),
    }
}

fn ext_lower(path: &str) -> String {
    path.rsplit('.').next().unwrap_or("").to_ascii_lowercase()
}

// 先頭16KBに ICC マーカーがあるか（JPEG: APP2 "ICC_PROFILE" / PNG: "iCCP" チャンク）
fn detect_icc(head: &[u8]) -> bool {
    let jpeg_marker: &[u8] = b"ICC_PROFILE";
    let png_marker: &[u8] = b"iCCP";
    head.windows(jpeg_marker.len()).any(|w| w == jpeg_marker)
        || head.windows(png_marker.len()).any(|w| w == png_marker)
}

fn expected_media_type(ext: &str) -> Option<&'static str> {
    match ext {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        _ => None,
    }
}

// 検査本体（同期）。統合テストからも直接呼べるよう pub にしている
pub fn verify_internal(epub_path: &str) -> EpubInternalCheckResult {
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut info: Vec<String> = Vec::new();

    let make_result = |is_valid: bool,
                       errors: Vec<String>,
                       warnings: Vec<String>,
                       info: Vec<String>| EpubInternalCheckResult {
        is_valid,
        checked_path: epub_path.to_string(),
        errors,
        warnings,
        info,
    };

    let file = match File::open(epub_path) {
        Ok(f) => f,
        Err(e) => {
            errors.push(format!("EPUBファイルを開けません: {}", e));
            return make_result(false, errors, warnings, info);
        }
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => {
            errors.push(format!("ZIPとして読み込めません: {}", e));
            return make_result(false, errors, warnings, info);
        }
    };

    // ZIP内エントリ一覧
    let names: HashSet<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    // 1. mimetype: 先頭・非圧縮・内容
    match archive.by_index(0) {
        Ok(mut first) => {
            if first.name() != "mimetype" {
                errors.push(format!(
                    "mimetype がZIPの先頭にありません（先頭: {}）",
                    first.name()
                ));
            } else {
                if first.compression() != zip::CompressionMethod::Stored {
                    errors.push("mimetype が非圧縮(Stored)ではありません".to_string());
                }
                let mut content = String::new();
                if first.read_to_string(&mut content).is_ok()
                    && content.trim() != "application/epub+zip"
                {
                    errors.push(format!("mimetype の内容が不正です: {}", content.trim()));
                }
            }
        }
        Err(e) => errors.push(format!("ZIP先頭エントリを読めません: {}", e)),
    }

    // 2. container.xml → OPF パス
    let container_xml = {
        let mut buf = String::new();
        match archive.by_name("META-INF/container.xml") {
            Ok(mut f) => {
                let _ = f.read_to_string(&mut buf);
                buf
            }
            Err(_) => {
                errors.push("META-INF/container.xml がありません".to_string());
                return make_result(false, errors, warnings, info);
            }
        }
    };
    let opf_path = extract_tags(&container_xml, "rootfile")
        .iter()
        .find_map(|t| attr_value(t, "full-path"));
    let opf_path = match opf_path {
        Some(p) => p,
        None => {
            errors.push("container.xml から OPF パス(full-path)を取得できません".to_string());
            return make_result(false, errors, warnings, info);
        }
    };
    if !names.contains(&opf_path) {
        errors.push(format!("OPFファイルがZIP内にありません: {}", opf_path));
        return make_result(false, errors, warnings, info);
    }
    let opf_dir = parent_dir(&opf_path);

    // 3. OPF を読む
    let opf_xml = {
        let mut buf = String::new();
        if let Ok(mut f) = archive.by_name(&opf_path) {
            let _ = f.read_to_string(&mut buf);
        }
        buf
    };

    // manifest item: (id, zip内パス, media-type, properties)
    struct ManifestItem {
        id: String,
        zip_path: String,
        media_type: String,
        properties: String,
    }
    let items: Vec<ManifestItem> = extract_tags(&opf_xml, "item")
        .iter()
        .filter_map(|tag| {
            let href = attr_value(tag, "href")?;
            Some(ManifestItem {
                id: attr_value(tag, "id").unwrap_or_default(),
                zip_path: resolve_path(&opf_dir, &href),
                media_type: attr_value(tag, "media-type").unwrap_or_default(),
                properties: attr_value(tag, "properties").unwrap_or_default(),
            })
        })
        .collect();

    // 3a. manifest 参照の実在チェック + 拡張子/media-type 一致
    for item in &items {
        if !names.contains(&item.zip_path) {
            errors.push(format!(
                "manifest が参照するファイルがZIP内にありません: {}",
                item.zip_path
            ));
            continue;
        }
        let ext = ext_lower(&item.zip_path);
        if let Some(expected) = expected_media_type(&ext) {
            if item.media_type != expected {
                errors.push(format!(
                    "画像のmedia-type不一致: {} は {} のはずが {}",
                    item.zip_path, expected, item.media_type
                ));
            }
        }
        // EPUB内画像に PSD/TIFF が紛れていないか（ZIP梱包フィルタとの不整合検出）
        if matches!(ext.as_str(), "psd" | "tif" | "tiff") {
            errors.push(format!(
                "EPUB非対応の画像形式がmanifestに含まれています: {}",
                item.zip_path
            ));
        }
    }

    // 3b. 表紙画像
    let has_cover_image = items.iter().any(|i| i.properties.contains("cover-image"));
    if !has_cover_image {
        warnings.push("cover-image プロパティを持つ表紙画像がmanifestにありません".to_string());
    }

    // 4. spine idref → manifest id
    let manifest_ids: HashSet<&str> = items.iter().map(|i| i.id.as_str()).collect();
    let itemrefs: Vec<String> = extract_tags(&opf_xml, "itemref")
        .iter()
        .filter_map(|t| attr_value(t, "idref"))
        .collect();
    if itemrefs.is_empty() {
        errors.push("spine に itemref がありません".to_string());
    }
    for idref in &itemrefs {
        if !manifest_ids.contains(idref.as_str()) {
            errors.push(format!("spine の idref がmanifestにありません: {}", idref));
        }
    }

    // 5. 各XHTMLの参照（画像/CSS）がZIP内に実在するか
    let xhtml_paths: Vec<String> = items
        .iter()
        .filter(|i| i.media_type == "application/xhtml+xml")
        .map(|i| i.zip_path.clone())
        .collect();
    let mut missing_refs = 0usize;
    for xhtml_path in &xhtml_paths {
        let content = {
            let mut buf = String::new();
            if let Ok(mut f) = archive.by_name(xhtml_path) {
                let _ = f.read_to_string(&mut buf);
            }
            buf
        };
        let base = parent_dir(xhtml_path);
        let mut refs: Vec<String> = Vec::new();
        for tag in extract_tags(&content, "image") {
            if let Some(href) = attr_value(tag, "xlink:href") {
                refs.push(href);
            }
        }
        for tag in extract_tags(&content, "img") {
            if let Some(src) = attr_value(tag, "src") {
                refs.push(src);
            }
        }
        for tag in extract_tags(&content, "link") {
            if let Some(href) = attr_value(tag, "href") {
                refs.push(href);
            }
        }
        for r in refs {
            if r.starts_with('#') || r.contains("://") {
                continue;
            }
            let resolved = resolve_path(&base, r.split('#').next().unwrap_or(&r));
            if !names.contains(&resolved) {
                errors.push(format!(
                    "{} が参照するファイルがZIP内にありません: {}",
                    xhtml_path, resolved
                ));
                missing_refs += 1;
            }
        }
    }

    // 6. 画像のICC有無を集計（先頭16KBのマーカー走査）
    let image_paths: Vec<String> = items
        .iter()
        .filter(|i| i.media_type.starts_with("image/"))
        .map(|i| i.zip_path.clone())
        .collect();
    let mut icc_count = 0usize;
    let mut no_icc_count = 0usize;
    for path in &image_paths {
        if let Ok(f) = archive.by_name(path) {
            let mut head = Vec::with_capacity(16 * 1024);
            let _ = f.take(16 * 1024).read_to_end(&mut head);
            if detect_icc(&head) {
                icc_count += 1;
            } else {
                no_icc_count += 1;
            }
        }
    }

    info.push(format!(
        "manifest {}件 / XHTML {}ページ / 画像 {}枚 / spine {}項目",
        items.len(),
        xhtml_paths.len(),
        image_paths.len(),
        itemrefs.len()
    ));
    info.push(format!(
        "画像ICC: あり {}枚 / なし {}枚",
        icc_count, no_icc_count
    ));
    if missing_refs == 0 && errors.is_empty() {
        info.push("OPF/XHTML参照とZIP実体は全て一致".to_string());
    }

    let is_valid = errors.is_empty();
    make_result(is_valid, errors, warnings, info)
}

// EPUB内部整合性チェック（生成直後の自前検査・EPUBCheck補完）
#[tauri::command]
pub async fn verify_epub_internal(epub_path: String) -> Result<EpubInternalCheckResult, String> {
    tokio::task::spawn_blocking(move || Ok(verify_internal(&epub_path)))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}
