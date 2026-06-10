import { EyeIcon, EyeOffIcon } from '../../icons';

// 見開きプレビュー（台割タブ）の浮動オーバーレイ。
// 親（.viewer-canvas）にマウスを乗せると下部にページバー切替が出る。
// （綴じ方向・ズーム・閲覧モードの操作クラスタは上部バー側へ移設したため、ここではページバー切替のみ）
interface ViewerOverlayProps {
  isPageBarVisible: boolean;
  onTogglePageBar: () => void;
  isViewerMode?: boolean;
}

export function ViewerOverlay({
  isPageBarVisible,
  onTogglePageBar,
  isViewerMode = false,
}: ViewerOverlayProps) {
  if (isViewerMode) return null;

  return (
    <div className="viewer-pagebar-hotzone">
      <button
        type="button"
        className="viewer-pagebar-toggle"
        onClick={onTogglePageBar}
        title={isPageBarVisible ? 'ページバーを隠す' : 'ページバーを表示'}
      >
        {isPageBarVisible ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
      </button>
    </div>
  );
}
