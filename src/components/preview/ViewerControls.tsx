import {
  BindingRightIcon,
  BindingLeftIcon,
  ZoomInIcon,
  ZoomOutIcon,
  MonitorIcon,
} from '../../icons';

// 綴じ方向・ズーム・閲覧モードのボタン群（上部バー等に並べて使う）
interface ViewerControlsProps {
  bindingDirection: 'rtl' | 'ltr';
  onBindingChange: (d: 'rtl' | 'ltr') => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onEnterViewerMode: () => void;
  canEnterViewerMode?: boolean;
}

export function ViewerControls({
  bindingDirection,
  onBindingChange,
  zoom,
  onZoomChange,
  onEnterViewerMode,
  canEnterViewerMode = true,
}: ViewerControlsProps) {
  return (
    <div className="viewer-controls">
      <button
        type="button"
        className="viewer-overlay-btn"
        onClick={() => onBindingChange(bindingDirection === 'rtl' ? 'ltr' : 'rtl')}
        title={bindingDirection === 'rtl' ? '右開き（クリックで左開き）' : '左開き（クリックで右開き）'}
      >
        {bindingDirection === 'rtl' ? <BindingRightIcon size={16} /> : <BindingLeftIcon size={16} />}
      </button>
      <div className="viewer-overlay-zoom">
        <button
          type="button"
          className="viewer-overlay-btn"
          onClick={() => onZoomChange(Math.max(50, zoom - 10))}
          disabled={zoom <= 50}
          title="ズームアウト"
        >
          <ZoomOutIcon size={16} />
        </button>
        <span className="viewer-overlay-zoom-value">{zoom}%</span>
        <button
          type="button"
          className="viewer-overlay-btn"
          onClick={() => onZoomChange(Math.min(200, zoom + 10))}
          disabled={zoom >= 200}
          title="ズームイン"
        >
          <ZoomInIcon size={16} />
        </button>
      </div>
      <button
        type="button"
        className="viewer-overlay-btn"
        onClick={onEnterViewerMode}
        disabled={!canEnterViewerMode}
        title="閲覧モード (F1)"
      >
        <MonitorIcon size={16} />
      </button>
    </div>
  );
}
