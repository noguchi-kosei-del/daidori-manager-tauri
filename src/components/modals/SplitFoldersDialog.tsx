import { useEffect, useState } from 'react';
import { FolderIcon } from '../../icons';
import type { FileInfo } from '../../store';
import { useModalAnimation } from '../../hooks';

export interface SplitFolderEntry {
  /** ドロップされたフォルダのパス */
  folderPath: string;
  /** フォルダ表示名（パス末尾） */
  folderName: string;
  /** フォルダ内の取り込み対象ファイル */
  files: FileInfo[];
}

export interface SplitFoldersDialogResult {
  name: string;
  files: FileInfo[];
}

export interface SplitFoldersDialogProps {
  /** ダイアログ表示フラグ（false の間はフェードアウト → アンマウント） */
  isOpen?: boolean;
  folders: SplitFolderEntry[];
  /** 各行のデフォルトチャプター名（folders と同じ長さ） */
  defaultNames: string[];
  /** 各行のラベル接尾辞（例: 先頭行に「（ドロップ先）」と表示） */
  rowAnnotations?: (string | null)[];
  /** タイトル・説明文に表示するチャプタータイプ名（例: 「本文」「幕間」） */
  chapterTypeLabel?: string;
  onConfirm: (selected: SplitFoldersDialogResult[]) => void;
  onCancel: () => void;
}

interface RowState {
  enabled: boolean;
  name: string;
}

export function SplitFoldersDialog({
  isOpen = true,
  folders,
  defaultNames,
  rowAnnotations,
  chapterTypeLabel = 'チャプター',
  onConfirm,
  onCancel,
}: SplitFoldersDialogProps) {
  const { shouldRender, isClosing } = useModalAnimation(isOpen);
  const [rows, setRows] = useState<RowState[]>(() =>
    folders.map((_, i) => ({
      enabled: true,
      name: defaultNames[i] ?? `本文${i + 1}`,
    }))
  );

  // ESCで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  const enabledCount = rows.filter((r) => r.enabled).length;
  const totalFileCount = folders.reduce(
    (sum, f, i) => (rows[i]?.enabled ? sum + f.files.length : sum),
    0
  );

  const handleToggle = (index: number) => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleNameChange = (index: number, name: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, name } : r)));
  };

  const handleConfirm = () => {
    const result: SplitFoldersDialogResult[] = [];
    folders.forEach((folder, i) => {
      const row = rows[i];
      if (!row?.enabled) return;
      const trimmed = row.name.trim();
      result.push({
        name: trimmed || defaultNames[i] || `本文${i + 1}`,
        files: folder.files,
      });
    });
    onConfirm(result);
  };

  if (!shouldRender) return null;

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={onCancel}>
      <div
        className={`modal-content split-folders-modal ${isClosing ? 'closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>
            <FolderIcon size={18} />
            {chapterTypeLabel}チャプターに分ける
          </h2>
        </div>
        <div className="modal-body">
          <p className="split-folders-description">
            {folders.length} 個のフォルダを、それぞれ別の{chapterTypeLabel}チャプターとして取り込みます。チェックを外すと取り込み対象から除外されます。
          </p>
          <ul className="split-folders-list">
            {folders.map((folder, i) => {
              const row = rows[i];
              const annotation = rowAnnotations?.[i] ?? null;
              return (
                <li
                  key={folder.folderPath}
                  className={`split-folders-row ${row?.enabled ? '' : 'disabled'}`}
                >
                  <label className="split-folders-checkbox-label">
                    <input
                      type="checkbox"
                      checked={row?.enabled ?? false}
                      onChange={() => handleToggle(i)}
                    />
                  </label>
                  <div className="split-folders-folder">
                    <div className="split-folders-folder-name" title={folder.folderPath}>
                      <FolderIcon size={14} />
                      <span>{folder.folderName}</span>
                      {annotation && (
                        <span className="split-folders-annotation">{annotation}</span>
                      )}
                    </div>
                    <div className="split-folders-folder-meta">
                      {folder.files.length} ファイル
                    </div>
                  </div>
                  <input
                    type="text"
                    className="split-folders-name-input"
                    value={row?.name ?? ''}
                    onChange={(e) => handleNameChange(i, e.target.value)}
                    placeholder={defaultNames[i] ?? `本文${i + 1}`}
                    disabled={!row?.enabled}
                  />
                </li>
              );
            })}
          </ul>
        </div>
        <div className="modal-footer">
          <span className="split-folders-summary">
            {enabledCount} / {folders.length} フォルダ・計 {totalFileCount} ファイルを取り込み
          </span>
          <button className="btn-secondary" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={enabledCount === 0}
          >
            取り込む
          </button>
        </div>
      </div>
    </div>
  );
}
