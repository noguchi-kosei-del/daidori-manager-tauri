import type { CSSProperties } from 'react';
import type { IndicatorRect } from '../hooks/useSlidingIndicator';

/**
 * セグメント型トグルのアクティブ位置の背後を滑るインジケーター。
 * 位置は `useSlidingIndicator` が計測した `rect` を `transform: translateX` ＋ top/width/height で反映する。
 * 見た目（色・トランジション等）は `className` で渡す各トグル固有の CSS クラスが担う。
 */
export function SlidingIndicator({ rect, className }: { rect: IndicatorRect | null; className: string }) {
  if (!rect) return null;
  return (
    <span
      className={className}
      style={{
        transform: `translateX(${rect.left}px)`,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      } as CSSProperties}
    />
  );
}
