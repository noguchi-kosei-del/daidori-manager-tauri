//! native_jpeg - ぼかし処理（Photoshop不要）
//!
//! - 全体ガウスぼかし: `image` クレートの `imageops::blur` で画像全体にガウスをかける
//! - 背景のみぼかし: PSD のテキストレイヤー（#text#/写植 等）をマスクとして検出し、
//!   「全体をぼかした画像」の上にテキスト部分だけ元のシャープなピクセルを重ねる。
//!   これにより Photoshop のレイヤー効果（白フチ等）をレンダリングできなくても、
//!   文字グリフをシャープに保ち、フチ・背景は一緒にぼかすことができる。
//!   （文字のフチも背景同様にぼかしてよい、という前提で成立する方式）

use ::image::{imageops, DynamicImage, GenericImageView};
use psd::{PsdGroup, PsdLayer};
use std::collections::HashMap;
use std::path::Path;

/// テキストとみなすグループ/レイヤー名（tiff_convert.jsx の TEXT_GROUP_NAMES と一致）
/// 部分一致で判定するキーワード。英語 "text" は "context" などの誤検出を避けるため
/// 完全一致のみ別途扱う。
const TEXT_KEYWORDS_SUBSTR: &[&str] = &["#text#", "写植", "セリフ", "テキスト", "台詞"];

/// レイヤー/グループ名がテキスト系か判定する。
fn name_is_text(name: &str) -> bool {
    let n = name.trim().to_lowercase();
    if n == "text" || n == "#text#" {
        return true;
    }
    TEXT_KEYWORDS_SUBSTR
        .iter()
        .any(|k| n.contains(&k.to_lowercase()))
}

/// あるグループ id から祖先グループを辿り、テキスト系グループに属するか判定する。
fn group_chain_is_text(groups: &HashMap<u32, PsdGroup>, mut gid: Option<u32>) -> bool {
    let mut guard = 0;
    while let Some(id) = gid {
        guard += 1;
        if guard > 64 {
            return false; // 異常な循環参照に対する保険
        }
        match groups.get(&id) {
            Some(g) => {
                if name_is_text(g.name()) {
                    return true;
                }
                gid = g.parent_id();
            }
            None => return false,
        }
    }
    false
}

/// PSD からテキストレイヤーのみを合成した RGBA（フル画面サイズ）を返す。
/// PSD 以外・テキストレイヤーなし・読み込み失敗の場合は None。
/// 戻り値 alpha>0 の画素が文字グリフの位置（フチ等のレイヤー効果は含まれない）。
fn text_layers_rgba(path: &Path) -> Option<(Vec<u8>, u32, u32)> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "psd" {
        return None;
    }

    let bytes = std::fs::read(path).ok()?;
    let psd = psd::Psd::from_bytes(&bytes).ok()?;
    let layers = psd.layers();
    if layers.is_empty() {
        return None;
    }
    let groups = psd.groups();

    let is_text_layer = |layer: &PsdLayer| -> bool {
        name_is_text(layer.name()) || group_chain_is_text(groups, layer.parent_id())
    };

    // レイヤー index ごとにテキスト判定を事前計算（flatten のフィルタで idx 参照）
    let is_text: Vec<bool> = layers.iter().map(is_text_layer).collect();
    if !is_text.iter().any(|&b| b) {
        return None;
    }

    let rgba = psd
        .flatten_layers_rgba(&|(idx, _)| is_text.get(idx).copied().unwrap_or(false))
        .ok()?;
    Some((rgba, psd.width(), psd.height()))
}

/// 画像全体にガウスぼかしを適用した新しい画像を返す。半径(=sigma相当)が 0 以下なら複製を返す。
pub fn gaussian_blur(img: &DynamicImage, radius: f32) -> DynamicImage {
    if radius <= 0.0 {
        return img.clone();
    }
    DynamicImage::ImageRgba8(imageops::blur(&img.to_rgba8(), radius))
}

/// ぼかしを適用する。
/// - `background_only=false`: 画像全体にガウスぼかし。
/// - `background_only=true` かつ PSD でテキストレイヤーを検出できる場合:
///   全体をぼかしたうえで、テキストグリフ部分だけ元のシャープなピクセルを重ねる
///   （文字シャープ・フチ/背景はぼける）。検出できない場合は全体ぼかしにフォールバック。
pub fn apply_blur(
    input_path: &Path,
    img: &DynamicImage,
    radius: f32,
    background_only: bool,
) -> DynamicImage {
    if radius <= 0.0 {
        return img.clone();
    }
    let blurred = gaussian_blur(img, radius);
    if !background_only {
        return blurred;
    }

    // 背景のみ: テキストレイヤーのマスクを取得（取れなければ全体ぼかし）
    let (text_rgba, tw, th) = match text_layers_rgba(input_path) {
        Some(v) => v,
        None => return blurred,
    };
    let (w, h) = img.dimensions();
    // マスクと画像の寸法が一致しない場合は安全側に倒して全体ぼかし
    if tw != w || th != h {
        return blurred;
    }

    const ALPHA_THRESHOLD: u8 = 16;
    // 安全策: テキストマスクが画像の過大な割合（>50%）を覆う場合は、マスクが不正
    // （例: グレースケールPSDで psd クレートがアルファを誤生成）とみなし、全体ぼかしに倒す。
    // これがないと「シャープ上書き」が画面全体に及び、ぼかしが全く見えなくなる。
    let text_px = text_rgba
        .chunks_exact(4)
        .filter(|p| p[3] > ALPHA_THRESHOLD)
        .count();
    let total_px = (w as usize) * (h as usize);
    if total_px == 0 || text_px * 2 > total_px {
        return blurred;
    }

    let sharp = img.to_rgba8();
    let sharp_raw = sharp.as_raw();
    let mut out = blurred.to_rgba8();
    // 文字グリフ部分を元のシャープ画素で（グリフのアルファに応じて）上書き。
    // 閾値未満のごく薄い縁はぼかし側のまま残す（境界のにじみ抑制）。
    for (i, px) in out.pixels_mut().enumerate() {
        let a = text_rgba[i * 4 + 3];
        if a <= ALPHA_THRESHOLD {
            continue;
        }
        let s = i * 4;
        let af = a as f32 / 255.0;
        let inv = 1.0 - af;
        px[0] = (sharp_raw[s] as f32 * af + px[0] as f32 * inv) as u8;
        px[1] = (sharp_raw[s + 1] as f32 * af + px[1] as f32 * inv) as u8;
        px[2] = (sharp_raw[s + 2] as f32 * af + px[2] as f32 * inv) as u8;
    }
    DynamicImage::ImageRgba8(out)
}

/// テキストマスクが取得可能かどうか（UI 判定や事前検査用の補助）。
#[allow(dead_code)]
pub fn has_text_mask(path: &Path) -> bool {
    text_layers_rgba(path).is_some()
}

/// 画像が実質的にカラーか（R/G/B に有意な差がある画素が一定割合あるか）を判定する。
///
/// PSD の「カラーモード」が RGB でも、内容が白黒/グレースケール（各画素 R=G=B）なら false を返す。
/// → RGBモードで保存された白黒漫画原稿を「モノクロ」と正しく扱える（ぼかし対象になる）。
/// 本物のカラー原稿のみ true。サンプリングで高速判定する。
pub fn is_effectively_color(img: &DynamicImage) -> bool {
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    let total = (w as usize) * (h as usize);
    if total == 0 {
        return false;
    }
    // 最大 ~200k 画素をサンプリング（全画素走査は重いので間引く）
    let step = (total / 200_000).max(1);
    let raw = rgb.as_raw();
    let mut color_px = 0usize;
    let mut sampled = 0usize;
    let mut i = 0usize;
    while i < total {
        let o = i * 3;
        let r = raw[o] as i32;
        let g = raw[o + 1] as i32;
        let b = raw[o + 2] as i32;
        // JPEG/アンチエイリアスの微差は無視（>24 のみカラー画素とみなす）
        let d = (r - g).abs().max((g - b).abs()).max((r - b).abs());
        if d > 24 {
            color_px += 1;
        }
        sampled += 1;
        i += step;
    }
    // 有意なカラー画素が 0.5% を超えたらカラー原稿と判定
    sampled > 0 && (color_px as f64 / sampled as f64) > 0.005
}
