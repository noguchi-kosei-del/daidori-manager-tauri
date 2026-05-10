import { DownloadIcon, RefreshIcon, CloseIcon } from '../../icons';
import type { AutoUpdateState } from '../../hooks/useAutoUpdate';

export interface UpdateDialogProps {
  state: AutoUpdateState;
  onInstall: () => void;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function UpdateDialog({ state, onInstall, onDismiss }: UpdateDialogProps) {
  if (state.state === 'idle' || state.state === 'checking') return null;

  // 「最新です」トースト: 手動チェック時のみ表示
  if (state.state === 'up-to-date') {
    if (state.silent) return null;
    return (
      <div className="update-toast">
        <RefreshIcon size={16} />
        <span>最新バージョンです</span>
        <button className="update-toast-close" onClick={onDismiss} aria-label="閉じる">
          <CloseIcon size={14} />
        </button>
      </div>
    );
  }

  // エラー時: silentならトースト、それ以外はモーダル
  if (state.state === 'error') {
    if (state.silent) {
      // サイレントエラー（起動時チェック失敗）はコンソールにだけ出し、UI非表示
      return null;
    }
    return (
      <div className="modal-overlay" onClick={onDismiss}>
        <div className="modal-content update-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>
              <DownloadIcon size={18} />
              アップデート
            </h2>
          </div>
          <div className="modal-body">
            <p className="update-error-message">
              確認またはインストールに失敗しました:
              <br />
              <span className="update-error-detail">{state.error ?? '不明なエラー'}</span>
            </p>
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onDismiss}>
              閉じる
            </button>
          </div>
        </div>
      </div>
    );
  }

  // available / downloading / installing / done
  const version = state.info?.version ?? '';
  const progressPercent =
    state.contentLength > 0
      ? Math.min(100, Math.round((state.downloaded / state.contentLength) * 100))
      : 0;

  const allowClose = state.state === 'available';

  return (
    <div className="modal-overlay" onClick={allowClose ? onDismiss : undefined}>
      <div className="modal-content update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <DownloadIcon size={18} />
            アップデート
          </h2>
        </div>
        <div className="modal-body update-modal-body">
          {state.state === 'available' && (
            <div className="update-headline">
              新しいバージョン <strong>v{version}</strong> が利用可能です
            </div>
          )}

          {state.state === 'downloading' && (
            <>
              <div className="update-status-row">
                <div className="update-spinner-icon">
                  <RefreshIcon size={32} />
                </div>
                <div>
                  <div className="update-headline">アップデートをダウンロード中…</div>
                  <div className="update-progress-meta">
                    {formatBytes(state.downloaded)} / {formatBytes(state.contentLength)}
                  </div>
                </div>
              </div>
              <div className="update-progress-bar">
                <div
                  className="update-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </>
          )}

          {state.state === 'installing' && (
            <div className="update-status-row">
              <div className="update-spinner-icon">
                <RefreshIcon size={32} />
              </div>
              <div>
                <div className="update-headline">インストール中…</div>
                <div className="update-progress-meta">しばらくお待ちください</div>
              </div>
            </div>
          )}

          {state.state === 'done' && (
            <div className="update-status-row">
              <div className="update-done-icon">✓</div>
              <div>
                <div className="update-headline">インストール完了</div>
                <div className="update-progress-meta">アプリを再起動します…</div>
              </div>
            </div>
          )}
        </div>
        {state.state === 'available' && (
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onDismiss}>
              後で
            </button>
            <button className="btn-primary" onClick={onInstall}>
              <DownloadIcon size={16} />
              アップデート
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
