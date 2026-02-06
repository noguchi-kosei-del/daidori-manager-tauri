use std::sync::Mutex;
use crate::cache::ThumbnailMemoryCache;

// アプリケーション状態（メモリキャッシュを保持）
pub struct AppState {
    pub memory_cache: Mutex<ThumbnailMemoryCache>,
}
