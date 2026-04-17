use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use zip::write::FileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::types::{EpubFormat, EpubGenerateConfig, EpubGenerateResponse, HybridCssProfile};

use super::templates::{
    generate_container_xml, generate_nav_xhtml, generate_ncx, generate_opf, generate_page_xhtml,
    get_css_files_for_format, image_filename, image_folder, opf_filename, page_id, root_folder,
    style_folder, xhtml_folder, MIMETYPE,
};

/// EPUBビルダー
pub struct EpubBuilder {
    config: EpubGenerateConfig,
    temp_dir: PathBuf,
    css_resource_dir: Option<PathBuf>,
}

impl EpubBuilder {
    /// 新しいビルダーを作成
    pub fn new(config: EpubGenerateConfig) -> Self {
        let temp_dir = std::env::temp_dir().join(format!("epub_build_{}", uuid::Uuid::new_v4()));
        Self {
            config,
            temp_dir,
            css_resource_dir: None,
        }
    }

    /// CSSリソースディレクトリを設定
    pub fn with_css_resource_dir(mut self, dir: PathBuf) -> Self {
        self.css_resource_dir = Some(dir);
        self
    }

    /// EPUBを生成
    pub fn build(self) -> Result<EpubGenerateResponse, String> {
        // 一時ディレクトリを作成
        fs::create_dir_all(&self.temp_dir)
            .map_err(|e| format!("Failed to create temp directory: {}", e))?;

        let result = self.build_internal();

        // 一時ディレクトリをクリーンアップ
        let _ = fs::remove_dir_all(&self.temp_dir);

        result
    }

    fn build_internal(&self) -> Result<EpubGenerateResponse, String> {
        let format = &self.config.metadata.output_format;

        // EPUB内部構造を作成
        self.create_directory_structure()?;

        // mimetype を作成
        self.write_mimetype()?;

        // META-INF/container.xml を作成
        self.write_container_xml()?;

        // 画像ファイルをコピー
        self.copy_images()?;

        // CSSファイルをコピー
        self.copy_css_files()?;

        // カスタムCSSがあれば追記
        if let Some(ref custom_css) = self.config.custom_css {
            self.write_custom_css(custom_css)?;
        }

        // ページXHTMLを生成
        self.write_page_xhtmls()?;

        // Navigation XHTML を生成
        self.write_nav_xhtml()?;

        // OPF を生成
        self.write_opf()?;

        // Hybrid/OEBPS形式の場合はNCXも生成
        if *format == EpubFormat::Hybrid || *format == EpubFormat::Oebps {
            self.write_ncx()?;
        }

        // ZIPで梱包
        let file_size = self.package_epub()?;

        Ok(EpubGenerateResponse {
            success: true,
            output_path: self.config.output_path.clone(),
            page_count: self.config.pages.len(),
            file_size,
            error: None,
        })
    }

    /// EPUB内部のディレクトリ構造を作成
    fn create_directory_structure(&self) -> Result<(), String> {
        let format = &self.config.metadata.output_format;

        let dirs = match format {
            EpubFormat::Kadokawa | EpubFormat::Hybrid => {
                vec!["META-INF", "item/image", "item/xhtml", "item/style"]
            }
            EpubFormat::Oebps => vec!["META-INF", "OEBPS/images", "OEBPS/text", "OEBPS/styles"],
        };

        for dir in dirs {
            fs::create_dir_all(self.temp_dir.join(dir))
                .map_err(|e| format!("Failed to create directory {}: {}", dir, e))?;
        }

        Ok(())
    }

    /// mimetype ファイルを作成
    fn write_mimetype(&self) -> Result<(), String> {
        let path = self.temp_dir.join("mimetype");
        fs::write(&path, MIMETYPE).map_err(|e| format!("Failed to write mimetype: {}", e))
    }

    /// META-INF/container.xml を作成
    fn write_container_xml(&self) -> Result<(), String> {
        let content = generate_container_xml(&self.config.metadata);
        let path = self.temp_dir.join("META-INF/container.xml");
        fs::write(&path, content).map_err(|e| format!("Failed to write container.xml: {}", e))
    }

    /// 画像ファイルをコピー
    fn copy_images(&self) -> Result<(), String> {
        let format = &self.config.metadata.output_format;
        let image_dir = self
            .temp_dir
            .join(root_folder(format))
            .join(image_folder(format));

        for (idx, page) in self.config.pages.iter().enumerate() {
            let src = Path::new(&page.source_path);
            if !src.exists() {
                return Err(format!("Source image not found: {}", page.source_path));
            }

            let dest_filename = image_filename(format, idx, page);
            let dest = image_dir.join(&dest_filename);
            fs::copy(src, &dest)
                .map_err(|e| format!("Failed to copy image {}: {}", dest_filename, e))?;
        }

        Ok(())
    }

    /// CSSファイルをコピー
    fn copy_css_files(&self) -> Result<(), String> {
        let format = &self.config.metadata.output_format;
        let css_files = get_css_files_for_format(format);
        let style_dir = self
            .temp_dir
            .join(root_folder(format))
            .join(style_folder(format));

        // CSSリソースディレクトリが指定されている場合
        if let Some(ref resource_dir) = self.css_resource_dir {
            for css_file in &css_files {
                let src = self.css_source_dir(resource_dir).join(css_file);
                let dest = style_dir.join(css_file);

                if src.exists() {
                    fs::copy(&src, &dest)
                        .map_err(|e| format!("Failed to copy CSS {}: {}", css_file, e))?;
                } else {
                    // リソースがない場合は最小限のCSSを生成
                    self.write_minimal_css(&dest)?;
                }
            }
        } else {
            // リソースディレクトリがない場合は最小限のCSSを生成
            for css_file in &css_files {
                let dest = style_dir.join(css_file);
                self.write_minimal_css(&dest)?;
            }
        }

        Ok(())
    }

    fn css_source_dir(&self, default_resource_dir: &Path) -> PathBuf {
        let metadata = &self.config.metadata;
        if metadata.output_format == EpubFormat::Hybrid
            && metadata.hybrid_css_profile == HybridCssProfile::Legacy
        {
            if let Some(parent) = default_resource_dir.parent() {
                let legacy_dir = parent.join("hybrid_legacy_css");
                if legacy_dir.exists() {
                    return legacy_dir;
                }
            }
        }
        default_resource_dir.to_path_buf()
    }

    /// 最小限のCSSを生成
    fn write_minimal_css(&self, path: &Path) -> Result<(), String> {
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("style.css");

        let content = if filename == "fixed-layout-jp.css" {
            r#"@charset "UTF-8";
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}
svg {
  margin: 0;
  padding: 0;
}
.main {
  width: 100%;
  height: 100%;
}
"#
        } else {
            "/* Placeholder CSS */\n"
        };

        fs::write(path, content).map_err(|e| format!("Failed to write CSS {}: {}", filename, e))
    }

    /// カスタムCSSを追記
    fn write_custom_css(&self, custom_css: &str) -> Result<(), String> {
        let format = &self.config.metadata.output_format;
        let style_dir = self
            .temp_dir
            .join(root_folder(format))
            .join(style_folder(format));
        let book_style_path = style_dir.join("book-style.css");

        if book_style_path.exists() {
            // 既存のbook-style.cssに追記
            let mut file = fs::OpenOptions::new()
                .append(true)
                .open(&book_style_path)
                .map_err(|e| format!("Failed to open book-style.css: {}", e))?;

            file.write_all(b"\n/* Custom CSS */\n")
                .map_err(|e| format!("Failed to write custom CSS: {}", e))?;
            file.write_all(custom_css.as_bytes())
                .map_err(|e| format!("Failed to write custom CSS: {}", e))?;
        }

        Ok(())
    }

    /// ページXHTMLを生成
    fn write_page_xhtmls(&self) -> Result<(), String> {
        let format = &self.config.metadata.output_format;
        let xhtml_dir = self
            .temp_dir
            .join(root_folder(format))
            .join(xhtml_folder(format));

        for (idx, page) in self.config.pages.iter().enumerate() {
            let content = generate_page_xhtml(&self.config.metadata, idx, page);
            let page_id = page_id(format, idx, page);
            let path = xhtml_dir.join(format!("{}.xhtml", page_id));
            fs::write(&path, content)
                .map_err(|e| format!("Failed to write page XHTML {}: {}", page_id, e))?;
        }

        Ok(())
    }

    /// Navigation XHTML を生成
    fn write_nav_xhtml(&self) -> Result<(), String> {
        let format = &self.config.metadata.output_format;
        let content = generate_nav_xhtml(&self.config.metadata, &self.config.pages);
        let path = match format {
            EpubFormat::Kadokawa | EpubFormat::Hybrid => self
                .temp_dir
                .join(root_folder(format))
                .join("navigation-documents.xhtml"),
            EpubFormat::Oebps => self.temp_dir.join(root_folder(format)).join("toc.xhtml"),
        };
        fs::write(&path, content).map_err(|e| format!("Failed to write navigation: {}", e))
    }

    /// OPF を生成
    fn write_opf(&self) -> Result<(), String> {
        let format = &self.config.metadata.output_format;
        let content = generate_opf(&self.config.metadata, &self.config.pages);

        let opf_path = self
            .temp_dir
            .join(root_folder(format))
            .join(opf_filename(&self.config.metadata));

        fs::write(&opf_path, content).map_err(|e| format!("Failed to write OPF: {}", e))
    }

    /// NCX を生成 (Hybrid形式用)
    fn write_ncx(&self) -> Result<(), String> {
        let format = &self.config.metadata.output_format;
        let content = generate_ncx(&self.config.metadata, &self.config.pages);
        let path = self.temp_dir.join(root_folder(format)).join("toc.ncx");
        fs::write(&path, content).map_err(|e| format!("Failed to write NCX: {}", e))
    }

    /// ZIPで梱包してEPUBファイルを生成
    fn package_epub(&self) -> Result<u64, String> {
        let output_path = Path::new(&self.config.output_path);

        // 親ディレクトリを作成
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create output directory: {}", e))?;
        }

        let file =
            File::create(output_path).map_err(|e| format!("Failed to create EPUB file: {}", e))?;

        let mut zip = ZipWriter::new(file);

        // mimetype は最初に、非圧縮で追加（EPUB仕様）
        let options_stored = FileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);

        zip.start_file("mimetype", options_stored)
            .map_err(|e| format!("Failed to add mimetype: {}", e))?;
        zip.write_all(MIMETYPE.as_bytes())
            .map_err(|e| format!("Failed to write mimetype: {}", e))?;

        // その他のファイルは圧縮
        let options_deflated = FileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);

        let format = &self.config.metadata.output_format;
        let root = root_folder(format);
        let opf_name = opf_filename(&self.config.metadata);

        self.add_file_to_zip(
            &mut zip,
            &self.temp_dir.join("META-INF/container.xml"),
            "META-INF/container.xml",
            options_deflated,
        )?;
        self.add_file_to_zip(
            &mut zip,
            &self.temp_dir.join(root).join(&opf_name),
            &format!("{}/{}", root, opf_name),
            options_deflated,
        )?;

        match format {
            EpubFormat::Kadokawa => {
                self.add_file_to_zip(
                    &mut zip,
                    &self.temp_dir.join(root).join("navigation-documents.xhtml"),
                    &format!("{}/navigation-documents.xhtml", root),
                    options_deflated,
                )?;
            }
            EpubFormat::Hybrid => {
                self.add_file_to_zip(
                    &mut zip,
                    &self.temp_dir.join(root).join("navigation-documents.xhtml"),
                    &format!("{}/navigation-documents.xhtml", root),
                    options_deflated,
                )?;
                self.add_file_to_zip(
                    &mut zip,
                    &self.temp_dir.join(root).join("toc.ncx"),
                    &format!("{}/toc.ncx", root),
                    options_deflated,
                )?;
            }
            EpubFormat::Oebps => {
                self.add_file_to_zip(
                    &mut zip,
                    &self.temp_dir.join(root).join("toc.xhtml"),
                    &format!("{}/toc.xhtml", root),
                    options_deflated,
                )?;
                self.add_file_to_zip(
                    &mut zip,
                    &self.temp_dir.join(root).join("toc.ncx"),
                    &format!("{}/toc.ncx", root),
                    options_deflated,
                )?;
            }
        }

        self.add_sorted_files_to_zip(
            &mut zip,
            &self.temp_dir.join(root).join(style_folder(format)),
            &format!("{}/{}", root, style_folder(format)),
            &["css"],
            options_deflated,
            options_deflated,
        )?;
        self.add_sorted_files_to_zip(
            &mut zip,
            &self.temp_dir.join(root).join(xhtml_folder(format)),
            &format!("{}/{}", root, xhtml_folder(format)),
            &["xhtml"],
            options_deflated,
            options_deflated,
        )?;
        self.add_sorted_files_to_zip(
            &mut zip,
            &self.temp_dir.join(root).join(image_folder(format)),
            &format!("{}/{}", root, image_folder(format)),
            &["jpg", "jpeg", "png"],
            options_deflated,
            options_stored,
        )?;

        zip.finish()
            .map_err(|e| format!("Failed to finalize EPUB: {}", e))?;

        // ファイルサイズを取得
        let metadata =
            fs::metadata(output_path).map_err(|e| format!("Failed to get file size: {}", e))?;

        Ok(metadata.len())
    }

    fn add_file_to_zip(
        &self,
        zip: &mut ZipWriter<File>,
        path: &Path,
        zip_path: &str,
        options: FileOptions,
    ) -> Result<(), String> {
        zip.start_file(zip_path, options)
            .map_err(|e| format!("Failed to add file {}: {}", zip_path, e))?;

        let mut file =
            File::open(path).map_err(|e| format!("Failed to open {}: {}", zip_path, e))?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|e| format!("Failed to read {}: {}", zip_path, e))?;
        zip.write_all(&buffer)
            .map_err(|e| format!("Failed to write {}: {}", zip_path, e))?;

        Ok(())
    }

    fn add_sorted_files_to_zip(
        &self,
        zip: &mut ZipWriter<File>,
        dir: &Path,
        zip_prefix: &str,
        extensions: &[&str],
        options_deflated: FileOptions,
        options_stored: FileOptions,
    ) -> Result<(), String> {
        if !dir.exists() {
            return Ok(());
        }

        let mut paths = fs::read_dir(dir)
            .map_err(|e| format!("Failed to read directory {}: {}", dir.display(), e))?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read directory entry: {}", e))?;
        paths.sort();

        for path in paths {
            if !path.is_file() {
                continue;
            }

            let ext = path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !extensions.iter().any(|allowed| *allowed == ext) {
                continue;
            }

            let filename = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| format!("Invalid file name: {}", path.display()))?;
            let zip_path = format!("{}/{}", zip_prefix, filename);
            let options = if ext == "jpg" || ext == "jpeg" {
                options_stored
            } else {
                options_deflated
            };
            self.add_file_to_zip(zip, &path, &zip_path, options)?;
        }

        Ok(())
    }
}
