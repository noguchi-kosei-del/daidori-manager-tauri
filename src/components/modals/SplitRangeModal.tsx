import { useState } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useModalAnimation } from '../../hooks';
import type { Page } from '../../types';
import { PAGE_TYPE_LABELS } from '../../types';

export interface SplitRange {
  startIndex: number;
  endIndex: number;
}

const SPLIT_COLOR_COUNT = 8;

interface SplitRangeGridProps {
  // 出力順に並んだ全ページ（チャプターを跨いだ通し順）
  pages: Page[];
  ranges: SplitRange[];
  onChange: (ranges: SplitRange[]) => void;
}

/**
 * 出力の分割範囲を指定するサムネイルグリッド（ウィザードのステップ／モーダルで共用）。
 * EPUBの分割と同じく「開始→終了」の順にクリックして範囲（巻）を作る。
 */
export function SplitRangeGrid({ pages, ranges, onChange }: SplitRangeGridProps) {
  const [selectingStart, setSelectingStart] = useState<number | null>(null);

  const sorted = [...ranges].sort((a, b) => a.startIndex - b.startIndex);
  const volumeNoOf = (i: number) => {
    const idx = sorted.findIndex((r) => i >= r.startIndex && i <= r.endIndex);
    return idx >= 0 ? idx + 1 : -1;
  };

  const handleClick = (i: number) => {
    const existing = ranges.findIndex((r) => i >= r.startIndex && i <= r.endIndex);
    if (existing >= 0) {
      onChange(ranges.filter((_, idx) => idx !== existing));
      setSelectingStart(null);
      return;
    }
    if (selectingStart === null) {
      setSelectingStart(i);
      return;
    }
    const start = Math.min(selectingStart, i);
    const end = Math.max(selectingStart, i);
    const overlaps = ranges.some((r) => !(end < r.startIndex || start > r.endIndex));
    if (!overlaps) {
      onChange([...ranges, { startIndex: start, endIndex: end }].sort((a, b) => a.startIndex - b.startIndex));
    }
    setSelectingStart(null);
  };

  const thumbSrc = (p: Page) =>
    p.thumbnailStatus === 'ready' && p.thumbnailCachePath ? convertFileSrc(p.thumbnailCachePath) : null;

  return (
    <>
      <div className="split-range-guide">
        {selectingStart !== null
          ? `開始: ${selectingStart + 1}ページ目 → 終了ページをクリック`
          : 'まとめたい範囲の「開始ページ」→「終了ページ」の順にクリックすると分割（巻）になります。割当済みをクリックで解除。出力時に範囲ごとのフォルダ（01, 02…）に分かれます。'}
      </div>
      <div className="split-range-grid">
        {pages.map((p, i) => {
          const vno = volumeNoOf(i);
          const assigned = vno > 0;
          const selecting = selectingStart === i;
          const src = thumbSrc(p);
          return (
            <button
              key={p.id}
              type="button"
              className={`split-range-thumb ${assigned ? 'assigned' : ''} ${selecting ? 'selecting' : ''}`}
              style={assigned ? ({ ['--split-color' as string]: `var(--split-color-${(vno - 1) % SPLIT_COLOR_COUNT})` }) : undefined}
              onClick={() => handleClick(i)}
            >
              <span className="split-range-thumb-img">
                {src ? (
                  <img src={src} alt="" loading="lazy" />
                ) : (
                  <span className="ph">{p.pageType === 'file' ? (p.fileName || '…') : (p.label || PAGE_TYPE_LABELS[p.pageType])}</span>
                )}
              </span>
              <span className="split-range-thumb-no">{i + 1}</span>
              {assigned && <span className="split-range-thumb-badge">{vno}巻</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

interface SplitRangeModalProps {
  isOpen: boolean;
  pages: Page[];
  ranges: SplitRange[];
  onChange: (ranges: SplitRange[]) => void;
  onClose: () => void;
}

/** 分割範囲指定モーダル（単独利用向け。ウィザードでは SplitRangeGrid を直接使う）。 */
export function SplitRangeModal({ isOpen, pages, ranges, onChange, onClose }: SplitRangeModalProps) {
  const { shouldRender, isClosing } = useModalAnimation(isOpen);
  if (!shouldRender) return null;

  return createPortal(
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={onClose}>
      <div className={`modal-content split-range-modal ${isClosing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>分割の設定</h2>
        </div>
        <SplitRangeGrid pages={pages} ranges={ranges} onChange={onChange} />
        <div className="modal-footer">
          {ranges.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => onChange([])}>すべて解除</button>
          )}
          <button type="button" className="btn-primary" onClick={onClose}>完了（{ranges.length}分割）</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
