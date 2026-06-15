import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
// 脱github: 自動更新は G:更新置き場を minisign 検証する Rust コマンド(check_local_update/apply_local_update)を使う
type LocalUpdateInfo = { version: string; file_name: string; setup_path: string };

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'done'
  | 'error';

export interface UpdateInfo {
  version: string;
  body: string;
}

export interface AutoUpdateState {
  state: UpdateState;
  info: UpdateInfo | null;
  downloaded: number;
  contentLength: number;
  error: string | null;
  silent: boolean;
}

export interface UseAutoUpdateReturn {
  state: AutoUpdateState;
  checkForUpdate: (options?: { silent?: boolean }) => Promise<void>;
  installPending: () => Promise<void>;
  dismiss: () => void;
}

const INITIAL_STATE: AutoUpdateState = {
  state: 'idle',
  info: null,
  downloaded: 0,
  contentLength: 0,
  error: null,
  silent: false,
};

export function useAutoUpdate(): UseAutoUpdateReturn {
  const [state, setState] = useState<AutoUpdateState>(INITIAL_STATE);
  const pendingUpdateRef = useRef<LocalUpdateInfo | null>(null);

  const checkForUpdate = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    setState({ ...INITIAL_STATE, state: 'checking', silent });

    try {
      const update = await invoke<LocalUpdateInfo | null>('check_local_update');

      if (update) {
        pendingUpdateRef.current = update;
        setState({
          state: 'available',
          info: { version: update.version, body: '' },
          downloaded: 0,
          contentLength: 0,
          error: null,
          silent,
        });
      } else {
        pendingUpdateRef.current = null;
        setState({
          state: 'up-to-date',
          info: null,
          downloaded: 0,
          contentLength: 0,
          error: null,
          silent,
        });
      }
    } catch (err) {
      console.error('[useAutoUpdate] check failed:', err);
      pendingUpdateRef.current = null;
      setState({
        state: 'error',
        info: null,
        downloaded: 0,
        contentLength: 0,
        error: err instanceof Error ? err.message : String(err),
        silent,
      });
    }
  }, []);

  const installPending = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update) {
      setState((prev) => ({
        ...prev,
        state: 'error',
        error: 'アップデート情報が見つかりません',
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      state: 'downloading',
      downloaded: 0,
      contentLength: 0,
      error: null,
    }));

    try {
      setState((prev) => ({ ...prev, state: 'installing' }));
      // 脱github: G:更新置き場のsetup.exeを再検証→サイレント更新(/S /R /UPDATE)→アプリ自動終了・再起動
      await invoke('apply_local_update', { setupPath: update.setup_path });
      setState((prev) => ({ ...prev, state: 'done' }));
    } catch (err) {
      console.error('[useAutoUpdate] install failed:', err);
      setState((prev) => ({
        ...prev,
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const dismiss = useCallback(() => {
    pendingUpdateRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { state, checkForUpdate, installPending, dismiss };
}

export function scheduleStartupCheck(run: () => void, delayMs = 2000): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}
