// サムネイル設定（高解像度版・PNG形式）
pub const THUMBNAIL_SIZE: u32 = 480; // 高DPIディスプレイ対応（240px×2倍、メモリ節約）

// 画像サイズ制限（DoS防止）
pub const MAX_IMAGE_DIMENSION: u32 = 65535; // 最大辺長
pub const MAX_PIXEL_COUNT: u64 = 100_000_000; // 最大ピクセル数（100メガピクセル）

// サポートする拡張子
// pdf はフォルダ走査時にエントリとして拾うのみ。
// 実際の取り込みではフロント側でラスタライズ（rasterize_pdf）して JPEG へ変換する。
pub const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "psd", "tif", "tiff", "pdf"];

// メモリキャッシュサイズ
pub const MEMORY_CACHE_MAX_SIZE: usize = 20; // 最大20件をメモリに保持（メモリ節約）
