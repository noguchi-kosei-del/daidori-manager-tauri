use crate::constants::THUMBNAIL_SIZE;
use crate::image_utils::{create_thumbnail, validate_dimensions};
use image::DynamicImage;
use memmap2::Mmap;
use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

// PSDファイルから埋め込みサムネイルを高速抽出
fn extract_psd_embedded_thumbnail(data: &[u8]) -> Option<Vec<u8>> {
    let mut cursor = Cursor::new(data);

    // PSDシグネチャ確認 "8BPS"
    let mut sig = [0u8; 4];
    cursor.read_exact(&mut sig).ok()?;
    if &sig != b"8BPS" {
        return None;
    }

    // バージョン (2bytes) + 予約 (6bytes) + チャンネル数 (2bytes) + 高さ (4bytes) + 幅 (4bytes) + 深度 (2bytes) + カラーモード (2bytes)
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

    // リソースを検索
    while cursor.position() < resources_end {
        // 無限ループ防止: ループ開始位置を記録
        let loop_start_pos = cursor.position();

        // リソースシグネチャ "8BIM"
        let mut resource_sig = [0u8; 4];
        if let Err(e) = cursor.read_exact(&mut resource_sig) {
            eprintln!("PSD thumbnail: resource signature read error: {}", e);
            break;
        }
        if &resource_sig != b"8BIM" {
            break;
        }

        // リソースID (2bytes)
        let mut id_buf = [0u8; 2];
        cursor.read_exact(&mut id_buf).ok()?;
        let resource_id = u16::from_be_bytes(id_buf);

        // パスカル文字列（名前）をスキップ
        let mut name_len = [0u8; 1];
        cursor.read_exact(&mut name_len).ok()?;
        let skip_len = if name_len[0] % 2 == 0 {
            name_len[0] as i64 + 1
        } else {
            name_len[0] as i64
        };
        if let Err(e) = cursor.seek(SeekFrom::Current(skip_len)) {
            eprintln!("PSD thumbnail: seek error (name skip): {}", e);
            break;
        }

        // リソースデータサイズ
        cursor.read_exact(&mut len_buf).ok()?;
        let resource_size = u32::from_be_bytes(len_buf);

        // サムネイルリソース (1036 = Photoshop 5.0+, 1033 = 旧バージョン)
        if resource_id == 1036 || resource_id == 1033 {
            // サムネイルリソースヘッダー (28bytes)
            // format(4) + width(4) + height(4) + widthbytes(4) + totalsize(4) + compressedsize(4) + bpp(2) + planes(2)
            let mut header = [0u8; 28];
            cursor.read_exact(&mut header).ok()?;

            let format = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);

            // format == 1 は JPEG
            if format == 1 {
                // 整数アンダーフロー防止: resource_sizeが28未満の場合はスキップ
                if resource_size < 28 {
                    return None;
                }
                let jpeg_size = resource_size as usize - 28;
                if jpeg_size == 0 {
                    return None;
                }
                let mut jpeg_data = vec![0u8; jpeg_size];
                cursor.read_exact(&mut jpeg_data).ok()?;
                return Some(jpeg_data);
            }
        }

        // 次のリソースへ（偶数バウンダリにアライン）
        let padded_size = if resource_size % 2 == 0 {
            resource_size
        } else {
            resource_size + 1
        };
        if let Err(e) = cursor.seek(SeekFrom::Current(padded_size as i64)) {
            eprintln!("PSD thumbnail: seek error (next resource): {}", e);
            break;
        }

        // 無限ループ防止: カーソルが進んでいることを確認
        if cursor.position() <= loop_start_pos {
            break;
        }
    }

    None
}

// PSDファイルからサムネイルを生成
// mmap使用: 埋め込みサムネイルの場合はファイル先頭の数KBのみアクセス（数百MBのPSDでもメモリ効率的）
// フルコンポジットが必要な場合のみ全データを読み込み
pub fn generate_psd_thumbnail(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;

    // メモリマップ: OSがアクセスされた部分だけページインする（全ファイル読み込みを回避）
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| format!("mmap失敗: {}", e))?;

    // 1. 埋め込みサムネイル（JPEG）を試行（ファイル先頭の数KBのみアクセス）
    if let Some(jpeg_data) = extract_psd_embedded_thumbnail(&mmap) {
        if let Ok(img) = image::load_from_memory_with_format(&jpeg_data, image::ImageFormat::Jpeg) {
            let (width, height) = (img.width(), img.height());
            if width >= THUMBNAIL_SIZE || height >= THUMBNAIL_SIZE {
                return create_thumbnail(img);
            }
        }
    }

    // 2. フルコンポジットで高品質なサムネイルを生成（全データアクセスが必要）
    let psd_file =
        psd::Psd::from_bytes(&mmap).map_err(|e| format!("PSD読み込みエラー: {:?}", e))?;

    let width = psd_file.width();
    let height = psd_file.height();

    validate_dimensions(width, height)?;

    let rgba = psd_file.rgba();

    let img = DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(width, height, rgba).ok_or("画像データの変換に失敗")?,
    );

    create_thumbnail(img)
}
