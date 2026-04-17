use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::epub::EpubBuilder;
use crate::types::{EpubFormat, EpubGenerateConfig, EpubGenerateResponse, EpubMetadata, EpubPage};

/// EPUB生成コマンド
#[tauri::command]
pub async fn generate_epub(
    app_handle: AppHandle,
    metadata: EpubMetadata,
    pages: Vec<EpubPage>,
    output_path: String,
    custom_css: Option<String>,
) -> Result<EpubGenerateResponse, String> {
    // バリデーション
    validate_metadata(&metadata)?;
    validate_pages(&pages)?;

    // 設定を構築
    let config = EpubGenerateConfig {
        metadata,
        pages,
        output_path,
        custom_css,
    };

    // CSSリソースディレクトリを取得
    let css_dir = get_css_resource_dir(&app_handle)?;

    // ビルダーを作成して実行
    let builder = EpubBuilder::new(config).with_css_resource_dir(css_dir);

    // 別スレッドで実行（ブロッキング処理のため）
    tokio::task::spawn_blocking(move || builder.build())
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

/// メタデータのバリデーション
fn validate_metadata(metadata: &EpubMetadata) -> Result<(), String> {
    if metadata.title.trim().is_empty() {
        return Err("タイトルを入力してください".to_string());
    }

    if metadata.publisher.trim().is_empty() {
        return Err("出版社を入力してください".to_string());
    }

    if metadata.authors.is_empty() {
        return Err("著者を1人以上追加してください".to_string());
    }

    for author in &metadata.authors {
        if author.name.trim().is_empty() {
            return Err("著者名が空のエントリがあります".to_string());
        }
    }

    if metadata.viewport_width == 0 || metadata.viewport_height == 0 {
        return Err("ビューポートサイズが不正です".to_string());
    }

    Ok(())
}

/// ページのバリデーション
fn validate_pages(pages: &[EpubPage]) -> Result<(), String> {
    if pages.is_empty() {
        return Err("ページが1つもありません".to_string());
    }

    // 奥付ページの確認
    let has_colophon = pages.iter().any(|p| p.is_colophon);
    if !has_colophon {
        return Err("奥付ページを設定してください".to_string());
    }

    // ソースファイルの存在確認
    for page in pages {
        let path = std::path::Path::new(&page.source_path);
        if !path.exists() {
            return Err(format!("画像ファイルが見つかりません: {}", page.source_path));
        }
    }

    Ok(())
}

/// CSSリソースディレクトリを取得
fn get_css_resource_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    // Tauriのリソースディレクトリを取得
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    let css_dir = resource_dir.join("resources/kadokawa_css");

    // ディレクトリが存在するか確認
    if css_dir.exists() {
        Ok(css_dir)
    } else {
        // 開発モードの場合は src-tauri/resources から探す
        let dev_css_dir = resource_dir.join("kadokawa_css");
        if dev_css_dir.exists() {
            Ok(dev_css_dir)
        } else {
            // 見つからない場合でもエラーにせず、最小CSSで対応
            Ok(css_dir)
        }
    }
}

/// 新しいUUIDを生成
#[tauri::command]
pub fn generate_book_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// デフォルトメタデータを作成（UUID自動生成・ビューポート自動設定）
#[tauri::command]
pub fn create_epub_metadata(title: String, publisher: String) -> EpubMetadata {
    EpubMetadata::new(title, publisher)
}

/// 形式に応じたデフォルトビューポートサイズを返す
#[tauri::command]
pub fn get_default_viewport(format: EpubFormat) -> (u32, u32) {
    format.default_viewport()
}

/// 画像サイズを取得（PSD対応、ヘッダのみ読み取り）
#[tauri::command]
pub async fn get_image_dimensions(path: String) -> Result<(u32, u32), String> {
    tokio::task::spawn_blocking(move || {
        let lower = path.to_lowercase();
        if lower.ends_with(".psd") {
            // PSDヘッダ（26バイト）のみ読み取り
            let mut file = std::fs::File::open(&path)
                .map_err(|e| format!("Failed to open PSD file: {}", e))?;
            let mut header = [0u8; 26];
            std::io::Read::read_exact(&mut file, &mut header)
                .map_err(|e| format!("Failed to read PSD header: {}", e))?;
            if &header[0..4] != b"8BPS" {
                return Err("Invalid PSD file".to_string());
            }
            let height = u32::from_be_bytes([header[14], header[15], header[16], header[17]]);
            let width = u32::from_be_bytes([header[18], header[19], header[20], header[21]]);
            Ok((width, height))
        } else {
            // ヘッダのみ読み取り（画像全体をデコードしない）
            image::image_dimensions(&path).map_err(|e| format!("Failed to read image dimensions: {}", e))
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
