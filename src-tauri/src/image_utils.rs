use std::io::Cursor;
use image::{DynamicImage, ImageFormat};
use crate::constants::{MAX_IMAGE_DIMENSION, MAX_PIXEL_COUNT, THUMBNAIL_SIZE};

// 画像サイズ検証（DoS防止）
pub fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("無効な画像サイズ: 幅または高さが0".to_string());
    }
    if width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION {
        return Err(format!(
            "画像サイズが大きすぎます: {}x{} (最大: {})",
            width, height, MAX_IMAGE_DIMENSION
        ));
    }
    let pixel_count = (width as u64) * (height as u64);
    if pixel_count > MAX_PIXEL_COUNT {
        return Err(format!(
            "ピクセル数が多すぎます: {} (最大: {})",
            pixel_count, MAX_PIXEL_COUNT
        ));
    }
    Ok(())
}

// ファイルタイプを取得
pub fn get_file_type(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "psd" => Some("psd"),
        "tif" | "tiff" => Some("tif"),
        _ => None,
    }
}

// 画像をサムネイルに変換（高画質PNG版）
pub fn create_thumbnail(img: DynamicImage) -> Result<Vec<u8>, String> {
    use image::imageops::FilterType;

    // Triangle: 高速なリサンプリングフィルタ（サムネイル用途では十分な品質）
    let thumbnail = img.resize(
        THUMBNAIL_SIZE,
        THUMBNAIL_SIZE * 14 / 10,
        FilterType::Triangle,
    );

    // PNG形式で出力（可逆圧縮で画質劣化なし）
    let mut buffer = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|e| format!("サムネイル書き出しエラー: {}", e))?;

    Ok(buffer.into_inner())
}
