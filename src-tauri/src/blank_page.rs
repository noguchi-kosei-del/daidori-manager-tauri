//! 白紙ページの固定生成。
//!
//! チャプターに追加された白紙ページは、出力経路（JPEG/TIFF エクスポート・EPUB・PDF）に
//! 関わらず **1280×1818px / 600ppi / グレースケール白（モノクロ）** に固定する。
//! 隣接ページサイズや多数派サイズは参照しない。

use std::fs;
use std::io::{BufWriter, Write};
use std::path::Path;

use ::image::codecs::jpeg::{JpegEncoder, PixelDensity};
use ::image::{ExtendedColorType, ImageEncoder};
use tiff::encoder::{colortype, Compression, Rational, TiffEncoder};
use tiff::tags::{ResolutionUnit, Tag};

/// 白紙ページの固定ピクセル幅
pub const BLANK_WIDTH: u32 = 1280;
/// 白紙ページの固定ピクセル高さ
pub const BLANK_HEIGHT: u32 = 1818;
/// 白紙ページの固定解像度（ppi）。ファイルメタデータに埋め込む。
pub const BLANK_DPI: u32 = 600;

/// グレースケール白（モノクロ）
const WHITE: u8 = 255;
/// JPEG 品質（既存の白紙生成と同じ 95）
const JPEG_QUALITY: u8 = 95;

/// 固定サイズのグレースケール白ピクセル列（L8: 1byte/px）を作る。
fn blank_gray_pixels() -> Vec<u8> {
    vec![WHITE; (BLANK_WIDTH as usize) * (BLANK_HEIGHT as usize)]
}

/// 白紙 JPEG（グレースケール白・1280×1818・600ppi）を書き出す。
/// `icc` は任意（EPUB の Dot Gain プロファイル等）。
pub fn write_blank_jpeg(dest: &Path, icc: Option<&[u8]>) -> Result<(), String> {
    let pixels = blank_gray_pixels();
    let file = fs::File::create(dest)
        .map_err(|e| format!("白紙JPEG作成に失敗 {}: {}", dest.display(), e))?;
    let mut writer = BufWriter::new(file);
    {
        let mut encoder = JpegEncoder::new_with_quality(&mut writer, JPEG_QUALITY);
        // 600ppi を JFIF 濃度として埋め込む。
        encoder.set_pixel_density(PixelDensity::dpi(BLANK_DPI as u16));
        if let Some(profile) = icc {
            encoder
                .set_icc_profile(profile.to_vec())
                .map_err(|e| format!("白紙JPEGのICC設定に失敗: {}", e))?;
        }
        encoder
            .encode(&pixels, BLANK_WIDTH, BLANK_HEIGHT, ExtendedColorType::L8)
            .map_err(|e| format!("白紙JPEGエンコードに失敗: {}", e))?;
    }
    writer
        .flush()
        .map_err(|e| format!("白紙JPEG書き込みに失敗 {}: {}", dest.display(), e))?;
    Ok(())
}

/// 白紙 TIFF（グレースケール白・1280×1818・600ppi・LZW 圧縮）を書き出す。
pub fn write_blank_tiff(dest: &Path) -> Result<(), String> {
    let pixels = blank_gray_pixels();
    let file = fs::File::create(dest)
        .map_err(|e| format!("白紙TIFF作成に失敗 {}: {}", dest.display(), e))?;
    let mut writer = BufWriter::new(file);
    let mut tiff = TiffEncoder::new(&mut writer)
        .map_err(|e| format!("TIFFエンコーダ作成に失敗: {}", e))?
        .with_compression(Compression::Lzw);
    let mut image = tiff
        .new_image::<colortype::Gray8>(BLANK_WIDTH, BLANK_HEIGHT)
        .map_err(|e| format!("TIFF画像作成に失敗: {}", e))?;
    // new_image が書く既定の解像度タグ（1/1・単位なし）を 600ppi で上書きする。
    image
        .encoder()
        .write_tag(Tag::XResolution, Rational { n: BLANK_DPI, d: 1 })
        .map_err(|e| format!("TIFF解像度(X)設定に失敗: {}", e))?;
    image
        .encoder()
        .write_tag(Tag::YResolution, Rational { n: BLANK_DPI, d: 1 })
        .map_err(|e| format!("TIFF解像度(Y)設定に失敗: {}", e))?;
    image
        .encoder()
        .write_tag(Tag::ResolutionUnit, ResolutionUnit::Inch)
        .map_err(|e| format!("TIFF解像度単位設定に失敗: {}", e))?;
    image
        .write_data(&pixels[..])
        .map_err(|e| format!("TIFF書き込みに失敗: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("白紙TIFF書き込みに失敗 {}: {}", dest.display(), e))?;
    Ok(())
}

/// 白紙 PNG（グレースケール白・1280×1818・600ppi）を書き出す。
pub fn write_blank_png(dest: &Path) -> Result<(), String> {
    let pixels = blank_gray_pixels();
    let file = fs::File::create(dest)
        .map_err(|e| format!("白紙PNG作成に失敗 {}: {}", dest.display(), e))?;
    let writer = BufWriter::new(file);
    let mut encoder = png::Encoder::new(writer, BLANK_WIDTH, BLANK_HEIGHT);
    encoder.set_color(png::ColorType::Grayscale);
    encoder.set_depth(png::BitDepth::Eight);
    // 600ppi = 600 / 0.0254 ≈ 23622 dots/meter（pHYs チャンクに埋め込む）。
    let ppu = ((BLANK_DPI as f64) / 0.0254).round() as u32;
    encoder.set_pixel_dims(Some(png::PixelDimensions {
        xppu: ppu,
        yppu: ppu,
        unit: png::Unit::Meter,
    }));
    let mut png_writer = encoder
        .write_header()
        .map_err(|e| format!("白紙PNGヘッダ書き込みに失敗: {}", e))?;
    png_writer
        .write_image_data(&pixels)
        .map_err(|e| format!("白紙PNG書き込みに失敗: {}", e))?;
    Ok(())
}

/// 拡張子に応じて固定仕様の白紙ページを生成する。
/// 対応していない拡張子は PNG（グレースケール白）で書き出す。
pub fn generate_blank(dest: &Path) -> Result<(), String> {
    let ext = dest
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => write_blank_jpeg(dest, None),
        "tif" | "tiff" => write_blank_tiff(dest),
        _ => write_blank_png(dest),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "daiwari_blank_test_{}_{}",
            std::process::id(),
            name
        ))
    }

    /// 600ppi → dots/meter（PNG pHYs 用）
    fn expected_ppu() -> u32 {
        ((BLANK_DPI as f64) / 0.0254).round() as u32
    }

    #[test]
    fn jpeg_blank_is_fixed_gray_600dpi() {
        let p = tmp("blank.jpg");
        write_blank_jpeg(&p, None).unwrap();

        let img = ::image::open(&p).unwrap();
        assert_eq!((img.width(), img.height()), (BLANK_WIDTH, BLANK_HEIGHT));
        assert_eq!(img.color(), ::image::ColorType::L8, "JPEGはグレースケールであるべき");

        // JFIF APP0 の濃度 = 600dpi
        let bytes = std::fs::read(&p).unwrap();
        assert_eq!(&bytes[0..2], &[0xFF, 0xD8], "SOI");
        assert_eq!(&bytes[2..4], &[0xFF, 0xE0], "APP0");
        assert_eq!(&bytes[6..11], b"JFIF\0");
        assert_eq!(bytes[13], 1, "単位は dots/inch");
        assert_eq!(u16::from_be_bytes([bytes[14], bytes[15]]), 600, "Xdensity");
        assert_eq!(u16::from_be_bytes([bytes[16], bytes[17]]), 600, "Ydensity");

        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn tiff_blank_is_fixed_gray_600dpi() {
        let p = tmp("blank.tif");
        write_blank_tiff(&p).unwrap();

        let img = ::image::open(&p).unwrap();
        assert_eq!((img.width(), img.height()), (BLANK_WIDTH, BLANK_HEIGHT));
        assert_eq!(img.color(), ::image::ColorType::L8, "TIFFはグレースケールであるべき");

        let mut dec = tiff::decoder::Decoder::new(std::fs::File::open(&p).unwrap()).unwrap();
        match dec.get_tag(Tag::XResolution).unwrap() {
            tiff::decoder::ifd::Value::Rational(n, d) => assert_eq!((n, d), (600, 1)),
            v => panic!("XResolutionが想定外: {:?}", v),
        }
        assert_eq!(dec.get_tag_u32(Tag::ResolutionUnit).unwrap(), 2, "単位は inch(=2)");

        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn png_blank_is_fixed_gray_600dpi() {
        let p = tmp("blank.png");
        write_blank_png(&p).unwrap();

        let img = ::image::open(&p).unwrap();
        assert_eq!((img.width(), img.height()), (BLANK_WIDTH, BLANK_HEIGHT));
        assert_eq!(img.color(), ::image::ColorType::L8, "PNGはグレースケールであるべき");

        let dec = png::Decoder::new(std::fs::File::open(&p).unwrap());
        let reader = dec.read_info().unwrap();
        let dims = reader.info().pixel_dims.expect("pHYsが存在するべき");
        assert_eq!(dims.unit, png::Unit::Meter);
        assert_eq!(dims.xppu, expected_ppu());
        assert_eq!(dims.yppu, expected_ppu());

        let _ = std::fs::remove_file(&p);
    }
}
