//! native_jpeg - 画像処理
//! Tachimi processor/image_processing.rs から クロップ/タチキリ/リサイズを移植
//! （ノンブル処理 add_nombre_to_image は移植しない）

use ::image::imageops::FilterType;
use ::image::{DynamicImage, GenericImageView, RgbaImage};
use std::path::Path;

use super::image_loader::load_image;
use super::jpeg::{write_jpeg_baseline_to_file, write_jpeg_mozjpeg_to_file};
use super::types::{
    color_to_rgb, color_to_rgba, ProcessOptions, TARGET_RESIZE_HEIGHT, TARGET_RESIZE_WIDTH,
};

/// JPEG保存（fast_jpeg=true ならベースライン高速エンコード、false なら MozJPEG）
fn save_jpeg(
    rgb: &[u8],
    width: u32,
    height: u32,
    options: &ProcessOptions,
    output_path: &Path,
) -> Result<(), String> {
    if options.fast_jpeg {
        write_jpeg_baseline_to_file(rgb, width, height, options.jpeg_quality, output_path)
    } else {
        write_jpeg_mozjpeg_to_file(rgb, width, height, options.jpeg_quality, output_path)
    }
}

/// クロップ矩形を計算（基準サイズスケーリング込み）。範囲が無効なら None。
/// `process_single_image` の実処理と `predict_output_dims` の予測で共有する。
pub fn compute_crop_rect(
    orig_width: u32,
    orig_height: u32,
    options: &ProcessOptions,
) -> Option<(u32, u32, u32, u32)> {
    // スケーリング計算（設定時の基準サイズから実画像サイズへ）
    let (scale_x, scale_y) = if options.reference_width > 0 && options.reference_height > 0 {
        (
            orig_width as f64 / options.reference_width as f64,
            orig_height as f64 / options.reference_height as f64,
        )
    } else {
        (1.0, 1.0)
    };

    // クロップ座標をスケーリング
    let scaled_left = (options.crop_left as f64 * scale_x).round() as u32;
    let scaled_top = (options.crop_top as f64 * scale_y).round() as u32;
    let scaled_right = (options.crop_right as f64 * scale_x).round() as u32;
    let scaled_bottom = (options.crop_bottom as f64 * scale_y).round() as u32;

    // クロップ座標の検証
    let crop_left = scaled_left.min(orig_width);
    let crop_top = scaled_top.min(orig_height);
    let crop_right = scaled_right.min(orig_width).max(crop_left);
    let crop_bottom = scaled_bottom.min(orig_height).max(crop_top);

    if crop_right - crop_left == 0 || crop_bottom - crop_top == 0 {
        return None;
    }
    Some((crop_left, crop_top, crop_right, crop_bottom))
}

/// リサイズ後の寸法を計算（None = リサイズなし＝元寸法維持）。
/// `apply_resize` の実処理と `predict_output_dims` の予測で共有する。
fn resize_dims(w: u32, h: u32, options: &ProcessOptions) -> Option<(u32, u32)> {
    match options.resize_mode.as_str() {
        "percent" => {
            let scale = options.resize_percent as f32 / 100.0;
            let nw = (w as f32 * scale).round() as u32;
            let nh = (h as f32 * scale).round() as u32;
            if nw == 0 || nh == 0 {
                None
            } else {
                Some((nw, nh))
            }
        }
        "fixed" => {
            let scale = (TARGET_RESIZE_WIDTH as f32 / w as f32)
                .min(TARGET_RESIZE_HEIGHT as f32 / h as f32);
            let nw = (w as f32 * scale).round() as u32;
            let nh = (h as f32 * scale).round() as u32;
            if nw == 0 || nh == 0 {
                None
            } else {
                Some((nw, nh))
            }
        }
        "exact" => {
            if options.resize_target_w == 0 || options.resize_target_h == 0 {
                None
            } else {
                Some((options.resize_target_w, options.resize_target_h))
            }
        }
        _ => None,
    }
}

/// Tachimi の "fixed" リサイズ相当: `TARGET_RESIZE_WIDTH`×`TARGET_RESIZE_HEIGHT`
/// (2250×3000) の枠に収まるようアスペクト比を保って縮小する（拡大はしない）。
///
/// チャプターPDFの埋め込み画像をネイティブ印刷解像度（例 600dpi）のまま渡すと
/// PDFが数百MBに肥大化するため、Tachimi 標準の書き出し解像度（B5で約300dpi相当）に
/// 抑えてPDFを軽量化する。
pub fn fit_within_pdf_bbox(w: u32, h: u32) -> (u32, u32) {
    if w == 0 || h == 0 {
        return (w, h);
    }
    let scale =
        (TARGET_RESIZE_WIDTH as f32 / w as f32).min(TARGET_RESIZE_HEIGHT as f32 / h as f32);
    if scale >= 1.0 {
        // 既に枠内なら拡大しない（解像度を上げてもファイルが大きくなるだけ）
        return (w, h);
    }
    let nw = ((w as f32 * scale).round() as u32).max(1);
    let nh = ((h as f32 * scale).round() as u32).max(1);
    (nw, nh)
}

/// 断ち切り＋リサイズ適用後の最終出力寸法を、画像をデコードせずに予測する。
/// `prepare_pages_for_pdf` が統一目標サイズを決めるために使用。
pub fn predict_output_dims(src_w: u32, src_h: u32, options: &ProcessOptions) -> (u32, u32) {
    let (bw, bh) = if options.tachikiri_type == "none" {
        (src_w, src_h)
    } else {
        match options.tachikiri_type.as_str() {
            "crop" | "crop_only" | "crop_and_stroke" => {
                match compute_crop_rect(src_w, src_h, options) {
                    Some((l, t, r, b)) => (r - l, b - t),
                    None => (src_w, src_h),
                }
            }
            // stroke_only / fill_white / fill_and_stroke / その他は全画像サイズ維持
            _ => (src_w, src_h),
        }
    };
    resize_dims(bw, bh, options).unwrap_or((bw, bh))
}

/// 単一画像を処理（読込 → 断ち切り → リサイズ → MozJPEG保存）
pub fn process_single_image(
    input_path: &Path,
    output_path: &Path,
    options: &ProcessOptions,
) -> Result<(), String> {
    let img = load_image(input_path)?;
    let (orig_width, orig_height) = img.dimensions();

    // タチキリタイプが "none" なら断ち切り処理なしでリサイズ→保存
    if options.tachikiri_type == "none" {
        let result = img.to_rgba8();
        let final_image = apply_resize(DynamicImage::ImageRgba8(result), options);
        let rgb_image = final_image.to_rgb8();
        save_jpeg(
            rgb_image.as_raw(),
            rgb_image.width(),
            rgb_image.height(),
            options,
            output_path,
        )?;
        return Ok(());
    }

    // クロップ矩形（基準サイズスケーリング込み）
    let (crop_left, crop_top, crop_right, crop_bottom) =
        compute_crop_rect(orig_width, orig_height, options)
            .ok_or_else(|| "クロップ範囲が無効です".to_string())?;

    let crop_width = crop_right - crop_left;
    let crop_height = crop_bottom - crop_top;

    let mut result: RgbaImage;

    match options.tachikiri_type.as_str() {
        "crop" | "crop_only" => {
            let cropped = img.crop_imm(crop_left, crop_top, crop_width, crop_height);
            result = cropped.to_rgba8();
        }
        "crop_and_stroke" => {
            let cropped = img.crop_imm(crop_left, crop_top, crop_width, crop_height);
            result = cropped.to_rgba8();
            draw_stroke(&mut result, &options.stroke_color);
        }
        "stroke_only" => {
            result = img.to_rgba8();
            draw_stroke_at_crop(
                &mut result,
                crop_left,
                crop_top,
                crop_right,
                crop_bottom,
                &options.stroke_color,
            );
        }
        "fill_white" | "fill_and_stroke" => {
            result = img.to_rgba8();
            fill_outside_crop(
                &mut result,
                crop_left,
                crop_top,
                crop_right,
                crop_bottom,
                &options.fill_color,
                options.fill_opacity,
            );

            if options.tachikiri_type == "fill_and_stroke" {
                draw_stroke_at_crop(
                    &mut result,
                    crop_left,
                    crop_top,
                    crop_right,
                    crop_bottom,
                    &options.stroke_color,
                );
            }
        }
        _ => {
            result = img.to_rgba8();
        }
    }

    // リサイズ処理
    let final_image = apply_resize(DynamicImage::ImageRgba8(result), options);

    // JPEG保存（fast_jpeg で MozJPEG/ベースラインを選択）
    let rgb_image = final_image.to_rgb8();
    save_jpeg(
        rgb_image.as_raw(),
        rgb_image.width(),
        rgb_image.height(),
        options,
        output_path,
    )?;

    Ok(())
}

/// リサイズ処理を適用
fn apply_resize(img: DynamicImage, options: &ProcessOptions) -> DynamicImage {
    let (w, h) = img.dimensions();
    match resize_dims(w, h, options) {
        Some((nw, nh)) => {
            // exact（チャプターPDFのサイズ統一）は速度優先で Triangle、
            // それ以外（ユーザー向けエクスポートの percent/fixed）は従来どおり CatmullRom
            let filter = if options.resize_mode == "exact" {
                FilterType::Triangle
            } else {
                FilterType::CatmullRom
            };
            img.resize_exact(nw, nh, filter)
        }
        None => img,
    }
}

/// 画像の境界に線を描画（5px幅）
pub fn draw_stroke(img: &mut RgbaImage, color: &str) {
    let (width, height) = img.dimensions();
    let stroke_color = color_to_rgb(color);
    let thickness: u32 = 5;

    for x in 0..width {
        for t in 0..thickness.min(height) {
            img.put_pixel(x, t, stroke_color);
            img.put_pixel(x, height - 1 - t, stroke_color);
        }
    }
    for y in 0..height {
        for t in 0..thickness.min(width) {
            img.put_pixel(t, y, stroke_color);
            img.put_pixel(width - 1 - t, y, stroke_color);
        }
    }
}

/// 指定座標に線を描画（5px幅）
pub fn draw_stroke_at_crop(
    img: &mut RgbaImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
    color: &str,
) {
    let stroke_color = color_to_rgb(color);
    let thickness: u32 = 5;
    let img_w = img.width();
    let img_h = img.height();

    for x in left..right {
        for t in 0..thickness {
            let y_top = top + t;
            if y_top < img_h {
                img.put_pixel(x, y_top, stroke_color);
            }
            if bottom > t {
                let y_bot = bottom - 1 - t;
                if y_bot < img_h && y_bot >= top {
                    img.put_pixel(x, y_bot, stroke_color);
                }
            }
        }
    }
    for y in top..bottom {
        for t in 0..thickness {
            let x_left = left + t;
            if x_left < img_w {
                img.put_pixel(x_left, y, stroke_color);
            }
            if right > t {
                let x_right = right - 1 - t;
                if x_right < img_w && x_right >= left {
                    img.put_pixel(x_right, y, stroke_color);
                }
            }
        }
    }
}

/// クロップ範囲外を塗りつぶす
pub fn fill_outside_crop(
    img: &mut RgbaImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
    color: &str,
    opacity: u8,
) {
    let (width, height) = img.dimensions();
    let fill_color = color_to_rgba(color, opacity);
    let raw: &mut [u8] = img.as_mut();
    let bytes_per_pixel = 4usize;
    let stride = width as usize * bytes_per_pixel;

    let alpha = fill_color[3] as f32 / 255.0;
    let inv_alpha = 1.0 - alpha;

    let blend_pixel = |base: &mut [u8]| {
        base[0] = (base[0] as f32 * inv_alpha + fill_color[0] as f32 * alpha) as u8;
        base[1] = (base[1] as f32 * inv_alpha + fill_color[1] as f32 * alpha) as u8;
        base[2] = (base[2] as f32 * inv_alpha + fill_color[2] as f32 * alpha) as u8;
        base[3] = 255;
    };

    // 上部領域
    for y in 0..top as usize {
        let row_start = y * stride;
        for x in 0..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 下部領域
    for y in bottom as usize..height as usize {
        let row_start = y * stride;
        for x in 0..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 左部領域
    for y in top as usize..bottom as usize {
        let row_start = y * stride;
        for x in 0..left as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 右部領域
    for y in top as usize..bottom as usize {
        let row_start = y * stride;
        for x in right as usize..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }
}
