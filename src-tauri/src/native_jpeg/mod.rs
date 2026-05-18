//! native_jpeg - Photoshop不要のJPEG化・断ち切りモジュール
//! Tachimi (Tachimi-_Standalone) の processor モジュールから
//! JPEG化・断ち切り・リサイズ処理を移植（ノンブル / PDF は除外）

pub mod image_loader;
pub mod image_processing;
pub mod jpeg;
pub mod types;

pub use image_processing::process_single_image;
pub use types::ProcessOptions;
