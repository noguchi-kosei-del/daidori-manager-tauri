//! native_jpeg - Photoshop不要のJPEG化・断ち切りモジュール
//! Tachimi (Tachimi-_Standalone) の processor モジュールから
//! JPEG化・断ち切り・リサイズ処理を移植（ノンブル / PDF は除外）

pub mod blur;
pub mod image_loader;
pub mod image_processing;
pub mod jpeg;
pub mod types;

pub use image_loader::read_image_dimensions;
pub use image_processing::{
    fit_within_pdf_bbox, predict_output_dims, process_image_to_rgb, save_processed_rgb,
};
pub use types::ProcessOptions;
