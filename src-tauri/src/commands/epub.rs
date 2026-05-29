use serde::Serialize;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::epub::EpubBuilder;
use crate::types::{EpubFormat, EpubGenerateConfig, EpubGenerateResponse, EpubMetadata, EpubPage};

#[derive(Serialize)]
pub struct PsdGuide {
    #[serde(rename = "type")]
    pub guide_type: String,
    pub position: u32,
}

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
    validate_pages(&metadata, &pages)?;

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
    let builder = EpubBuilder::new(config)
        .with_css_resource_dir(css_dir)
        .with_app_handle(app_handle);

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
fn validate_pages(metadata: &EpubMetadata, pages: &[EpubPage]) -> Result<(), String> {
    if pages.is_empty() {
        return Err("ページが1つもありません".to_string());
    }

    // 白紙ページのみではEPUB生成不可（基準サイズが算出できないため）
    if pages.iter().all(|p| p.is_blank) {
        return Err("白紙ページのみではEPUBを生成できません。画像ページを追加してください".to_string());
    }

    // 奥付ページの確認
    let has_colophon = pages.iter().any(|p| p.is_colophon);
    let allow_missing_colophon = metadata.allow_missing_colophon
        || (metadata.output_format == EpubFormat::Hybrid
            && metadata.hybrid_css_profile == crate::types::HybridCssProfile::Legacy);
    if !has_colophon && !allow_missing_colophon {
        return Err("奥付ページを設定してください".to_string());
    }

    // ソースファイルの存在確認（白紙ページはスキップ）
    for page in pages {
        if page.is_blank {
            continue;
        }
        let path = std::path::Path::new(&page.source_path);
        if !path.exists() {
            return Err(format!(
                "画像ファイルが見つかりません: {}",
                page.source_path
            ));
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

/// PSDファイル内のガイド線情報を読み取る（リソースID 1032）
#[tauri::command]
pub async fn read_psd_guides(path: String) -> Result<Vec<PsdGuide>, String> {
    tokio::task::spawn_blocking(move || {
        let lower = path.to_lowercase();
        if !lower.ends_with(".psd") {
            return Ok(Vec::new());
        }

        let data = std::fs::read(&path).map_err(|e| format!("Failed to open PSD file: {}", e))?;

        Ok(extract_psd_guides(&data).unwrap_or_default())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// PSDバイナリからガイド線情報(リソースID 1032)を抽出
fn extract_psd_guides(data: &[u8]) -> Option<Vec<PsdGuide>> {
    let mut cursor = Cursor::new(data);

    // PSDシグネチャ確認 "8BPS"
    let mut sig = [0u8; 4];
    cursor.read_exact(&mut sig).ok()?;
    if &sig != b"8BPS" {
        return None;
    }

    // バージョン(2) + 予約(6) + チャンネル数(2) + 高さ(4) + 幅(4) + 深度(2) + カラーモード(2)
    cursor.seek(SeekFrom::Current(22)).ok()?;

    // カラーモードデータセクションをスキップ
    let mut len_buf = [0u8; 4];
    cursor.read_exact(&mut len_buf).ok()?;
    let color_mode_len = u32::from_be_bytes(len_buf);
    cursor.seek(SeekFrom::Current(color_mode_len as i64)).ok()?;

    // イメージリソースセクション
    cursor.read_exact(&mut len_buf).ok()?;
    let resources_len = u32::from_be_bytes(len_buf);
    let resources_end = cursor.position() + resources_len as u64;

    while cursor.position() < resources_end {
        let loop_start_pos = cursor.position();

        let mut resource_sig = [0u8; 4];
        if cursor.read_exact(&mut resource_sig).is_err() {
            break;
        }
        if &resource_sig != b"8BIM" {
            break;
        }

        let mut id_buf = [0u8; 2];
        cursor.read_exact(&mut id_buf).ok()?;
        let resource_id = u16::from_be_bytes(id_buf);

        // パスカル文字列(名前)をスキップ
        let mut name_len = [0u8; 1];
        cursor.read_exact(&mut name_len).ok()?;
        let skip_len = if name_len[0] % 2 == 0 {
            name_len[0] as i64 + 1
        } else {
            name_len[0] as i64
        };
        if cursor.seek(SeekFrom::Current(skip_len)).is_err() {
            break;
        }

        cursor.read_exact(&mut len_buf).ok()?;
        let resource_size = u32::from_be_bytes(len_buf);

        // リソースID 1032 = Grid and guides information
        if resource_id == 1032 && resource_size >= 16 {
            let start = cursor.position();

            // version(4) + gridCycleV(4) + gridCycleH(4)
            cursor.seek(SeekFrom::Current(12)).ok()?;

            let mut count_buf = [0u8; 4];
            cursor.read_exact(&mut count_buf).ok()?;
            let guide_count = u32::from_be_bytes(count_buf) as usize;

            let mut guides = Vec::with_capacity(guide_count);
            for _ in 0..guide_count {
                let mut loc_buf = [0u8; 4];
                if cursor.read_exact(&mut loc_buf).is_err() {
                    break;
                }
                let location = u32::from_be_bytes(loc_buf);

                let mut dir_buf = [0u8; 1];
                if cursor.read_exact(&mut dir_buf).is_err() {
                    break;
                }
                // direction: 0 = vertical line(x座標), 1 = horizontal line(y座標)
                // location は 1/32 pxで格納
                let position = location / 32;
                let guide_type = if dir_buf[0] == 0 { "v" } else { "h" };
                guides.push(PsdGuide {
                    guide_type: guide_type.to_string(),
                    position,
                });
            }

            // リソースブロックの終端にシーク
            let padded_size = if resource_size % 2 == 0 {
                resource_size
            } else {
                resource_size + 1
            };
            let _ = cursor.seek(SeekFrom::Start(start + padded_size as u64));

            return Some(guides);
        }

        // 次のリソースへ(偶数バウンダリにアライン)
        let padded_size = if resource_size % 2 == 0 {
            resource_size
        } else {
            resource_size + 1
        };
        if cursor.seek(SeekFrom::Current(padded_size as i64)).is_err() {
            break;
        }

        if cursor.position() <= loop_start_pos {
            break;
        }
    }

    Some(Vec::new())
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
            image::image_dimensions(&path)
                .map_err(|e| format!("Failed to read image dimensions: {}", e))
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
