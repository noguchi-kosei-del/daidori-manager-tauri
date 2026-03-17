use crate::types::{EpubFormat, EpubMetadata, EpubPage};

/// XML特殊文字のエスケープ
pub fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// mimetype ファイルの内容
pub const MIMETYPE: &str = "application/epub+zip";

/// container.xml を生成
pub fn generate_container_xml(opf_path: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="{}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
        opf_path
    )
}

/// OPF (Package Document) を生成
pub fn generate_opf(metadata: &EpubMetadata, pages: &[EpubPage], css_files: &[&str]) -> String {
    let mut opf = String::new();

    // XML宣言とpackage開始
    opf.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang=""#);
    opf.push_str(&metadata.language);
    opf.push_str(r#"">"#);
    opf.push('\n');

    // metadata セクション
    opf.push_str(&generate_opf_metadata(metadata, &metadata.output_format));

    // manifest セクション
    opf.push_str(&generate_opf_manifest(metadata, pages, css_files));

    // spine セクション
    opf.push_str(&generate_opf_spine(metadata, pages));

    opf.push_str("</package>\n");
    opf
}

/// OPFのmetadataセクションを生成
fn generate_opf_metadata(metadata: &EpubMetadata, format: &EpubFormat) -> String {
    let mut meta = String::new();
    meta.push_str("  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n");

    // identifier (UUID)
    meta.push_str(&format!(
        "    <dc:identifier id=\"pub-id\">urn:uuid:{}</dc:identifier>\n",
        metadata.book_uuid
    ));

    // title
    meta.push_str(&format!(
        "    <dc:title id=\"title\">{}</dc:title>\n",
        escape_xml(&metadata.title)
    ));
    if let Some(ref file_as) = metadata.title_file_as {
        meta.push_str(&format!(
            "    <meta refines=\"#title\" property=\"file-as\">{}</meta>\n",
            escape_xml(file_as)
        ));
    }

    // authors
    for (i, author) in metadata.authors.iter().enumerate() {
        let id = format!("creator{}", i + 1);
        meta.push_str(&format!(
            "    <dc:creator id=\"{}\">{}</dc:creator>\n",
            id,
            escape_xml(&author.name)
        ));
        meta.push_str(&format!(
            "    <meta refines=\"#{}\" property=\"role\" scheme=\"marc:relators\">{}</meta>\n",
            id,
            author.role.as_str()
        ));
        if let Some(ref file_as) = author.file_as {
            meta.push_str(&format!(
                "    <meta refines=\"#{}\" property=\"file-as\">{}</meta>\n",
                id,
                escape_xml(file_as)
            ));
        }
        // 役割の日本語表示名（カスタム設定があればそれを使用、なければデフォルト）
        let display_name = author.role_display
            .as_deref()
            .unwrap_or_else(|| author.role.display_name_ja());
        if *format == EpubFormat::Kadokawa || author.role_display.is_some() {
            meta.push_str(&format!(
                "    <meta refines=\"#{}\" property=\"role\">{}</meta>\n",
                id,
                escape_xml(display_name)
            ));
        }
    }

    // publisher
    meta.push_str(&format!(
        "    <dc:publisher id=\"publisher\">{}</dc:publisher>\n",
        escape_xml(&metadata.publisher)
    ));
    if let Some(ref file_as) = metadata.publisher_file_as {
        meta.push_str(&format!(
            "    <meta refines=\"#publisher\" property=\"file-as\">{}</meta>\n",
            escape_xml(file_as)
        ));
    }

    // language
    meta.push_str(&format!(
        "    <dc:language>{}</dc:language>\n",
        metadata.language
    ));

    // description
    if let Some(ref desc) = metadata.description {
        meta.push_str(&format!(
            "    <dc:description>{}</dc:description>\n",
            escape_xml(desc)
        ));
    }

    // modified date
    let now = chrono::Utc::now();
    meta.push_str(&format!(
        "    <meta property=\"dcterms:modified\">{}</meta>\n",
        now.format("%Y-%m-%dT%H:%M:%SZ")
    ));

    // Fixed Layout 用メタ
    meta.push_str("    <meta property=\"rendition:layout\">pre-paginated</meta>\n");
    meta.push_str(&format!(
        "    <meta property=\"rendition:orientation\">{}</meta>\n",
        metadata.orientation.as_str()
    ));
    meta.push_str(&format!(
        "    <meta property=\"rendition:spread\">{}</meta>\n",
        metadata.spread_mode.as_str()
    ));

    meta.push_str("  </metadata>\n");
    meta
}

/// OPFのmanifestセクションを生成
fn generate_opf_manifest(
    _metadata: &EpubMetadata,
    pages: &[EpubPage],
    css_files: &[&str],
) -> String {
    let mut manifest = String::new();
    manifest.push_str("  <manifest>\n");

    // Navigation document
    manifest.push_str("    <item id=\"nav\" href=\"xhtml/nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n");

    // CSS files
    for (i, css) in css_files.iter().enumerate() {
        manifest.push_str(&format!(
            "    <item id=\"css{}\" href=\"style/{}\" media-type=\"text/css\"/>\n",
            i + 1,
            css
        ));
    }

    // Pages (XHTML + Images)
    for page in pages {
        // XHTML
        let xhtml_props = if page.is_cover {
            " properties=\"svg\""
        } else {
            " properties=\"svg\""
        };
        manifest.push_str(&format!(
            "    <item id=\"{}\" href=\"xhtml/{}.xhtml\" media-type=\"application/xhtml+xml\"{}/>\n",
            page.id, page.id, xhtml_props
        ));

        // Image
        let media_type = get_image_media_type(&page.filename);
        let img_props = if page.is_cover {
            " properties=\"cover-image\""
        } else {
            ""
        };
        manifest.push_str(&format!(
            "    <item id=\"{}-img\" href=\"image/{}\" media-type=\"{}\"{}/>\n",
            page.id, page.filename, media_type, img_props
        ));
    }

    manifest.push_str("  </manifest>\n");
    manifest
}

/// OPFのspineセクションを生成
fn generate_opf_spine(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let mut spine = String::new();
    let direction = metadata.page_direction.as_str();
    spine.push_str(&format!(
        "  <spine page-progression-direction=\"{}\">\n",
        direction
    ));

    for page in pages {
        let spread = if page.is_cover {
            "center"
        } else {
            "auto"
        };
        spine.push_str(&format!(
            "    <itemref idref=\"{}\" spread=\"{}\"/>\n",
            page.id, spread
        ));
    }

    spine.push_str("  </spine>\n");
    spine
}

/// NCX (Navigation Document for EPUB 2.0 compatibility) を生成
pub fn generate_ncx(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let mut ncx = String::new();

    ncx.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:"#);
    ncx.push_str(&metadata.book_uuid);
    ncx.push_str(r#""/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>"#);
    ncx.push_str(&escape_xml(&metadata.title));
    ncx.push_str(r#"</text>
  </docTitle>
  <navMap>
"#);

    for (i, page) in pages.iter().enumerate() {
        let label = if page.is_cover {
            "表紙".to_string()
        } else if page.is_colophon {
            "奥付".to_string()
        } else {
            format!("ページ {}", i + 1)
        };

        ncx.push_str(&format!(
            r#"    <navPoint id="nav-{}" playOrder="{}">
      <navLabel>
        <text>{}</text>
      </navLabel>
      <content src="xhtml/{}.xhtml"/>
    </navPoint>
"#,
            page.id,
            i + 1,
            escape_xml(&label),
            page.id
        ));
    }

    ncx.push_str("  </navMap>\n</ncx>\n");
    ncx
}

/// Navigation XHTML を生成
pub fn generate_nav_xhtml(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let mut nav = String::new();

    nav.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang=""#);
    nav.push_str(&metadata.language);
    nav.push_str(r#"">
<head>
  <meta charset="UTF-8"/>
  <title>"#);
    nav.push_str(&escape_xml(&metadata.title));
    nav.push_str(r#"</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目次</h1>
    <ol>
"#);

    for (i, page) in pages.iter().enumerate() {
        let label = if page.is_cover {
            "表紙".to_string()
        } else if page.is_colophon {
            "奥付".to_string()
        } else {
            format!("ページ {}", i + 1)
        };

        nav.push_str(&format!(
            "      <li><a href=\"{}.xhtml\">{}</a></li>\n",
            page.id,
            escape_xml(&label)
        ));
    }

    nav.push_str(r#"    </ol>
  </nav>
</body>
</html>
"#);

    nav
}

/// ページXHTMLを生成（SVGラップ方式）
pub fn generate_page_xhtml(
    metadata: &EpubMetadata,
    page: &EpubPage,
    css_files: &[&str],
) -> String {
    let mut xhtml = String::new();

    xhtml.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang=""#);
    xhtml.push_str(&metadata.language);
    xhtml.push_str(r#"">
<head>
  <meta charset="UTF-8"/>
  <title>"#);
    xhtml.push_str(&escape_xml(&metadata.title));
    xhtml.push_str("</title>\n");

    // CSS links
    for css in css_files {
        xhtml.push_str(&format!(
            "  <link rel=\"stylesheet\" type=\"text/css\" href=\"../style/{}\"/>\n",
            css
        ));
    }

    // viewport meta
    xhtml.push_str(&format!(
        "  <meta name=\"viewport\" content=\"width={}, height={}\"/>\n",
        metadata.viewport_width, metadata.viewport_height
    ));

    xhtml.push_str("</head>\n");

    // body with epub:type for cover
    if page.is_cover {
        xhtml.push_str("<body epub:type=\"cover\">\n");
    } else {
        xhtml.push_str("<body>\n");
    }

    // SVG wrapper
    xhtml.push_str(&format!(
        r#"  <div class="main">
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100%" height="100%" viewBox="0 0 {} {}">
      <image width="{}" height="{}" xlink:href="../image/{}"/>
    </svg>
  </div>
"#,
        page.width, page.height, page.width, page.height, page.filename
    ));

    xhtml.push_str("</body>\n</html>\n");
    xhtml
}

/// 画像ファイルのMIMEタイプを取得
fn get_image_media_type(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

/// 形式に応じたCSSファイルリストを返す
pub fn get_css_files_for_format(format: &EpubFormat) -> Vec<&'static str> {
    match format {
        EpubFormat::Kadokawa => vec![
            "fixed-layout-jp.css",
            "book-style.css",
            "style-reset.css",
            "style-standard.css",
            "style-advance.css",
            "style-check.css",
            "style-kadokawa.css",
            "style-karc.css",
        ],
        EpubFormat::Hybrid => vec![
            "fixed-layout-jp.css",
            "book-style.css",
            "style-reset.css",
            "style-standard.css",
            "style-advance.css",
            "style-kadokawa.css",
        ],
        EpubFormat::Oebps => vec!["fixed-layout-jp.css"],
    }
}
