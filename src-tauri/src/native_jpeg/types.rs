//! native_jpeg - 型定義
//! Tachimi processor/types.rs から JPEG化・断ち切りに必要な部分のみ移植
//! （ノンブル / PDF 関連は除外）

use ::image::Rgba;
use serde::{Deserialize, Serialize};

/// 処理オプション（Tachimi ProcessOptions の縮小版）
/// フロントエンドからは camelCase JSON で渡される
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOptions {
    pub crop_left: u32,
    pub crop_top: u32,
    pub crop_right: u32,
    pub crop_bottom: u32,
    /// タチキリ処理タイプ: "none", "crop_only", "crop_and_stroke", "stroke_only", "fill_white", "fill_and_stroke"
    #[serde(default = "default_tachikiri_type")]
    pub tachikiri_type: String,
    /// 線の色: "black", "white", "cyan"
    #[serde(default = "default_stroke_color")]
    pub stroke_color: String,
    /// 塗りの色: "white", "black", "cyan"
    #[serde(default = "default_fill_color")]
    pub fill_color: String,
    /// 塗りの不透明度: 0-100
    #[serde(default = "default_fill_opacity")]
    pub fill_opacity: u8,
    /// 基準ドキュメントサイズ（スケーリング用）
    #[serde(default)]
    pub reference_width: u32,
    #[serde(default)]
    pub reference_height: u32,
    /// リサイズ設定: "none", "percent", "fixed", "exact"
    #[serde(default = "default_resize_mode")]
    pub resize_mode: String,
    #[serde(default = "default_resize_percent")]
    pub resize_percent: u32,
    /// "exact" リサイズ時の目標サイズ（0 のときは無効）
    #[serde(default)]
    pub resize_target_w: u32,
    #[serde(default)]
    pub resize_target_h: u32,
    /// JPEG品質（0-100）
    #[serde(default = "default_jpeg_quality")]
    pub jpeg_quality: f32,
    /// true のときベースラインJPEG（高速）で出力。false（既定）は MozJPEG。
    /// チャプターPDFの中間ファイル用にサーバ側で true を強制する。
    #[serde(default)]
    pub fast_jpeg: bool,
}

impl Default for ProcessOptions {
    fn default() -> Self {
        Self {
            crop_left: 0,
            crop_top: 0,
            crop_right: 0,
            crop_bottom: 0,
            tachikiri_type: default_tachikiri_type(),
            stroke_color: default_stroke_color(),
            fill_color: default_fill_color(),
            fill_opacity: default_fill_opacity(),
            reference_width: 0,
            reference_height: 0,
            resize_mode: default_resize_mode(),
            resize_percent: default_resize_percent(),
            resize_target_w: 0,
            resize_target_h: 0,
            jpeg_quality: default_jpeg_quality(),
            fast_jpeg: false,
        }
    }
}

pub fn default_tachikiri_type() -> String {
    "none".to_string()
}
pub fn default_stroke_color() -> String {
    "black".to_string()
}
pub fn default_fill_color() -> String {
    "white".to_string()
}
pub fn default_fill_opacity() -> u8 {
    50
}
pub fn default_jpeg_quality() -> f32 {
    95.0
}
pub fn default_resize_mode() -> String {
    "none".to_string()
}
pub fn default_resize_percent() -> u32 {
    50
}

/// リサイズターゲットサイズ（Tachimi と同じ）
pub const TARGET_RESIZE_WIDTH: u32 = 2250;
pub const TARGET_RESIZE_HEIGHT: u32 = 3000;

/// 色文字列からRGBA値を取得（塗り用、不透明度指定可）
pub fn color_to_rgba(color: &str, opacity: u8) -> Rgba<u8> {
    let alpha = (opacity as f32 * 2.55) as u8;
    match color {
        "white" => Rgba([255, 255, 255, alpha]),
        "black" => Rgba([0, 0, 0, alpha]),
        "cyan" => Rgba([0, 255, 255, alpha]),
        _ => Rgba([255, 255, 255, alpha]),
    }
}

/// 色文字列からRGB値を取得（線用、完全不透明）
pub fn color_to_rgb(color: &str) -> Rgba<u8> {
    match color {
        "white" => Rgba([255, 255, 255, 255]),
        "black" => Rgba([0, 0, 0, 255]),
        "cyan" => Rgba([0, 255, 255, 255]),
        _ => Rgba([0, 0, 0, 255]),
    }
}
