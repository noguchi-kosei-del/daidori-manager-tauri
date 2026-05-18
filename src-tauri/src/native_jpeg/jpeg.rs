//! native_jpeg - JPEGエンコード
//! Tachimi processor/jpeg.rs から MozJPEG エンコード部分を移植

use mozjpeg::{ColorSpace as MozColorSpace, Compress};
use std::fs::File;
use std::io::Write;
use std::path::Path;

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
    let jpeg_data = encode_jpeg_mozjpeg(rgb_data, width, height, quality)
        .ok_or("MozJPEGエンコードに失敗")?;

    let mut file = File::create(path).map_err(|e| format!("ファイル作成に失敗: {}", e))?;
    file.write_all(&jpeg_data)
        .map_err(|e| format!("ファイル書き込みに失敗: {}", e))?;
    Ok(())
}
