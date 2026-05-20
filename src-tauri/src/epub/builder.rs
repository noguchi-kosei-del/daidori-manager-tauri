use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageEncoder};
use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use zip::write::FileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::types::{
    EpubFormat, EpubGenerateConfig, EpubGenerateResponse, EpubImageColorPolicy,
    EpubImageProfileSummary, EpubPage, EpubPageImageProfileOverride, HybridCssProfile,
};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EpubProgressPayload<'a> {
    phase: &'a str,
    current: usize,
    total: usize,
}

const EPUB_JPEG_QUALITY: u8 = 90;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EpubImageTarget {
    RgbSrgb,
    GrayscaleDotGain,
    NoIcc,
    PreserveOriginal,
}

#[derive(Debug, Clone, Default)]
struct ImageCopyResult {
    rgb_srgb_count: usize,
    grayscale_dot_gain_count: usize,
    grayscale_no_profile_count: usize,
    no_icc_count: usize,
    preserved_original_count: usize,
    warnings: Vec<String>,
}

impl ImageCopyResult {
    fn merge(mut self, other: ImageCopyResult) -> Self {
        self.rgb_srgb_count += other.rgb_srgb_count;
        self.grayscale_dot_gain_count += other.grayscale_dot_gain_count;
        self.grayscale_no_profile_count += other.grayscale_no_profile_count;
        self.no_icc_count += other.no_icc_count;
        self.preserved_original_count += other.preserved_original_count;
        self.warnings.extend(other.warnings);
        self
    }

    fn into_summary(mut self) -> EpubImageProfileSummary {
        self.warnings.sort();
        self.warnings.dedup();
        EpubImageProfileSummary {
            rgb_srgb_count: self.rgb_srgb_count,
            grayscale_dot_gain_count: self.grayscale_dot_gain_count,
            grayscale_no_profile_count: self.grayscale_no_profile_count,
            no_icc_count: self.no_icc_count,
            preserved_original_count: self.preserved_original_count,
            warnings: self.warnings,
        }
    }
}

fn replace_filename_ext(filename: &str, new_ext: &str) -> String {
    match filename.rsplit_once('.') {
        Some((stem, _)) => format!("{}.{}", stem, new_ext),
        None => format!("{}.{}", filename, new_ext),
    }
}

fn source_needs_conversion(source_path: &str) -> Option<&'static str> {
    let lower = source_path.to_ascii_lowercase();
    if lower.ends_with(".psd") {
        Some("psd")
    } else if lower.ends_with(".tif") || lower.ends_with(".tiff") {
        Some("tiff")
    } else {
        None
    }
}

/// 非白紙ページの幅×高さで最頻値（最頻サイズ）を返す
fn majority_size_of_non_blank(pages: &[EpubPage]) -> Option<(u32, u32)> {
    use std::collections::HashMap;
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for page in pages {
        if page.is_blank {
            continue;
        }
        if page.width == 0 || page.height == 0 {
            continue;
        }
        *counts.entry((page.width, page.height)).or_insert(0) += 1;
    }
    counts.into_iter().max_by_key(|(_, c)| *c).map(|(s, _)| s)
}

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
    app_handle: Option<AppHandle>,
}

impl EpubBuilder {
    /// 新しいビルダーを作成
    pub fn new(mut config: EpubGenerateConfig) -> Self {
        // 白紙ページのサイズは非白紙ページの多数派サイズに揃える
        let majority = majority_size_of_non_blank(&config.pages);

        let normalizes_all_images =
            config.metadata.image_color_policy != EpubImageColorPolicy::PreserveOriginal;

        for page in &mut config.pages {
            // 白紙ページは多数派サイズで白JPEGを生成する
            if page.is_blank {
                if let Some((mw, mh)) = majority {
                    page.width = mw;
                    page.height = mh;
                }
                page.filename = replace_filename_ext(&page.filename, "jpg");
                continue;
            }

            // EPUB readers support jpg/jpeg/png. When color normalization is enabled
            // every image is re-encoded as JPG, so normalize references up front.
            if normalizes_all_images || source_needs_conversion(&page.source_path).is_some() {
                page.filename = replace_filename_ext(&page.filename, "jpg");
            }
        }

        let temp_dir = std::env::temp_dir().join(format!("epub_build_{}", uuid::Uuid::new_v4()));
        Self {
            config,
            temp_dir,
            css_resource_dir: None,
            app_handle: None,
        }
    }

    /// CSSリソースディレクトリを設定
    pub fn with_css_resource_dir(mut self, dir: PathBuf) -> Self {
        self.css_resource_dir = Some(dir);
        self
    }

    /// 進捗イベント送信用の AppHandle を設定
    pub fn with_app_handle(mut self, handle: AppHandle) -> Self {
        self.app_handle = Some(handle);
        self
    }

    fn emit_progress(&self, phase: &str, current: usize, total: usize) {
        if let Some(handle) = &self.app_handle {
            let _ = handle.emit(
                "epub-progress",
                EpubProgressPayload {
                    phase,
                    current,
                    total,
                },
            );
        }
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
        let image_profile_summary = self.copy_images()?;

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
        self.emit_progress("packaging", 0, 1);
        let file_size = self.package_epub()?;
        self.emit_progress("packaging", 1, 1);

        Ok(EpubGenerateResponse {
            success: true,
            output_path: self.config.output_path.clone(),
            page_count: self.config.pages.len(),
            file_size,
            image_profile_summary: Some(image_profile_summary),
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

    /// 画像ファイルをコピー（PSD/TIFFはJPGに並列変換）
    fn copy_images(&self) -> Result<EpubImageProfileSummary, String> {
        let format = &self.config.metadata.output_format;
        let image_dir = self
            .temp_dir
            .join(root_folder(format))
            .join(image_folder(format));
        let dot_gain_profile = load_dot_gain_icc_profile();
        let srgb_profile = load_srgb_icc_profile();
        let auto_blank_target = self.auto_blank_target(&dot_gain_profile);

        let total = self.config.pages.len();
        self.emit_progress("images", 0, total);
        let counter = AtomicUsize::new(0);

        // 各ページのコピー/変換は独立しているので rayon で並列化する。
        // PSD 合成は CPU バウンドで重い処理なので並列化の効果が大きい。
        self.config
            .pages
            .par_iter()
            .enumerate()
            .map(|(idx, page)| -> Result<ImageCopyResult, String> {
                let dest_filename = image_filename(format, idx, page);
                let dest = image_dir.join(&dest_filename);
                let target = self.image_target_for_page(page, auto_blank_target);

                let mut summary = ImageCopyResult::default();
                let result = if page.is_blank {
                    generate_blank_jpeg(page.width, page.height, &dest, target, srgb_profile.as_deref(), dot_gain_profile.as_deref())
                } else {
                    let src = Path::new(&page.source_path);
                    if !src.exists() {
                        return Err(format!("Source image not found: {}", page.source_path));
                    }
                    match target {
                        EpubImageTarget::PreserveOriginal => match source_needs_conversion(&page.source_path) {
                            Some("psd") => convert_psd_to_jpeg(src, &dest, srgb_profile.as_deref()),
                            Some("tiff") => convert_via_image_crate_to_jpeg(src, &dest, srgb_profile.as_deref()),
                            _ => fs::copy(src, &dest)
                                .map(|_| ())
                                .map_err(|e| format!("Failed to copy image {}: {}", dest_filename, e)),
                        },
                        EpubImageTarget::RgbSrgb
                        | EpubImageTarget::GrayscaleDotGain
                        | EpubImageTarget::NoIcc => {
                            normalize_image_to_jpeg(src, &dest, target, srgb_profile.as_deref(), dot_gain_profile.as_deref())
                        }
                    }
                };
                result?;
                match target {
                    EpubImageTarget::RgbSrgb => summary.rgb_srgb_count += 1,
                    EpubImageTarget::GrayscaleDotGain => {
                        if dot_gain_profile.is_some() {
                            summary.grayscale_dot_gain_count += 1;
                        } else {
                            summary.grayscale_no_profile_count += 1;
                            summary.warnings.push(
                                "Dot Gain ICC profile was not found; grayscale JPEGs were written without a grayscale ICC profile.".to_string(),
                            );
                        }
                    }
                    EpubImageTarget::PreserveOriginal => summary.preserved_original_count += 1,
                    EpubImageTarget::NoIcc => summary.no_icc_count += 1,
                }
                if target == EpubImageTarget::RgbSrgb && srgb_profile.is_none() {
                    summary.warnings.push(
                        "sRGB ICC profile was not found; RGB JPEGs were written without embedded sRGB ICC.".to_string(),
                    );
                }

                let done = counter.fetch_add(1, Ordering::Relaxed) + 1;
                self.emit_progress("images", done, total);
                Ok(summary)
            })
            .try_reduce(ImageCopyResult::default, |acc, item| Ok(acc.merge(item)))
            .map(ImageCopyResult::into_summary)
    }

    /// CSSファイルをコピー
    fn auto_blank_target(&self, _dot_gain_profile: &Option<Vec<u8>>) -> EpubImageTarget {
        if self.config.metadata.image_color_policy == EpubImageColorPolicy::FullColorSrgb {
            return EpubImageTarget::RgbSrgb;
        }

        let grayscale_body_pages = self
            .config
            .pages
            .iter()
            .filter(|page| !page.is_blank && !page.is_cover && !page.is_colophon)
            .filter(|page| self.is_clearly_grayscale(page))
            .count();
        let body_pages = self
            .config
            .pages
            .iter()
            .filter(|page| !page.is_blank && !page.is_cover && !page.is_colophon)
            .count();

        if body_pages > 0 && grayscale_body_pages * 2 >= body_pages {
            EpubImageTarget::GrayscaleDotGain
        } else {
            EpubImageTarget::RgbSrgb
        }
    }

    fn image_target_for_page(
        &self,
        page: &EpubPage,
        blank_target: EpubImageTarget,
    ) -> EpubImageTarget {
        match self.config.metadata.image_color_policy {
            _ if page.image_profile_override == EpubPageImageProfileOverride::Srgb => {
                EpubImageTarget::RgbSrgb
            }
            _ if page.image_profile_override == EpubPageImageProfileOverride::DotGain => {
                EpubImageTarget::GrayscaleDotGain
            }
            _ if page.image_profile_override == EpubPageImageProfileOverride::NoIcc => {
                EpubImageTarget::NoIcc
            }
            _ if page.image_profile_override == EpubPageImageProfileOverride::PreserveOriginal => {
                EpubImageTarget::PreserveOriginal
            }
            EpubImageColorPolicy::PreserveOriginal => EpubImageTarget::PreserveOriginal,
            EpubImageColorPolicy::FullColorSrgb => EpubImageTarget::RgbSrgb,
            EpubImageColorPolicy::Auto => {
                if page.is_blank {
                    return blank_target;
                }
                if page.is_cover || page.is_colophon {
                    return EpubImageTarget::RgbSrgb;
                }
                if self.is_clearly_grayscale(page) {
                    EpubImageTarget::GrayscaleDotGain
                } else {
                    EpubImageTarget::RgbSrgb
                }
            }
        }
    }

    fn is_clearly_grayscale(&self, page: &EpubPage) -> bool {
        if let Some(mode) = page.source_color_mode.as_deref() {
            let mode = mode.to_ascii_lowercase();
            if mode == "grayscale" || mode == "bitmap" {
                return true;
            }
            if mode == "rgb" || mode == "cmyk" || mode == "lab" || mode == "indexed" {
                return false;
            }
        }
        jpeg_component_count(Path::new(&page.source_path)) == Some(1)
    }

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

fn write_rgb_jpeg(
    image: DynamicImage,
    dest: &Path,
    srgb_profile: Option<&[u8]>,
) -> Result<(), String> {
    // CMYK等のRGBA以外のPSDが来てもJPEG（RGB）にエンコードできるよう変換。
    let rgb = image.to_rgb8();
    let file = File::create(dest)
        .map_err(|e| format!("Failed to create JPG output {}: {}", dest.display(), e))?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, EPUB_JPEG_QUALITY);
    if let Some(profile) = srgb_profile {
        encoder
            .set_icc_profile(profile.to_vec())
            .map_err(|e| format!("Failed to set sRGB ICC profile: {}", e))?;
    }
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("Failed to encode JPG {}: {}", dest.display(), e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush JPG {}: {}", dest.display(), e))?;
    Ok(())
}

fn write_grayscale_jpeg(
    image: DynamicImage,
    dest: &Path,
    dot_gain_profile: Option<&[u8]>,
) -> Result<(), String> {
    let gray = image.to_luma8();
    let file = File::create(dest).map_err(|e| {
        format!(
            "Failed to create grayscale JPG output {}: {}",
            dest.display(),
            e
        )
    })?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, EPUB_JPEG_QUALITY);
    if let Some(profile) = dot_gain_profile {
        encoder
            .set_icc_profile(profile.to_vec())
            .map_err(|e| format!("Failed to set grayscale ICC profile: {}", e))?;
    }
    encoder
        .encode(
            gray.as_raw(),
            gray.width(),
            gray.height(),
            image::ExtendedColorType::L8,
        )
        .map_err(|e| format!("Failed to encode grayscale JPG {}: {}", dest.display(), e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush grayscale JPG {}: {}", dest.display(), e))?;
    Ok(())
}

fn normalize_image_to_jpeg(
    src: &Path,
    dest: &Path,
    target: EpubImageTarget,
    srgb_profile: Option<&[u8]>,
    dot_gain_profile: Option<&[u8]>,
) -> Result<(), String> {
    let img = if src
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("psd"))
        .unwrap_or(false)
    {
        read_psd_as_dynamic_image(src)?
    } else {
        image::open(src).map_err(|e| format!("Failed to decode image {}: {}", src.display(), e))?
    };

    match target {
        EpubImageTarget::RgbSrgb => write_rgb_jpeg(img, dest, srgb_profile),
        EpubImageTarget::GrayscaleDotGain => write_grayscale_jpeg(img, dest, dot_gain_profile),
        EpubImageTarget::NoIcc => {
            if is_grayscale_dynamic_image(&img) {
                write_grayscale_jpeg(img, dest, None)
            } else {
                write_rgb_jpeg(img, dest, None)
            }
        }
        EpubImageTarget::PreserveOriginal => {
            Err("Internal error: preserve target cannot normalize".to_string())
        }
    }
}

fn read_psd_as_dynamic_image(src: &Path) -> Result<DynamicImage, String> {
    let bytes =
        fs::read(src).map_err(|e| format!("Failed to read PSD {}: {}", src.display(), e))?;
    let psd_file = psd::Psd::from_bytes(&bytes)
        .map_err(|e| format!("Failed to parse PSD {}: {:?}", src.display(), e))?;
    let width = psd_file.width();
    let height = psd_file.height();
    let rgba = psd_file.rgba();
    let buffer = image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| format!("Invalid PSD image data: {}", src.display()))?;
    Ok(DynamicImage::ImageRgba8(buffer))
}

fn convert_psd_to_jpeg(src: &Path, dest: &Path, srgb_profile: Option<&[u8]>) -> Result<(), String> {
    write_rgb_jpeg(read_psd_as_dynamic_image(src)?, dest, srgb_profile)
}

fn convert_via_image_crate_to_jpeg(
    src: &Path,
    dest: &Path,
    srgb_profile: Option<&[u8]>,
) -> Result<(), String> {
    let img =
        image::open(src).map_err(|e| format!("Failed to decode image {}: {}", src.display(), e))?;
    write_rgb_jpeg(img, dest, srgb_profile)
}

fn generate_blank_jpeg(
    width: u32,
    height: u32,
    dest: &Path,
    target: EpubImageTarget,
    srgb_profile: Option<&[u8]>,
    dot_gain_profile: Option<&[u8]>,
) -> Result<(), String> {
    let w = width.max(1);
    let h = height.max(1);
    match target {
        EpubImageTarget::GrayscaleDotGain => {
            let img = image::GrayImage::from_pixel(w, h, image::Luma([255]));
            write_grayscale_jpeg(DynamicImage::ImageLuma8(img), dest, dot_gain_profile)
        }
        EpubImageTarget::NoIcc => {
            let img = image::RgbImage::from_pixel(w, h, image::Rgb([255, 255, 255]));
            write_rgb_jpeg(DynamicImage::ImageRgb8(img), dest, None)
        }
        _ => {
            let img = image::RgbImage::from_pixel(w, h, image::Rgb([255, 255, 255]));
            write_rgb_jpeg(DynamicImage::ImageRgb8(img), dest, srgb_profile)
        }
    }
}

fn is_grayscale_dynamic_image(image: &DynamicImage) -> bool {
    use image::ColorType;
    matches!(
        image.color(),
        ColorType::L8 | ColorType::La8 | ColorType::L16 | ColorType::La16
    )
}

fn load_srgb_icc_profile() -> Option<Vec<u8>> {
    profile_candidate_paths(&[
        r"C:\Windows\System32\spool\drivers\color\sRGB Color Space Profile.icm",
        r"C:\Windows\System32\spool\drivers\color\sRGB.icm",
        "/System/Library/ColorSync/Profiles/sRGB Profile.icc",
        "/usr/share/color/icc/colord/sRGB.icc",
    ])
}

fn load_dot_gain_icc_profile() -> Option<Vec<u8>> {
    if let Ok(path) = std::env::var("DAIDORI_DOT_GAIN_ICC") {
        if let Ok(bytes) = fs::read(path) {
            return Some(bytes);
        }
    }

    profile_candidate_paths(&[
        r"C:\Program Files\Common Files\Adobe\Color\Profiles\Recommended\Dot Gain 20%.icc",
        r"C:\Program Files\Common Files\Adobe\Color\Profiles\Dot Gain 20%.icc",
        r"C:\Program Files (x86)\Common Files\Adobe\Color\Profiles\Recommended\Dot Gain 20%.icc",
        r"C:\Program Files (x86)\Common Files\Adobe\Color\Profiles\Dot Gain 20%.icc",
        "/Library/ColorSync/Profiles/Dot Gain 20%.icc",
    ])
}

fn profile_candidate_paths(paths: &[&str]) -> Option<Vec<u8>> {
    paths.iter().find_map(|path| fs::read(path).ok())
}

fn jpeg_component_count(path: &Path) -> Option<u8> {
    if !path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("jpg") || ext.eq_ignore_ascii_case("jpeg"))
        .unwrap_or(false)
    {
        return None;
    }

    let data = fs::read(path).ok()?;
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }

    let mut i = 2;
    while i + 4 < data.len() {
        while i < data.len() && data[i] != 0xFF {
            i += 1;
        }
        while i < data.len() && data[i] == 0xFF {
            i += 1;
        }
        if i >= data.len() {
            return None;
        }

        let marker = data[i];
        i += 1;
        if marker == 0xD9 || marker == 0xDA {
            return None;
        }
        if i + 2 > data.len() {
            return None;
        }
        let len = u16::from_be_bytes([data[i], data[i + 1]]) as usize;
        if len < 2 || i + len > data.len() {
            return None;
        }

        let is_sof = matches!(
            marker,
            0xC0 | 0xC1
                | 0xC2
                | 0xC3
                | 0xC5
                | 0xC6
                | 0xC7
                | 0xC9
                | 0xCA
                | 0xCB
                | 0xCD
                | 0xCE
                | 0xCF
        );
        if is_sof && len >= 8 {
            return data.get(i + 7).copied();
        }
        i += len;
    }

    None
}
