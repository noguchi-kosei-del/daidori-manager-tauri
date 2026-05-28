import { invoke } from '@tauri-apps/api/core';
import type { FileInfo } from '../store';

/**
 * FileInfo[] の中にある PDF エントリ (file_type === 'pdf') を
 * rasterize_pdf 経由で JPEG ファイル群に展開する。
 *
 * - PDF エントリは結果リストから除かれ、その位置に展開後の JPEG が挿入される。
 * - PDF 以外のエントリはそのまま素通し。
 * - 1 つの PDF の展開に失敗した場合は errors にエントリを積み、その PDF は飛ばす。
 * - 進捗は backend が `pdf-rasterize-progress` イベントで自動 emit する。
 */
export interface ExpandPdfResult {
  files: FileInfo[];
  pdfCount: number;
  expandedCount: number;
  errors: { pdfName: string; message: string }[];
}

export async function expandPdfFiles(files: FileInfo[]): Promise<ExpandPdfResult> {
  const out: FileInfo[] = [];
  const errors: ExpandPdfResult['errors'] = [];
  let pdfCount = 0;
  let expandedCount = 0;

  for (const f of files) {
    if (f.file_type === 'pdf') {
      pdfCount += 1;
      try {
        const pages: FileInfo[] = await invoke('rasterize_pdf', { pdfPath: f.path });
        expandedCount += pages.length;
        out.push(...pages);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ pdfName: f.name, message });
        console.error(`PDF展開失敗: ${f.name}`, e);
      }
    } else {
      out.push(f);
    }
  }

  return { files: out, pdfCount, expandedCount, errors };
}

/**
 * 単一の PDF ファイルパスをラスタライズして JPEG エントリを得る。
 */
export async function rasterizeSinglePdf(pdfPath: string): Promise<FileInfo[]> {
  return await invoke<FileInfo[]>('rasterize_pdf', { pdfPath });
}
