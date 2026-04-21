import { useCallback, useRef, useState } from 'react';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

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
  const pendingUpdateRef = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    setState({ ...INITIAL_STATE, state: 'checking', silent });

    try {
      const update = await check();

      if (update) {
        pendingUpdateRef.current = update;
        setState({
          state: 'available',
          info: { version: update.version, body: update.body ?? '' },
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
      let totalContentLength = 0;
      let totalDownloaded = 0;

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          totalContentLength = event.data.contentLength ?? 0;
          totalDownloaded = 0;
          setState((prev) => ({
            ...prev,
            state: 'downloading',
            downloaded: 0,
            contentLength: totalContentLength,
          }));
        } else if (event.event === 'Progress') {
          totalDownloaded += event.data.chunkLength;
          setState((prev) => ({
            ...prev,
            state: 'downloading',
            downloaded: totalDownloaded,
            contentLength: totalContentLength,
          }));
        } else if (event.event === 'Finished') {
          setState((prev) => ({
            ...prev,
            state: 'installing',
            downloaded: totalContentLength,
            contentLength: totalContentLength,
          }));
        }
      });

      setState((prev) => ({ ...prev, state: 'done' }));

      setTimeout(async () => {
        try {
          await relaunch();
        } catch (err) {
          console.error('[useAutoUpdate] relaunch failed:', err);
          setState((prev) => ({
            ...prev,
            state: 'error',
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }, 1500);
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
