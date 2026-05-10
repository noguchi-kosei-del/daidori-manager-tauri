import { useEffect, useState } from 'react';

/**
 * モーダルのフェードイン／フェードアウトアニメーションを管理するフック
 *
 * isOpen が false に変わると即座にアンマウントせず、closing フラグを立てて
 * アニメーション完了後に shouldRender を false にする。
 *
 * @param isOpen 親コンポーネントから渡される表示フラグ
 * @param exitDuration フェードアウト後にアンマウントするまでの遅延（ms）。デフォルト 300（--transition-slow）
 */
export function useModalAnimation(
  isOpen: boolean,
  exitDuration = 300,
): { shouldRender: boolean; isClosing: boolean } {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      return;
    }
    if (!shouldRender) return;
    setIsClosing(true);
    const timer = setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
    }, exitDuration);
    return () => clearTimeout(timer);
  }, [isOpen, shouldRender, exitDuration]);

  return { shouldRender, isClosing };
}
