use crate::cache::ThumbnailMemoryCache;
use std::sync::Mutex;

// アプリケーション状態（メモリキャッシュを保持）
pub struct AppState {
    pub memory_cache: Mutex<ThumbnailMemoryCache>,
}
