//! native_jpeg - 画像読み込み
//! Tachimi processor/image_loader.rs から PSD/PNG/JPEG/TIFF 読込部分を移植
//! （PsdGuide / extract_psd_guides は Daiwari の commands/epub.rs::read_psd_guides を
//!  継続使用するため移植しない）

use ::image::{DynamicImage, ImageBuffer, RgbaImage};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// 画像ファイルを読み込む
pub fn load_image(path: &Path) -> Result<DynamicImage, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "psd" {
        load_psd_fast(path)
    } else {
        ::image::open(path).map_err(|e| format!("画像の読み込みに失敗: {}", e))
    }
}

/// 画像をデコードせずに寸法だけを取得する（ヘッダのみ読む）。
/// PSD はヘッダ22バイト、その他は `image::image_dimensions`。
/// 取得できない場合は None。
pub fn read_image_dimensions(path: &Path) -> Option<(u32, u32)> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "psd" {
        // PSDヘッダ: 0-3 "8BPS", 14-17 height(BE u32), 18-21 width(BE u32)
        let mut file = File::open(path).ok()?;
        let mut header = [0u8; 22];
        file.read_exact(&mut header).ok()?;
        if &header[0..4] != b"8BPS" {
            return None;
        }
        let height = u32::from_be_bytes([header[14], header[15], header[16], header[17]]);
        let width = u32::from_be_bytes([header[18], header[19], header[20], header[21]]);
        if width == 0 || height == 0 {
            return None;
        }
        Some((width, height))
    } else {
        ::image::image_dimensions(path).ok()
    }
}

/// PSDファイルを高速読み込み
/// まずフラット化画像を試し、失敗したらレイヤー合成にフォールバック
pub fn load_psd_fast(path: &Path) -> Result<DynamicImage, String> {
    match load_psd_composite(path) {
        Ok(img) => Ok(img),
        Err(_) => {
            // フォールバック: psd crateでレイヤー合成（遅いが確実）
            load_psd_with_layers(path)
        }
    }
}

/// PSDファイルのImage Dataセクションを直接読み込む（高速版）
/// Photoshopの「互換性を最大に」で保存されたPSDには、
/// 合成済みのフラット化画像が含まれている。
fn load_psd_composite(path: &Path) -> Result<DynamicImage, String> {
    let file = File::open(path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    let mut file = BufReader::with_capacity(64 * 1024, file);
    let mut buf4 = [0u8; 4];
    let mut buf2 = [0u8; 2];

    // === Header (26 bytes) ===
    // Signature: "8BPS"
    file.read_exact(&mut buf4)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    if &buf4 != b"8BPS" {
        return Err("無効なPSDファイル".to_string());
    }

    // Version (2 bytes)
    file.read_exact(&mut buf2)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let version = u16::from_be_bytes(buf2);
    if version != 1 && version != 2 {
        return Err("サポートされていないPSDバージョン".to_string());
    }

    // Reserved (6 bytes)
    file.seek(SeekFrom::Current(6))
        .map_err(|e| format!("シークエラー: {}", e))?;

    // Channels (2 bytes)
    file.read_exact(&mut buf2)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let channels = u16::from_be_bytes(buf2) as usize;

    // Height (4 bytes)
    file.read_exact(&mut buf4)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let height = u32::from_be_bytes(buf4);

    // Width (4 bytes)
    file.read_exact(&mut buf4)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let width = u32::from_be_bytes(buf4);

    // Depth (2 bytes)
    file.read_exact(&mut buf2)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let depth = u16::from_be_bytes(buf2);
    if depth != 8 {
        return Err(format!("サポートされていないビット深度: {}", depth));
    }

    // Color Mode (2 bytes)
    file.read_exact(&mut buf2)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let color_mode = u16::from_be_bytes(buf2);
    if color_mode != 3 && color_mode != 1 {
        return Err(format!(
            "サポートされていないカラーモード: {} (RGB/Grayscaleのみ対応)",
            color_mode
        ));
    }

    // === Color Mode Data Section ===
    file.read_exact(&mut buf4)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let color_mode_len = u32::from_be_bytes(buf4);
    file.seek(SeekFrom::Current(color_mode_len as i64))
        .map_err(|e| format!("シークエラー: {}", e))?;

    // === Image Resources Section ===
    file.read_exact(&mut buf4)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let resources_len = u32::from_be_bytes(buf4);
    file.seek(SeekFrom::Current(resources_len as i64))
        .map_err(|e| format!("シークエラー: {}", e))?;

    // === Layer and Mask Information Section ===
    if version == 2 {
        let mut buf8 = [0u8; 8];
        file.read_exact(&mut buf8)
            .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
        let layer_len = u64::from_be_bytes(buf8);
        file.seek(SeekFrom::Current(layer_len as i64))
            .map_err(|e| format!("シークエラー: {}", e))?;
    } else {
        file.read_exact(&mut buf4)
            .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
        let layer_len = u32::from_be_bytes(buf4);
        file.seek(SeekFrom::Current(layer_len as i64))
            .map_err(|e| format!("シークエラー: {}", e))?;
    }

    // === Image Data Section ===
    file.read_exact(&mut buf2)
        .map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let compression = u16::from_be_bytes(buf2);

    let pixels = (width as usize) * (height as usize);
    let num_channels = channels.min(4);

    match compression {
        0 => {
            // Raw (非圧縮)
            let mut channel_data = vec![vec![0u8; pixels]; num_channels];
            for ch in 0..num_channels {
                file.read_exact(&mut channel_data[ch])
                    .map_err(|e| format!("画像データ読み込みエラー: {}", e))?;
            }
            channels_to_rgba(channel_data, width, height, color_mode)
        }
        1 => {
            // RLE圧縮
            decode_rle_image(&mut file, width, height, num_channels, color_mode, version)
        }
        _ => Err(format!("サポートされていない圧縮方式: {}", compression)),
    }
}

/// RLE圧縮された画像データをデコード
fn decode_rle_image<R: Read>(
    file: &mut R,
    width: u32,
    height: u32,
    num_channels: usize,
    color_mode: u16,
    version: u16,
) -> Result<DynamicImage, String> {
    let rows = height as usize;
    let pixels = (width as usize) * rows;

    // 各チャンネルの各行のバイト数を読み取る
    let total_rows = rows * num_channels;
    let mut row_lengths = vec![0u16; total_rows];

    if version == 2 {
        let mut buf4 = [0u8; 4];
        for length in row_lengths.iter_mut() {
            file.read_exact(&mut buf4)
                .map_err(|e| format!("行長読み込みエラー: {}", e))?;
            *length = u32::from_be_bytes(buf4) as u16;
        }
    } else {
        let mut buf2 = [0u8; 2];
        for length in row_lengths.iter_mut() {
            file.read_exact(&mut buf2)
                .map_err(|e| format!("行長読み込みエラー: {}", e))?;
            *length = u16::from_be_bytes(buf2);
        }
    }

    // 各チャンネルをデコード
    let mut channel_data = vec![vec![0u8; pixels]; num_channels];

    for ch in 0..num_channels {
        for row in 0..rows {
            let row_idx = ch * rows + row;
            let row_len = row_lengths[row_idx] as usize;

            let mut compressed = vec![0u8; row_len];
            file.read_exact(&mut compressed)
                .map_err(|e| format!("RLEデータ読み込みエラー: {}", e))?;

            let row_start = row * width as usize;
            let row_data = &mut channel_data[ch][row_start..row_start + width as usize];
            decode_packbits(&compressed, row_data);
        }
    }

    channels_to_rgba(channel_data, width, height, color_mode)
}

/// PackBits RLEデコード
fn decode_packbits(input: &[u8], output: &mut [u8]) {
    let mut i = 0;
    let mut o = 0;

    while i < input.len() && o < output.len() {
        let n = input[i] as i8;
        i += 1;

        if n >= 0 {
            // リテラル: n+1バイトをコピー
            let count = (n as usize) + 1;
            let end = (o + count).min(output.len());
            let src_end = (i + count).min(input.len());
            let copy_len = (end - o).min(src_end - i);
            output[o..o + copy_len].copy_from_slice(&input[i..i + copy_len]);
            i += count;
            o += count;
        } else if n > -128 {
            // 繰り返し: 次の1バイトを(-n+1)回繰り返す
            let count = (-n as usize) + 1;
            if i < input.len() {
                let val = input[i];
                i += 1;
                let end = (o + count).min(output.len());
                for byte in output.iter_mut().take(end).skip(o) {
                    *byte = val;
                }
                o += count;
            }
        }
    }
}

/// チャンネルデータをRGBA画像に変換
fn channels_to_rgba(
    channel_data: Vec<Vec<u8>>,
    width: u32,
    height: u32,
    color_mode: u16,
) -> Result<DynamicImage, String> {
    let pixels = (width as usize) * (height as usize);
    let mut rgba = vec![255u8; pixels * 4];

    match color_mode {
        3 => {
            // RGB
            for i in 0..pixels {
                rgba[i * 4] = channel_data.first().map(|c| c[i]).unwrap_or(0);
                rgba[i * 4 + 1] = channel_data.get(1).map(|c| c[i]).unwrap_or(0);
                rgba[i * 4 + 2] = channel_data.get(2).map(|c| c[i]).unwrap_or(0);
                rgba[i * 4 + 3] = channel_data.get(3).map(|c| c[i]).unwrap_or(255);
            }
        }
        1 => {
            // Grayscale
            for i in 0..pixels {
                let gray = channel_data.first().map(|c| c[i]).unwrap_or(0);
                rgba[i * 4] = gray;
                rgba[i * 4 + 1] = gray;
                rgba[i * 4 + 2] = gray;
                rgba[i * 4 + 3] = channel_data.get(1).map(|c| c[i]).unwrap_or(255);
            }
        }
        _ => {}
    }

    let img: RgbaImage = ImageBuffer::from_raw(width, height, rgba)
        .ok_or_else(|| format!("RGBA画像の作成に失敗しました ({}x{})", width, height))?;
    Ok(DynamicImage::ImageRgba8(img))
}

/// PSDファイルをpsd crateで読み込む（レイヤー合成版、フォールバック用）
fn load_psd_with_layers(path: &Path) -> Result<DynamicImage, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    let psd = psd::Psd::from_bytes(&bytes).map_err(|e| format!("PSDの読み込みに失敗: {:?}", e))?;

    let width = psd.width();
    let height = psd.height();
    let rgba = psd.rgba();

    let img: RgbaImage =
        ImageBuffer::from_raw(width, height, rgba).ok_or("PSD画像の変換に失敗")?;

    Ok(DynamicImage::ImageRgba8(img))
}
