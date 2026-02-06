use std::fs;
use std::path::PathBuf;

// サムネイルキャッシュディレクトリ
pub struct ThumbnailCache {
    pub cache_dir: PathBuf,
}

impl ThumbnailCache {
    pub fn new() -> Self {
        let cache_dir = dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("daidori-manager")
            .join("thumbnails");

        // キャッシュディレクトリ作成（エラー時はログ出力）
        if let Err(e) = fs::create_dir_all(&cache_dir) {
            eprintln!("キャッシュディレクトリ作成失敗: {} - {}", cache_dir.display(), e);
        }

        Self { cache_dir }
    }
}
