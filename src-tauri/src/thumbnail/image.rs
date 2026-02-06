use std::path::Path;
use crate::image_utils::create_thumbnail;

// 一般画像ファイルからサムネイルを生成
pub fn generate_image_thumbnail(path: &Path) -> Result<Vec<u8>, String> {
    let img = image::open(path)
        .map_err(|e| format!("画像読み込みエラー: {}", e))?;

    create_thumbnail(img)
}
