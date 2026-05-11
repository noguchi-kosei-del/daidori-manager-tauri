use std::path::Path;

use crate::types::{EpubFormat, EpubMetadata, EpubPage, PageDirection};

pub const MIMETYPE: &str = "application/epub+zip";

pub fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn opf_filename(metadata: &EpubMetadata) -> String {
    match metadata.output_format {
        EpubFormat::Kadokawa | EpubFormat::Hybrid => "standard.opf".to_string(),
        EpubFormat::Oebps => {
            let safe_name: String = metadata
                .title
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == '_' {
                        c
                    } else {
                        '_'
                    }
                })
                .take(30)
                .collect();
            let safe_name = safe_name.trim_matches('_');
            if safe_name.is_empty() {
                "content.opf".to_string()
            } else {
                format!("{}.opf", safe_name)
            }
        }
    }
}

pub fn unique_id(metadata: &EpubMetadata) -> String {
    format!("urn:uuid:{}", metadata.book_uuid)
}

pub fn root_folder(format: &EpubFormat) -> &'static str {
    match format {
        EpubFormat::Kadokawa | EpubFormat::Hybrid => "item",
        EpubFormat::Oebps => "OEBPS",
    }
}

pub fn xhtml_folder(format: &EpubFormat) -> &'static str {
    match format {
        EpubFormat::Kadokawa | EpubFormat::Hybrid => "xhtml",
        EpubFormat::Oebps => "text",
    }
}

pub fn image_folder(format: &EpubFormat) -> &'static str {
    match format {
        EpubFormat::Kadokawa | EpubFormat::Hybrid => "image",
        EpubFormat::Oebps => "images",
    }
}

pub fn style_folder(format: &EpubFormat) -> &'static str {
    match format {
        EpubFormat::Kadokawa | EpubFormat::Hybrid => "style",
        EpubFormat::Oebps => "styles",
    }
}

pub fn page_id(format: &EpubFormat, idx: usize, page: &EpubPage) -> String {
    match format {
        EpubFormat::Kadokawa => {
            if page.is_cover {
                "p-cover".to_string()
            } else if page.is_colophon {
                "p-colophon".to_string()
            } else {
                format!("p-{idx:03}")
            }
        }
        EpubFormat::Hybrid => {
            if page.is_cover {
                "p-cover".to_string()
            } else if page.is_colophon {
                "p-colophon".to_string()
            } else {
                format!("p-{:03}", idx + 1)
            }
        }
        EpubFormat::Oebps => {
            if page.is_cover {
                "book_000".to_string()
            } else {
                format!("book_{:03}", idx + 1)
            }
        }
    }
}

pub fn image_id(format: &EpubFormat, idx: usize, page: &EpubPage) -> String {
    match format {
        EpubFormat::Kadokawa => {
            if page.is_cover {
                "cover".to_string()
            } else if page.is_colophon {
                "i-colophon".to_string()
            } else {
                format!("i-{idx:03}")
            }
        }
        EpubFormat::Hybrid => {
            if page.is_cover {
                "cover".to_string()
            } else if page.is_colophon {
                "i-colophon".to_string()
            } else {
                format!("i-{:03}", idx + 1)
            }
        }
        EpubFormat::Oebps => {
            if page.is_cover {
                "cover".to_string()
            } else {
                format!("image_{:03}", idx + 1)
            }
        }
    }
}

pub fn image_filename(format: &EpubFormat, idx: usize, page: &EpubPage) -> String {
    let ext = Path::new(&page.filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_else(|| ".jpg".to_string());

    match format {
        EpubFormat::Kadokawa => {
            if page.is_cover {
                format!("cover{ext}")
            } else if page.is_colophon {
                format!("i-colophon{ext}")
            } else {
                format!("i-{idx:03}{ext}")
            }
        }
        EpubFormat::Hybrid => {
            if page.is_cover {
                format!("cover{ext}")
            } else if page.is_colophon {
                format!("i-colophon{ext}")
            } else {
                format!("i-{:03}{ext}", idx + 1)
            }
        }
        EpubFormat::Oebps => {
            if page.is_cover {
                format!("image_000h{ext}")
            } else {
                format!("image_{:03}{ext}", idx + 1)
            }
        }
    }
}

pub fn generate_container_xml(metadata: &EpubMetadata) -> String {
    let opf_path = format!(
        "{}/{}",
        root_folder(&metadata.output_format),
        opf_filename(metadata)
    );
    if metadata.output_format == EpubFormat::Kadokawa
        || metadata.output_format == EpubFormat::Hybrid
    {
        format!(
            r#"<?xml version="1.0"?>
<container
 version="1.0"
 xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
>
<rootfiles>
<rootfile
 full-path="{opf_path}"
 media-type="application/oebps-package+xml"
/>
</rootfiles>
</container>
"#
        )
    } else {
        format!(
            r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="{opf_path}" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>
"#
        )
    }
}

pub fn generate_opf(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    match metadata.output_format {
        EpubFormat::Kadokawa => generate_opf_kadokawa(metadata, pages),
        EpubFormat::Hybrid => generate_opf_hybrid(metadata, pages),
        EpubFormat::Oebps => generate_opf_oebps(metadata, pages),
    }
}

fn creator_display_name(metadata: &EpubMetadata, author_index: usize) -> String {
    let author = &metadata.authors[author_index];
    if metadata.output_format == EpubFormat::Kadokawa {
        if let Some(role) = author
            .role_display
            .as_deref()
            .filter(|role| !role.trim().is_empty())
        {
            return format!("{}：{}", role, author.name);
        }
    }
    author.name.clone()
}

fn combined_author_name_oebps(metadata: &EpubMetadata) -> String {
    let names: Vec<&str> = metadata
        .authors
        .iter()
        .filter_map(|a| {
            let name = a.name.trim();
            (!name.is_empty()).then_some(name)
        })
        .collect();
    names.join("┴")
}

fn combined_author_file_as(metadata: &EpubMetadata) -> String {
    let names: Vec<&str> = metadata
        .authors
        .iter()
        .filter_map(|a| a.file_as.as_deref())
        .filter(|name| !name.trim().is_empty())
        .collect();
    names.join("┴")
}

fn primary_author_role(metadata: &EpubMetadata) -> &'static str {
    metadata
        .authors
        .first()
        .map(|author| author.role.as_str())
        .unwrap_or("aut")
}

fn modified_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn image_media_type(filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        _ => "image/jpeg",
    }
}

fn spread_property(
    metadata: &EpubMetadata,
    idx: usize,
    page: &EpubPage,
    after_cover: usize,
) -> &'static str {
    if page.is_cover {
        return "rendition:page-spread-center";
    }

    let pos = if pages_have_cover_hint(idx, after_cover) {
        after_cover
    } else {
        idx
    };
    match metadata.page_direction {
        PageDirection::Rtl => {
            if pos % 2 == 0 {
                "page-spread-right"
            } else {
                "page-spread-left"
            }
        }
        PageDirection::Ltr => {
            if pos % 2 == 0 {
                "page-spread-left"
            } else {
                "page-spread-right"
            }
        }
    }
}

fn pages_have_cover_hint(_idx: usize, after_cover: usize) -> bool {
    after_cover != usize::MAX
}

fn build_spine(metadata: &EpubMetadata, pages: &[EpubPage], linear: bool) -> Vec<String> {
    let mut spine = Vec::new();
    let mut cover_found = false;
    let mut page_num_after_cover = 0usize;

    for (idx, page) in pages.iter().enumerate() {
        let page_id = page_id(&metadata.output_format, idx, page);
        let spread = if page.is_cover {
            cover_found = true;
            "rendition:page-spread-center"
        } else if cover_found {
            let spread = spread_property(metadata, idx, page, page_num_after_cover);
            page_num_after_cover += 1;
            spread
        } else {
            spread_property(metadata, idx, page, usize::MAX)
        };

        if linear {
            spine.push(format!(
                r#"<itemref linear="yes" idref="{page_id}"          properties="{spread}"/>"#
            ));
        } else {
            spine.push(format!(
                r#"<itemref idref="{page_id}" properties="{spread}"/>"#
            ));
        }
    }

    spine
}

fn generate_opf_kadokawa(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let mut manifest = Vec::new();
    manifest.push(r#"<item media-type="application/xhtml+xml" id="toc" href="navigation-documents.xhtml" properties="nav"/>"#.to_string());
    manifest.extend([
        r#"<item media-type="text/css" id="fixed-layout-jp" href="style/fixed-layout-jp.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="book-style"      href="style/book-style.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-reset"     href="style/style-reset.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-standard"  href="style/style-standard.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-advance"   href="style/style-advance.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-check"     href="style/style-check.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-kadokawa"  href="style/style-kadokawa.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-karc"      href="style/style-karc.css"/>"#
            .to_string(),
    ]);

    for (idx, page) in pages.iter().enumerate() {
        let filename = image_filename(&metadata.output_format, idx, page);
        let props = if page.is_cover {
            r#" properties="cover-image""#
        } else {
            ""
        };
        manifest.push(
            format!(
                r#"<item media-type="{}" id="{}"          href="{}/{}"{} />"#,
                image_media_type(&filename),
                image_id(&metadata.output_format, idx, page),
                image_folder(&metadata.output_format),
                filename,
                props
            )
            .replace(" />", "/>"),
        );
    }

    for (idx, page) in pages.iter().enumerate() {
        let pid = page_id(&metadata.output_format, idx, page);
        let iid = image_id(&metadata.output_format, idx, page);
        manifest.push(format!(
            r#"<item media-type="application/xhtml+xml" id="{pid}"        href="{}/{}.xhtml"        properties="svg" fallback="{iid}"/>"#,
            xhtml_folder(&metadata.output_format),
            pid
        ));
    }

    let mut metadata_parts = Vec::new();
    metadata_parts.push("<!-- 作品名 -->".to_string());
    metadata_parts.push(format!(
        r#"<dc:title id="title">{}</dc:title>"#,
        escape_xml(&metadata.title)
    ));
    if let Some(file_as) = metadata.title_file_as.as_deref().filter(|s| !s.is_empty()) {
        metadata_parts.push(format!(
            r##"<meta refines="#title" property="file-as">{}</meta>"##,
            escape_xml(file_as)
        ));
    }
    metadata_parts.push(String::new());

    if !metadata.authors.is_empty() {
        metadata_parts.push("<!-- 著者名 -->".to_string());
        for (i, author) in metadata.authors.iter().enumerate() {
            if author.name.trim().is_empty() {
                continue;
            }
            let creator_id = format!("creator{:02}", i + 1);
            metadata_parts.push(format!(
                r#"<dc:creator id="{creator_id}">{}</dc:creator>"#,
                escape_xml(&creator_display_name(metadata, i))
            ));
            metadata_parts.push(format!(
                r##"<meta refines="#{creator_id}" property="role" scheme="marc:relators">{}</meta>"##,
                author.role.as_str()
            ));
            if let Some(file_as) = author.file_as.as_deref().filter(|s| !s.is_empty()) {
                metadata_parts.push(format!(
                    r##"<meta refines="#{creator_id}" property="file-as">{}</meta>"##,
                    escape_xml(file_as)
                ));
            }
            metadata_parts.push(format!(
                r##"<meta refines="#{creator_id}" property="display-seq">{}</meta>"##,
                i + 1
            ));
            metadata_parts.push(String::new());
        }
    }

    if !metadata.publisher.trim().is_empty() {
        metadata_parts.push("<!-- 出版社名 -->".to_string());
        metadata_parts.push(format!(
            r#"<dc:publisher id="publisher">{}</dc:publisher>"#,
            escape_xml(&metadata.publisher)
        ));
        if let Some(file_as) = metadata
            .publisher_file_as
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            metadata_parts.push(format!(
                r##"<meta refines="#publisher" property="file-as">{}</meta>"##,
                escape_xml(file_as)
            ));
        }
        metadata_parts.push(String::new());
    }

    metadata_parts.push("<!-- 言語 -->".to_string());
    metadata_parts.push(format!("<dc:language>{}</dc:language>", metadata.language));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- ファイルid -->".to_string());
    metadata_parts.push(format!(
        r#"<dc:identifier id="BookId">{}</dc:identifier>"#,
        unique_id(metadata)
    ));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- 更新日 -->".to_string());
    metadata_parts.push(format!(
        r#"<meta property="dcterms:modified">{}</meta>"#,
        modified_now()
    ));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- レンダリング指定 -->".to_string());
    metadata_parts.push(r#"<meta property="rendition:layout">pre-paginated</meta>"#.to_string());
    metadata_parts.push(format!(
        r#"<meta property="rendition:orientation">{}</meta>"#,
        metadata.orientation.as_str()
    ));
    metadata_parts.push(format!(
        r#"<meta property="rendition:spread">{}</meta>"#,
        metadata.spread_mode.as_str()
    ));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- etc. -->".to_string());
    metadata_parts.push(r#"<meta property="ebpaj:guide-version">1.1.3</meta>"#.to_string());
    metadata_parts.push(r#"<meta property="kadokawa:version">1.3.1</meta>"#.to_string());
    metadata_parts.push(r#"<meta property="kadokawa:fix">1.3.1</meta>"#.to_string());
    metadata_parts.push(r#"<meta property="ibooks:specified-fonts">true</meta>"#.to_string());
    metadata_parts.push(r#"<meta property="ibooks:binding">false</meta>"#.to_string());
    metadata_parts.push(r#"<meta name="book-type" content="comic"/>"#.to_string());
    metadata_parts.push(format!(
        r#"<meta name="original-resolution" content="{}x{}"/>"#,
        metadata.viewport_width, metadata.viewport_height
    ));
    metadata_parts.push(r#"<meta name="orientation-lock" content="none"/>"#.to_string());
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- 基準サイズ -->".to_string());
    metadata_parts.push(format!(
        r#"<meta property="fixed-layout-jp:viewport">width={}, height={}</meta>"#,
        metadata.viewport_width, metadata.viewport_height
    ));

    let spine = build_spine(metadata, pages, true);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package
 xmlns="http://www.idpf.org/2007/opf"
 version="3.0"
 xml:lang="ja"
 unique-identifier="BookId"
 prefix="rendition: http://www.idpf.org/vocab/rendition/#
         ebpaj: http://www.ebpaj.jp/
         fixed-layout-jp: http://www.digital-comic.jp/
         kadokawa: http://www.kadokawa.co.jp/
         access: http://www.access-company.com/2012/layout#
         ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/"
>

<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">

{}

</metadata>

<manifest>

<!-- navigation -->
{}

<!-- style -->
{}

<!-- image -->
{}

<!-- xhtml -->
{}

</manifest>

<spine page-progression-direction="{}">

{}

</spine>

</package>
"#,
        metadata_parts.join("\n"),
        manifest[0],
        manifest[1..9].join("\n"),
        manifest[9..9 + pages.len()].join("\n"),
        manifest[9 + pages.len()..].join("\n"),
        metadata.page_direction.as_str(),
        spine.join("\n")
    )
}

fn generate_opf_hybrid(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let mut manifest = Vec::new();
    manifest.push(r#"<item media-type="application/xhtml+xml" id="toc" href="navigation-documents.xhtml" properties="nav"/>"#.to_string());
    manifest.push(
        r#"<item media-type="application/x-dtbncx+xml" id="ncx" href="toc.ncx"/>"#.to_string(),
    );
    manifest.extend([
        r#"<item media-type="text/css" id="fixed-layout-jp" href="style/fixed-layout-jp.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="book-style"      href="style/book-style.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-reset"     href="style/style-reset.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-standard"  href="style/style-standard.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-advance"   href="style/style-advance.css"/>"#
            .to_string(),
        r#"<item media-type="text/css" id="style-check"     href="style/style-check.css"/>"#
            .to_string(),
    ]);

    for (idx, page) in pages.iter().enumerate() {
        let filename = image_filename(&metadata.output_format, idx, page);
        let props = if page.is_cover {
            r#" properties="cover-image""#
        } else {
            ""
        };
        manifest.push(
            format!(
                r#"<item media-type="{}" id="{}"          href="{}/{}"{} />"#,
                image_media_type(&filename),
                image_id(&metadata.output_format, idx, page),
                image_folder(&metadata.output_format),
                filename,
                props
            )
            .replace(" />", "/>"),
        );
    }

    for (idx, page) in pages.iter().enumerate() {
        let pid = page_id(&metadata.output_format, idx, page);
        let iid = image_id(&metadata.output_format, idx, page);
        manifest.push(format!(
            r#"<item media-type="application/xhtml+xml" id="{pid}"        href="{}/{}.xhtml"        properties="svg" fallback="{iid}"/>"#,
            xhtml_folder(&metadata.output_format),
            pid
        ));
    }

    let mut metadata_parts = Vec::new();
    metadata_parts.push("<!-- 作品名 -->".to_string());
    metadata_parts.push(format!(
        r#"<dc:title id="title01">{}</dc:title>"#,
        escape_xml(&metadata.title)
    ));
    metadata_parts
        .push(r##"<meta refines="#title01" property="title-type">main</meta>"##.to_string());
    if let Some(file_as) = metadata.title_file_as.as_deref().filter(|s| !s.is_empty()) {
        metadata_parts.push(format!(
            r##"<meta refines="#title01" property="file-as">{}</meta>"##,
            escape_xml(file_as)
        ));
    }
    metadata_parts
        .push(r##"<meta refines="#title01" property="display-seq">1</meta>"##.to_string());
    metadata_parts.push(String::new());

    if !metadata.authors.is_empty() {
        metadata_parts.push("<!-- 著者名 -->".to_string());
        for (i, author) in metadata.authors.iter().enumerate() {
            if author.name.trim().is_empty() {
                continue;
            }
            let creator_id = format!("creator{:02}", i + 1);
            metadata_parts.push(format!(
                r#"<dc:creator id="{creator_id}">{}</dc:creator>"#,
                escape_xml(&author.name)
            ));
            metadata_parts.push(format!(r##"<meta refines="#{creator_id}" property="role" scheme="marc:relators">{}</meta>"##, author.role.as_str()));
            if let Some(file_as) = author.file_as.as_deref().filter(|s| !s.is_empty()) {
                metadata_parts.push(format!(
                    r##"<meta refines="#{creator_id}" property="file-as">{}</meta>"##,
                    escape_xml(file_as)
                ));
            }
            metadata_parts.push(format!(
                r##"<meta refines="#{creator_id}" property="display-seq">{}</meta>"##,
                i + 1
            ));
        }
        metadata_parts.push(String::new());
    }

    if !metadata.publisher.trim().is_empty() {
        metadata_parts.push("<!-- 出版社名 -->".to_string());
        metadata_parts.push(format!(
            r#"<dc:publisher id="publisher">{}</dc:publisher>"#,
            escape_xml(&metadata.publisher)
        ));
        if let Some(file_as) = metadata
            .publisher_file_as
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            metadata_parts.push(format!(
                r##"<meta refines="#publisher" property="file-as">{}</meta>"##,
                escape_xml(file_as)
            ));
        }
        metadata_parts.push(String::new());
    }

    metadata_parts.push("<!-- 言語 -->".to_string());
    metadata_parts.push(format!("<dc:language>{}</dc:language>", metadata.language));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- ファイルid -->".to_string());
    metadata_parts.push(format!(
        r#"<dc:identifier id="bw-ecode">{}</dc:identifier>"#,
        metadata.book_uuid.to_uppercase()
    ));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- 更新日 -->".to_string());
    metadata_parts.push(format!(
        r#"<meta property="dcterms:modified">{}</meta>"#,
        modified_now()
    ));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- Fixed-Layout Documents指定 -->".to_string());
    metadata_parts.push(r#"<meta property="rendition:layout">pre-paginated</meta>"#.to_string());
    metadata_parts.push(format!(
        r#"<meta property="rendition:spread">{}</meta>"#,
        metadata.spread_mode.as_str()
    ));
    metadata_parts.push(format!(
        r#"<meta property="rendition:orientation">{}</meta>"#,
        metadata.orientation.as_str()
    ));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- etc. -->".to_string());
    metadata_parts.push(r#"<meta property="ebpaj:guide-version">1.1.2</meta>"#.to_string());
    metadata_parts.push(r#"<meta property="kadokawa:version">1.0.1</meta>"#.to_string());
    metadata_parts.push(r#"<meta property="ibooks:specified-fonts">true</meta>"#.to_string());
    metadata_parts.push(r#"<meta property="ibooks:binding">false</meta>"#.to_string());
    metadata_parts.push(r#"<meta name="book-type" content="comic"/>"#.to_string());
    metadata_parts.push(format!(
        r#"<meta name="original-resolution" content="{}x{}"/>"#,
        metadata.viewport_width, metadata.viewport_height
    ));
    metadata_parts.push(r#"<meta name="orientation-lock" content="none"/>"#.to_string());
    metadata_parts.push(r#"<meta name="fixed-layout" content="true"/>"#.to_string());
    let writing_mode = if metadata.page_direction == PageDirection::Rtl {
        "horizontal-rl"
    } else {
        "horizontal-lr"
    };
    metadata_parts.push(format!(
        r#"<meta name="primary-writing-mode" content="{writing_mode}"/>"#
    ));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- 基準サイズ -->".to_string());
    metadata_parts.push(format!(
        r#"<meta property="fixed-layout-jp:viewport">width={}, height={}</meta>"#,
        metadata.viewport_width, metadata.viewport_height
    ));

    let spine = build_spine(metadata, pages, true);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package
 xmlns="http://www.idpf.org/2007/opf"
 version="3.0"
 xml:lang="ja"
 unique-identifier="bw-ecode"
 prefix="rendition: http://www.idpf.org/vocab/rendition/#
         ebpaj: http://www.ebpaj.jp/
         fixed-layout-jp: http://www.digital-comic.jp/
         kadokawa: http://www.kadokawa.co.jp/
         access: http://www.access-company.com/2012/layout#
         ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/"
>

<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">

{}

</metadata>

<manifest>

<!-- navigation -->
{}

<!-- style -->
{}

<!-- image -->
{}

<!-- xhtml -->
{}

</manifest>

<spine page-progression-direction="{}" toc="ncx">

{}

</spine>

</package>
"#,
        metadata_parts.join("\n"),
        manifest[..2].join("\n"),
        manifest[2..8].join("\n"),
        manifest[8..8 + pages.len()].join("\n"),
        manifest[8 + pages.len()..].join("\n"),
        metadata.page_direction.as_str(),
        spine.join("\n")
    )
}

fn generate_opf_oebps(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let mut manifest = Vec::new();
    manifest.push(
        r#"<item media-type="application/xhtml+xml" id="toc" href="toc.xhtml" properties="nav" />"#
            .to_string(),
    );
    manifest.push(
        r#"<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />"#.to_string(),
    );
    manifest.push(format!(
        r#"<item media-type="text/css" id="style-fixed-layout-jp" href="{}/fixed.css"/>"#,
        style_folder(&metadata.output_format)
    ));

    for (idx, page) in pages.iter().enumerate() {
        let filename = image_filename(&metadata.output_format, idx, page);
        let props = if page.is_cover {
            r#" properties="cover-image""#
        } else {
            ""
        };
        manifest.push(format!(
            r#"<item id="{}" href="{}/{}"{} media-type="{}" />"#,
            image_id(&metadata.output_format, idx, page),
            image_folder(&metadata.output_format),
            filename,
            props,
            image_media_type(&filename)
        ));
    }
    for (idx, page) in pages.iter().enumerate() {
        let pid = page_id(&metadata.output_format, idx, page);
        manifest.push(format!(
            r#"<item id="{pid}" href="{}/{}.xhtml" properties="svg" media-type="application/xhtml+xml" />"#,
            xhtml_folder(&metadata.output_format),
            pid
        ));
    }

    let mut metadata_parts = Vec::new();
    metadata_parts.push("<!-- TITLE -->".to_string());
    metadata_parts.push(format!(
        r#"<dc:title id="title">{}</dc:title>"#,
        escape_xml(&metadata.title)
    ));
    if let Some(file_as) = metadata.title_file_as.as_deref().filter(|s| !s.is_empty()) {
        metadata_parts.push(format!(
            r##"<meta refines="#title" property="file-as">{}</meta>"##,
            escape_xml(file_as)
        ));
    }
    let combined_author = combined_author_name_oebps(metadata);
    if !combined_author.is_empty() {
        metadata_parts.push("<!-- AUTHOR -->".to_string());
        metadata_parts.push(format!(
            r#"<dc:creator id="creator1">{}</dc:creator>"#,
            escape_xml(&combined_author)
        ));
        metadata_parts.push(format!(
            r##"<meta refines="#creator1" property="role" scheme="marc:relators">{}</meta>"##,
            primary_author_role(metadata)
        ));
        let file_as = combined_author_file_as(metadata);
        if !file_as.is_empty() {
            metadata_parts.push(format!(
                r##"<meta refines="#creator1" property="file-as">{}</meta>"##,
                escape_xml(&file_as)
            ));
            metadata_parts.push(format!(r##"<meta refines="#creator1" property="alternate-script" xml:lang="ja-kana-jp">{}</meta>"##, escape_xml(&file_as)));
        }
        metadata_parts
            .push(r##"<meta refines="#creator1" property="display-seq">1</meta>"##.to_string());
    }
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- PUBLISHER -->".to_string());
    if !metadata.publisher.trim().is_empty() {
        metadata_parts.push(format!(
            "<dc:publisher>{}</dc:publisher>",
            escape_xml(&metadata.publisher)
        ));
    }
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- LANGUAGE -->".to_string());
    metadata_parts.push(format!("<dc:language>{}</dc:language>", metadata.language));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- FILE ID -->".to_string());
    metadata_parts.push(format!(
        r#"<dc:identifier id="pub-id">{}</dc:identifier>"#,
        unique_id(metadata)
    ));
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- MODIFIED DATE -->".to_string());
    let now = modified_now();
    metadata_parts.push(format!(r#"<meta property="dcterms:modified">{now}</meta>"#));
    metadata_parts.push(format!("<dc:date>{now}</dc:date>"));
    metadata_parts.push("<!-- Fixed-Layout Documents -->".to_string());
    metadata_parts.push(r#"<meta property="rendition:layout">pre-paginated</meta>"#.to_string());
    metadata_parts.push(format!(
        r#"<meta property="rendition:spread">{}</meta>"#,
        metadata.spread_mode.as_str()
    ));
    metadata_parts.push(r#"<meta name="fixed-layout" content="true" />"#.to_string());
    metadata_parts.push(r#"<meta name="orientation-lock" content="none" />"#.to_string());
    metadata_parts.push(format!(
        r#"<meta name="original-resolution" content="{}x{}" />"#,
        metadata.viewport_width, metadata.viewport_height
    ));
    metadata_parts.push(r#"<meta name="book-type" content="comic" />"#.to_string());
    let writing_mode = if metadata.page_direction == PageDirection::Rtl {
        "horizontal-rl"
    } else {
        "horizontal-lr"
    };
    metadata_parts.push(format!(
        r#"<meta name="primary-writing-mode" content="{writing_mode}" />"#
    ));
    metadata_parts.push(r##"<meta name="SpineColor" content="#ffffff" />"##.to_string());
    metadata_parts.push(String::new());
    metadata_parts.push("<!-- etc. -->".to_string());
    metadata_parts.push(r#"<meta name="cover" content="cover" />"#.to_string());
    metadata_parts.push("<dc:type>comic</dc:type>".to_string());

    let spine = build_spine(metadata, pages, false);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" xml:lang="ja" unique-identifier="pub-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
{}
</metadata>

<manifest>
<!-- navigation -->
{}
<!-- style -->
{}

<!-- image -->
{}

<!-- xhtml -->
{}

</manifest>

<spine page-progression-direction="{}" toc="ncx">
{}

</spine>
</package>
"#,
        metadata_parts.join("\n"),
        manifest[..2].join("\n"),
        manifest[2],
        manifest[3..3 + pages.len()].join("\n"),
        manifest[3 + pages.len()..].join("\n"),
        metadata.page_direction.as_str(),
        spine.join("\n")
    )
}

pub fn generate_page_xhtml(metadata: &EpubMetadata, idx: usize, page: &EpubPage) -> String {
    let format = &metadata.output_format;
    let width = metadata.viewport_width;
    let height = metadata.viewport_height;
    let filename = image_filename(format, idx, page);

    if *format == EpubFormat::Kadokawa || *format == EpubFormat::Hybrid {
        let body_attr = if page.is_cover {
            r#" epub:type="cover""#
        } else {
            ""
        };
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html
 xmlns="http://www.w3.org/1999/xhtml"
 xmlns:epub="http://www.idpf.org/2007/ops"
 xml:lang="ja"
>
<head>
<meta charset="UTF-8"/>
<title>{}</title>
<link rel="stylesheet" type="text/css" href="../style/fixed-layout-jp.css"/>
<meta name="viewport" content="width={width}, height={height}"/>
</head>
<body{body_attr}>
<div class="main">

<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
 xmlns:xlink="http://www.w3.org/1999/xlink"
 width="100%" height="100%" viewBox="0 0 {width} {height}">
<image width="{width}" height="{height}" xlink:href="../{}/{}"/>
</svg>

</div>
</body>
</html>
"#,
            escape_xml(&metadata.title),
            image_folder(format),
            filename
        )
    } else {
        let div_open = if page.is_cover {
            r#"<div id="top">"#
        } else {
            "<div>"
        };
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head>
<meta charset="UTF-8"/>
<title>{}</title>
<link rel="stylesheet" type="text/css" href="../styles/fixed.css"/>
<meta name="viewport" content="width={width}, height={height}"/>
</head>
<body>
{div_open}
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
 xmlns:xlink="http://www.w3.org/1999/xlink"
 width="100%" height="100%" viewBox="0 0 {width} {height}">
<image width="{width}" height="{height}" xlink:href="../{}/{}"/>
</svg>
</div>
</body>
</html>
"#,
            escape_xml(&metadata.title),
            image_folder(format),
            filename
        )
    }
}

pub fn generate_nav_xhtml(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    match metadata.output_format {
        EpubFormat::Kadokawa => generate_nav_kadokawa(metadata, pages),
        EpubFormat::Hybrid => generate_nav_hybrid(metadata, pages),
        EpubFormat::Oebps => generate_toc_xhtml_oebps(metadata, pages),
    }
}

fn cover_colophon_body_ids(
    metadata: &EpubMetadata,
    pages: &[EpubPage],
) -> (Option<String>, Option<String>, Option<String>) {
    let mut cover_id = None;
    let mut colophon_id = None;
    let mut first_content_id = None;
    for (idx, page) in pages.iter().enumerate() {
        let pid = page_id(&metadata.output_format, idx, page);
        if page.is_cover {
            cover_id = Some(pid);
        } else if page.is_colophon {
            colophon_id = Some(pid);
        } else if first_content_id.is_none() {
            first_content_id = Some(pid);
        }
    }
    (cover_id, colophon_id, first_content_id)
}

fn generate_nav_kadokawa(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let (cover_id, colophon_id, first_content_id) = cover_colophon_body_ids(metadata, pages);
    let mut toc_items = Vec::new();
    if let Some(id) = cover_id.as_deref() {
        toc_items.push(format!(
            r#"<li><a href="{}/{}.xhtml">表紙</a></li>"#,
            xhtml_folder(&metadata.output_format),
            id
        ));
    }
    if let Some(id) = colophon_id.as_deref() {
        toc_items.push(format!(
            r#"<li><a href="{}/{}.xhtml">奥付</a></li>"#,
            xhtml_folder(&metadata.output_format),
            id
        ));
    }
    let mut landmarks_items = Vec::new();
    if let Some(id) = cover_id.as_deref() {
        landmarks_items.push(format!(
            r#"<li><a epub:type="cover"      href="{}/{}.xhtml">表紙</a></li>"#,
            xhtml_folder(&metadata.output_format),
            id
        ));
    }
    if let Some(id) = first_content_id.as_deref() {
        landmarks_items.push(format!(
            r#"<li><a epub:type="bodymatter" href="{}/{}.xhtml">本編</a></li>"#,
            xhtml_folder(&metadata.output_format),
            id
        ));
    }
    generate_navigation_document(&toc_items, &landmarks_items)
}

fn generate_nav_hybrid(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let (cover_id, colophon_id, _) = cover_colophon_body_ids(metadata, pages);
    let mut toc_items = Vec::new();
    if let Some(id) = cover_id.as_deref() {
        toc_items.push(format!(
            r#"<li><a href="{}/{}.xhtml">表紙</a></li>"#,
            xhtml_folder(&metadata.output_format),
            id
        ));
    }
    if let Some(id) = colophon_id.as_deref() {
        toc_items.push(format!(
            r#"<li><a href="{}/{}.xhtml">奥付</a></li>"#,
            xhtml_folder(&metadata.output_format),
            id
        ));
    }
    let mut landmarks_items = Vec::new();
    if let Some(id) = cover_id.as_deref() {
        landmarks_items.push(format!(
            r#"<li><a epub:type="cover"      href="{}/{}.xhtml">表紙</a></li>"#,
            xhtml_folder(&metadata.output_format),
            id
        ));
    }
    generate_navigation_document(&toc_items, &landmarks_items)
}

fn generate_navigation_document(toc_items: &[String], landmarks_items: &[String]) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html
 xmlns="http://www.w3.org/1999/xhtml"
 xmlns:epub="http://www.idpf.org/2007/ops"
 xml:lang="ja"
>
<head>
<meta charset="UTF-8"/>
<title>Navigation</title>
</head>
<body>

<nav epub:type="toc" id="toc">
<h1>Navigation</h1>
<ol>
{}
</ol>
</nav>

<nav epub:type="landmarks" id="guide">
<h1>Guide</h1>
<ol>
{}
</ol>
</nav>

</body>
</html>
"#,
        toc_items.join("\n"),
        landmarks_items.join("\n")
    )
}

fn generate_toc_xhtml_oebps(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let cover_id = pages
        .iter()
        .enumerate()
        .find(|(_, page)| page.is_cover)
        .map(|(idx, page)| page_id(&metadata.output_format, idx, page))
        .or_else(|| {
            pages
                .first()
                .map(|page| page_id(&metadata.output_format, 0, page))
        })
        .unwrap_or_else(|| "book_000".to_string());
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns = "http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head>
<meta charset="UTF-8" />
<title>Navigation</title>
</head>
<body>
<nav epub:type="toc" id="toc">
<h1>Navigation</h1>
<ol>
<li><a href="{}/{}.xhtml">{}</a></li>

</ol>
</nav>
<nav epub:type="landmarks" id="guide">
<h1>Guide</h1>
<ol>
<li><a epub:type="cover" href="{}/{}.xhtml">表紙</a></li>

</ol>
</nav>
</body>
</html>
"#,
        xhtml_folder(&metadata.output_format),
        cover_id,
        escape_xml(&metadata.title),
        xhtml_folder(&metadata.output_format),
        cover_id
    )
}

pub fn generate_ncx(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    match metadata.output_format {
        EpubFormat::Hybrid => generate_ncx_hybrid(metadata, pages),
        EpubFormat::Oebps => generate_ncx_oebps(metadata, pages),
        EpubFormat::Kadokawa => String::new(),
    }
}

fn generate_ncx_hybrid(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let cover_id = pages
        .iter()
        .enumerate()
        .find(|(_, page)| page.is_cover)
        .map(|(idx, page)| page_id(&metadata.output_format, idx, page))
        .or_else(|| {
            pages
                .first()
                .map(|page| page_id(&metadata.output_format, 0, page))
        })
        .unwrap_or_else(|| "p-cover".to_string());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="{}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>Navigation</text></docTitle>
<navMap>

<navPoint id="xhtml-{}" playOrder="1">
<navLabel><text>表紙</text></navLabel>
<content src="{}/{}.xhtml"/>
</navPoint>

</navMap>
</ncx>
"#,
        metadata.book_uuid.to_uppercase(),
        cover_id,
        xhtml_folder(&metadata.output_format),
        cover_id
    )
}

fn generate_ncx_oebps(metadata: &EpubMetadata, pages: &[EpubPage]) -> String {
    let cover_id = pages
        .iter()
        .enumerate()
        .find(|(_, page)| page.is_cover)
        .map(|(idx, page)| page_id(&metadata.output_format, idx, page))
        .or_else(|| {
            pages
                .first()
                .map(|page| page_id(&metadata.output_format, 0, page))
        })
        .unwrap_or_else(|| "book_000".to_string());
    format!(
        r#"<?xml version='1.0' encoding='UTF-8'?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
	<head>
		<meta name="dtb:uid" content="{}" />
		<meta name="dtb:depth" content="1" />
		<meta name="dtb:totalPageCount" content="0" />
		<meta name="dtb:maxPageNumber" content="0" />
	</head>
	<docTitle>
		<text>{}</text>
	</docTitle>
	<docAuthor>
		<text></text>
	</docAuthor>
	<navMap>
		<navPoint id="navPoint-1" playOrder="1">
			<navLabel>
				<text>{}</text>
			</navLabel>
			<content src="{}/{}.xhtml#top" />

		</navPoint>
	</navMap>
</ncx>
"#,
        unique_id(metadata),
        escape_xml(&metadata.title),
        escape_xml(&metadata.title),
        xhtml_folder(&metadata.output_format),
        cover_id
    )
}

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
            "style-check.css",
        ],
        EpubFormat::Oebps => vec!["fixed.css"],
    }
}
