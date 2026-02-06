use std::collections::{HashMap, VecDeque};

pub struct ThumbnailMemoryCache {
    cache: HashMap<String, String>,  // cache_key -> base64 data URL
    order: VecDeque<String>,         // LRU順序
    max_size: usize,
}

impl ThumbnailMemoryCache {
    pub fn new(max_size: usize) -> Self {
        Self {
            cache: HashMap::new(),
            order: VecDeque::new(),
            max_size,
        }
    }

    pub fn get(&mut self, key: &str) -> Option<String> {
        if let Some(value) = self.cache.get(key) {
            // アクセスされたキーを末尾に移動（LRU更新）
            self.order.retain(|k| k != key);
            self.order.push_back(key.to_string());
            Some(value.clone())
        } else {
            None
        }
    }

    pub fn insert(&mut self, key: String, value: String) {
        // 既存のキーがあれば更新
        if self.cache.contains_key(&key) {
            self.order.retain(|k| k != &key);
        } else if self.cache.len() >= self.max_size {
            // キャッシュが満杯なら最も古いものを削除
            if let Some(oldest) = self.order.pop_front() {
                self.cache.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.cache.insert(key, value);
    }
}
