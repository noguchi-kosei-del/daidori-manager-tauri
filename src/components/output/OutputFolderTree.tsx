import type { ReactElement } from 'react';
import { FolderIcon } from '../../icons';
import type { Chapter } from '../../types';
import type { ChapterRenameSettings } from '../modals/ExportModal';

// 出力時に生成される保存先ディレクトリ構成を、マーメイド風のフォルダツリー図で表示する。
// useExport.ts の出力ロジック（分割→01/02、チャプターごと→チャプター名フォルダ、
// 全TIFFコピーのフラット化、同時作成→全体）と対応させた説明用ダイアグラム。

interface SplitRange {
  startIndex: number;
  endIndex: number;
}

interface OutputFolderTreeProps {
  outputPath: string;
  outputFormat: 'copy' | 'jpg' | 'tiff';
  exportMode: 'copy' | 'move';
  renameMode: 'unified' | 'perChapter';
  splitRanges: SplitRange[];
  splitAlsoWhole: boolean;
  prefix: string;
  startNumber: number;
  digits: number;
  chapters: Chapter[];
  perChapterSettings: Record<string, ChapterRenameSettings>;
}

type NodeKind = 'path' | 'dest' | 'folder' | 'file';

interface FNode {
  key: string;
  label: string;
  kind: NodeKind;
  note?: string;
  prefixEllipsis?: boolean;
  children?: FNode[];
}

// fileType → 出力拡張子（原本コピーは元拡張子を維持する）
function normalizeExt(fileType?: string): string {
  switch ((fileType || '').toLowerCase()) {
    case 'tif':
    case 'tiff':
      return '.tif';
    case 'jpg':
    case 'jpeg':
      return '.jpg';
    case 'png':
      return '.png';
    case 'psd':
      return '.psd';
    case '':
      return '';
    default:
      return `.${(fileType || '').toLowerCase()}`;
  }
}

// 小さなファイル風アイコン（ツリーのファイルノード用）
function FileGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function OutputFolderTree({
  outputPath,
  outputFormat,
  exportMode,
  renameMode,
  splitRanges,
  splitAlsoWhole,
  prefix,
  startNumber,
  digits,
  chapters,
  perChapterSettings,
}: OutputFolderTreeProps) {
  const orderedPages = chapters.flatMap((c) => c.pages);
  const total = orderedPages.length;
  const dg = Math.max(1, digits);
  const pad = (n: number) => String(Math.max(0, n)).padStart(dg, '0');

  // 原本コピーの拡張子（全ページ同一なら表示、混在なら拡張子なしで「元の形式」と注記）
  const filePages = orderedPages.filter((p) => p.filePath && p.fileType);
  const copyExts = Array.from(new Set(filePages.map((p) => normalizeExt(p.fileType))));
  const copyExt = outputFormat === 'copy' && copyExts.length === 1 ? copyExts[0] : '';
  const copyMixed = outputFormat === 'copy' && copyExts.length > 1;
  const ext = outputFormat === 'jpg' ? '.jpg' : outputFormat === 'tiff' ? '.tif' : copyExt;

  const sampleName = (i: number) => `${prefix}${pad(startNumber + i)}${ext}`;

  const sorted = [...splitRanges].sort((a, b) => a.startIndex - b.startIndex);
  const alsoWhole = splitAlsoWhole && sorted.length > 0;
  const allTiffCopy =
    filePages.length > 0 && filePages.every((p) => p.fileType === 'tif' || p.fileType === 'tiff');
  const enabledChapters = chapters.filter(
    (c) => perChapterSettings[c.id]?.enabled !== false && c.pages.length > 0,
  );

  // ファイル群を1ノードにまとめる（先頭2件＋総数）
  const fileGroupNode = (count: number, makeName: (i: number) => string, extraNote?: string): FNode => {
    if (count <= 0) return { key: 'files', kind: 'file', label: 'ファイルなし' };
    const examples: string[] = [];
    for (let i = 0; i < Math.min(2, count); i += 1) examples.push(makeName(i));
    const label = `${examples.join(', ')}${count > 2 ? ', …' : ''}`;
    const noteParts = [`全${count}枚`];
    if (extraNote) noteParts.push(extraNote);
    return { key: 'files', kind: 'file', label, note: noteParts.join(' / ') };
  };

  // 出力先フォルダ直下に生成される子ノードを設定から計算
  const buildLeafChildren = (): FNode[] => {
    // 分割（全形式共通）: 範囲ごとに 01 / 02 … サブフォルダ
    if (sorted.length > 0) {
      const nodes: FNode[] = sorted.map((r, i) => ({
        key: `split-${i}`,
        kind: 'folder',
        label: String(i + 1).padStart(2, '0'),
        note: `P${r.startIndex + 1}–P${r.endIndex + 1}・${r.endIndex - r.startIndex + 1}枚`,
      }));
      if (alsoWhole) nodes.push({ key: 'whole', kind: 'folder', label: '全体', note: `全${total}枚` });
      return nodes;
    }
    // チャプターごと＋原本コピー（全TIFFフラット化を除く）: チャプター名フォルダ
    if (renameMode === 'perChapter' && outputFormat === 'copy' && !allTiffCopy) {
      return enabledChapters.map((c) => ({
        key: `ch-${c.id}`,
        kind: 'folder',
        label: c.name,
        note: `${c.pages.length}枚`,
      }));
    }
    // それ以外: 出力先直下にファイルを連番でフラット出力
    if (renameMode === 'perChapter' && allTiffCopy && enabledChapters.length > 0) {
      // 全TIFFの原本コピー＝「チャプター名_連番.tif」でフラット化
      const first = enabledChapters[0];
      const firstStart = perChapterSettings[first.id]?.startNumber ?? 1;
      const makeName = (i: number) => `${first.name}_${pad(firstStart + i)}.tif`;
      return [fileGroupNode(total, makeName, copyMixed ? '元の形式を維持' : undefined)];
    }
    return [fileGroupNode(total, sampleName, copyMixed ? '元の形式を維持' : undefined)];
  };

  // 出力先パスを末尾3階層に絞ってカスケード表示（深いパスは先頭を … で省略）
  const segs = outputPath ? outputPath.split(/[\\/]+/).filter(Boolean) : [];
  const shown = segs.slice(-3);
  const truncated = segs.length > shown.length;

  // 出力形式に応じたサブフォルダ（TIF / JPEG / 原本）を出力先直下に作成し、その中へ格納する
  const formatFolderLabel = outputFormat === 'tiff' ? 'TIF' : outputFormat === 'jpg' ? 'JPEG' : '原本';
  const formatFolderNode: FNode = {
    key: 'fmt',
    kind: 'folder',
    label: formatFolderLabel,
    note: '出力形式',
    children: buildLeafChildren(),
  };

  let root: FNode | null = null;
  if (shown.length > 0) {
    root = {
      key: 'dest',
      kind: 'dest',
      label: shown[shown.length - 1],
      note: exportMode === 'move' ? '出力先（移動）' : '出力先',
      children: [formatFolderNode],
    };
    for (let i = shown.length - 2; i >= 0; i -= 1) {
      root = {
        key: `path-${i}`,
        kind: 'path',
        label: shown[i],
        prefixEllipsis: i === 0 && truncated,
        children: [root],
      };
    }
  }

  // 凡例（出力形式 / モード）
  const formatLabel = outputFormat === 'jpg' ? 'JPEG変換' : outputFormat === 'tiff' ? 'TIFF変換' : '原本コピー';
  const modeLabel =
    sorted.length > 0
      ? `${sorted.length}分割${alsoWhole ? '＋全体' : ''}`
      : renameMode === 'perChapter'
        ? 'チャプターごと'
        : '一括';

  const renderNode = (n: FNode): ReactElement => (
    <li className="oft-li" key={n.key}>
      <div className={`oft-node oft-${n.kind}`}>
        <span className="oft-icon">{n.kind === 'file' ? <FileGlyph /> : <FolderIcon size={15} />}</span>
        <span className="oft-label">
          {n.prefixEllipsis && <span className="oft-ellipsis">…\</span>}
          {n.label}
        </span>
        {n.note && <span className="oft-note">{n.note}</span>}
      </div>
      {n.children && n.children.length > 0 && (
        <ul className="oft-children">{n.children.map((c) => renderNode(c))}</ul>
      )}
    </li>
  );

  return (
    <div className="export-folder-tree">
      <div className="oft-head">
        <FolderIcon size={15} />
        <span>フォルダ構成</span>
      </div>
      {root ? (
        <ul className="oft-tree">{renderNode(root)}</ul>
      ) : (
        <div className="oft-empty">出力先フォルダを選択すると、生成されるフォルダ構成を表示します。</div>
      )}
      <div className="oft-legend">
        <span className="oft-legend-chip">{formatLabel}</span>
        <span className="oft-legend-chip">{modeLabel}</span>
      </div>
    </div>
  );
}
