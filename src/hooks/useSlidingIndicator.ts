import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface IndicatorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * セグメント型トグル（タブ等）のアクティブ要素位置を計測し、
 * 背後をヌルッと滑らせるインジケーター用の矩形を返す。
 *
 * - コンテナに `containerRef` を渡し、アクティブな子要素には `.active` クラスを付ける。
 * - `activeKey`（例: activeTab / previewMode）が変わるたびに再計測。
 * - ResizeObserver でフォント読み込み・幅変化にも追従。callback ref 方式なので
 *   条件付きでマウント/アンマウントされるトグルにも正しく再アタッチされる。
 */
export function useSlidingIndicator<T extends HTMLElement = HTMLDivElement>(activeKey: unknown) {
  const [rect, setRect] = useState<IndicatorRect | null>(null);
  const elementRef = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const measure = useCallback(() => {
    const container = elementRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('.active');
    if (!active) return;
    setRect({
      left: active.offsetLeft,
      top: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    });
  }, []);

  // コンテナのマウント/アンマウントに合わせて計測＋ResizeObserverを張り直す
  const containerRef = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    elementRef.current = node;
    if (node) {
      measure();
      const ro = new ResizeObserver(() => measure());
      ro.observe(node);
      observerRef.current = ro;
    }
  }, [measure]);

  // activeKey 変化時に再計測（同一マウント内での切替）
  useLayoutEffect(() => {
    measure();
  }, [activeKey, measure]);

  return { containerRef, rect };
}
