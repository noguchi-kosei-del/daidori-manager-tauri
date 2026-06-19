//! native_jpeg - JPEGエンコード
//! Tachimi processor/jpeg.rs から MozJPEG エンコード部分を移植

use ::image::codecs::jpeg::JpegEncoder;
use ::image::ExtendedColorType;
use mozjpeg::{ColorSpace as MozColorSpace, Compress};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use tiff::encoder::{colortype, Compression, TiffEncoder};

/// MozJPEGでRGB画像をエンコード（高効率圧縮）
pub fn encode_jpeg_mozjpeg(
    rgb_data: &[u8],
    width: u32,
    height: u32,
    quality: f32,
) -> Option<Vec<u8>> {
    std::panic::catch_unwind(|| {
        let mut comp = Compress::new(MozColorSpace::JCS_RGB);
        comp.set_size(width as usize, height as usize);
        comp.set_quality(quality);

        // 圧縮開始（Vec<u8>に出力）
        let mut writer = comp.start_compress(Vec::new()).ok()?;

        // 全スキャンラインを書き込み
        writer.write_scanlines(rgb_data).ok()?;

        writer.finish().ok()
    })
    .ok()
    .flatten()
}

/// MozJPEGでRGB画像をファイルに書き出し
pub fn write_jpeg_mozjpeg_to_file<P: AsRef<Path>>(
    rgb_data: &[u8],
    width: u32,
    height: u32,
    quality: f32,
    path: P,
) -> Result<(), String> {
    let jpeg_data =
        encode_jpeg_mozjpeg(rgb_data, width, height, quality).ok_or("MozJPEGエンコードに失敗")?;

    let mut file = File::create(path).map_err(|e| format!("ファイル作成に失敗: {}", e))?;
    file.write_all(&jpeg_data)
        .map_err(|e| format!("ファイル書き込みに失敗: {}", e))?;
    Ok(())
}

/// RGB画像をTIFF（imageクレート）でファイルに書き出し。
///
/// EPUB生成時の「TIFF併産」用（印刷控え/入稿向け）。EPUB本体はJPEGのままで、
/// この関数は出力名の拡張子が .tif/.tiff のときに save_image から呼ばれる。
pub fn write_tiff_to_file<P: AsRef<Path>>(
    rgb_data: &[u8],
    width: u32,
    height: u32,
    path: P,
) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("ファイル作成に失敗: {}", e))?;
    let mut writer = BufWriter::new(file);
    // LZW圧縮で書き出す（可逆。非圧縮だと漫画原寸で1枚100MB超になりディスクI/Oが重いため）。
    let mut tiff = TiffEncoder::new(&mut writer)
        .map_err(|e| format!("TIFFエンコーダ作成に失敗: {}", e))?
        .with_compression(Compression::Lzw);
    tiff.write_image::<colortype::RGB8>(width, height, rgb_data)
        .map_err(|e| format!("TIFF書き込みに失敗: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("ファイル書き込みに失敗: {}", e))?;
    Ok(())
}

/// imageクレートのベースラインJPEGエンコーダでRGB画像をファイルに書き出し（高速）
///
/// MozJPEG のトレリス量子化／プログレッシブ最適化を使わないため、漫画サイズの
/// 大きな画像でも数倍高速。チャプターPDFの使い捨て中間ファイル用。
/// （MozJPEG ほど小さくはならないが、Tachimi がPDFに埋め込むだけなので速度を優先）
pub fn write_jpeg_baseline_to_file<P: AsRef<Path>>(
    rgb_data: &[u8],
    width: u32,
    height: u32,
    quality: f32,
    path: P,
) -> Result<(), String> {
    let q = quality.round().clamp(1.0, 100.0) as u8;
    let file = File::create(path).map_err(|e| format!("ファイル作成に失敗: {}", e))?;
    let mut writer = BufWriter::new(file);
    {
        let mut encoder = JpegEncoder::new_with_quality(&mut writer, q);
        encoder
            .encode(rgb_data, width, height, ExtendedColorType::Rgb8)
            .map_err(|e| format!("ベースラインJPEGエンコードに失敗: {}", e))?;
    }
    writer
        .flush()
        .map_err(|e| format!("ファイル書き込みに失敗: {}", e))?;
    Ok(())
}
