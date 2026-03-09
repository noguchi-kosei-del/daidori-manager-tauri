import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * ウィンドウ終了時の未保存確認ダイアログを管理するフック
 * @param isModified 変更があるかどうか
 * @param onShowUnsavedDialog 未保存ダイアログを表示するコールバック
 */
export function useWindowCloseHandler(
  isModified: boolean,
  onShowUnsavedDialog: () => void
): void {
  const isModifiedRef = useRef(isModified);

  // isModifiedの変更を追跡
  useEffect(() => {
    isModifiedRef.current = isModified;
  }, [isModified]);

  // ウィンドウ終了ハンドラ（一度だけ登録）
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isMounted = true;

    const setupCloseHandler = async () => {
      console.log('Setting up close handler...');
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        console.log('Close requested, isModified:', isModifiedRef.current);
        if (isModifiedRef.current) {
          console.log('Preventing close, showing dialog');
          event.preventDefault();
          onShowUnsavedDialog();
        } else {
          console.log('Allowing close');
          await appWindow.destroy();
        }
      });
      if (isMounted) {
        console.log('Close handler setup complete');
      }
    };

    setupCloseHandler();

    return () => {
      isMounted = false;
      console.log('Cleaning up close handler');
      if (unlisten) {
        unlisten();
      }
    };
  }, [onShowUnsavedDialog]);
}
