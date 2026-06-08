import { EyeIcon, EyeOffIcon } from '../../icons';
import { ViewerControls } from './ViewerControls';

// 見開きプレビュー（台割タブ）共通の浮動オーバーレイ。
// 親（.viewer-canvas）にマウスを乗せると右上に操作クラスタ、下部にページバー切替が出る。
interface ViewerOverlayProps {
  bindingDirection: 'rtl' | 'ltr';
  onBindingChange: (d: 'rtl' | 'ltr') => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onEnterViewerMode: () => void;
  canEnterViewerMode?: boolean;
  isPageBarVisible: boolean;
  onTogglePageBar: () => void;
  isViewerMode?: boolean;
}

export function ViewerOverlay({
  bindingDirection,
  onBindingChange,
  zoom,
  onZoomChange,
  onEnterViewerMode,
  canEnterViewerMode = true,
  isPageBarVisible,
  onTogglePageBar,
  isViewerMode = false,
}: ViewerOverlayProps) {
  if (isViewerMode) return null;

  return (
    <>
      <div className="viewer-overlay-cluster">
        <ViewerControls
          bindingDirection={bindingDirection}
          onBindingChange={onBindingChange}
          zoom={zoom}
          onZoomChange={onZoomChange}
          onEnterViewerMode={onEnterViewerMode}
          canEnterViewerMode={canEnterViewerMode}
        />
      </div>

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
    </>
  );
}
