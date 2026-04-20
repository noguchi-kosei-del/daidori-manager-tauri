// 紙サイズ判定ユーティリティ
// 画像のピクセル寸法とDPIから物理サイズ(mm)を計算し、近い規格サイズ名を返す

interface PaperSize {
  name: string;
  w: number; // mm (短辺)
  h: number; // mm (長辺)
}

// よく使われる規格サイズ（短辺×長辺のmm）
const PAPER_SIZES: PaperSize[] = [
  { name: 'A3', w: 297, h: 420 },
  { name: 'A4', w: 210, h: 297 },
  { name: 'A5', w: 148, h: 210 },
  { name: 'A6', w: 105, h: 148 },
  { name: 'B3', w: 364, h: 515 },
  { name: 'B4', w: 257, h: 364 },
  { name: 'B5', w: 182, h: 257 },
  { name: 'B6', w: 128, h: 182 },
  // 同人誌・商業誌でよくある仕上がり寸法
  { name: '新書判', w: 112, h: 174 },
  { name: '四六判', w: 127, h: 188 },
];

const PX_PER_MM = (dpi: number): number => dpi / 25.4;

/**
 * ピクセル寸法とDPIから物理サイズ(mm)を計算
 */
export function pixelsToMm(pxW: number, pxH: number, dpi: number): { wMm: number; hMm: number } {
  const ppm = PX_PER_MM(dpi);
  return {
    wMm: pxW / ppm,
    hMm: pxH / ppm,
  };
}

/**
 * 物理サイズ(mm)に最も近い規格サイズ名を返す
 * 縦横どちらの向きでも一致を許容（短辺・長辺で正規化）
 * @param tolerance 許容誤差(mm)。塗り足し3mm程度を考慮
 * @returns 規格名 + 仕上がり寸法 / 完全に一致しなければ null
 */
export function findPaperSize(wMm: number, hMm: number, tolerance = 6): string | null {
  const normW = Math.min(wMm, hMm);
  const normH = Math.max(wMm, hMm);
  for (const p of PAPER_SIZES) {
    if (Math.abs(p.w - normW) <= tolerance && Math.abs(p.h - normH) <= tolerance) {
      return `${p.name}（${p.w}×${p.h}mm）`;
    }
  }
  return null;
}

/**
 * ピクセル寸法とDPIから「相当する規格サイズ + 物理寸法」を生成
 * DPIが無い場合は null
 */
export function describePhysicalSize(pxW: number, pxH: number, dpi: number | undefined): string | null {
  if (!dpi || dpi <= 0) return null;
  const { wMm, hMm } = pixelsToMm(pxW, pxH, dpi);
  const wMmRound = Math.round(wMm);
  const hMmRound = Math.round(hMm);
  const matched = findPaperSize(wMm, hMm);
  if (matched) {
    return `${matched}相当 ／ 実寸 ${wMmRound}×${hMmRound}mm`;
  }
  return `${wMmRound}×${hMmRound}mm`;
}
