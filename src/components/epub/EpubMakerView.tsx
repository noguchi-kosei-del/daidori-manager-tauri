import { useStore } from '../../store';
import { EpubSpreadPreview } from './EpubSpreadPreview';
import { EpubThumbnailBar } from './EpubThumbnailBar';

interface EpubMakerViewProps {
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  isViewerMode?: boolean;
  onExitViewerMode?: () => void;
  isPageBarVisible?: boolean;
}

export function EpubMakerView({
  zoom = 100,
  onZoomChange,
  isViewerMode = false,
  onExitViewerMode,
  isPageBarVisible = true,
}: EpubMakerViewProps) {
  const {
    epubPages,
    epubCurrentSpread,
    epubSelectedPageId,
    setEpubCurrentSpread,
    setEpubSelectedPageId,
  } = useStore();

  // ページ選択（再選択で解除）
  const handleSelectPage = (pageId: string) => {
    if (epubSelectedPageId === pageId) {
      setEpubSelectedPageId(null);
      return;
    }
    setEpubSelectedPageId(pageId);
    const pageIndex = epubPages.findIndex(p => p.id === pageId);
    if (pageIndex >= 0) {
      const spreadIndex = Math.floor(pageIndex / 2);
      setEpubCurrentSpread(spreadIndex);
    }
  };

  // サムネイルバーからのスプレッド変更
  const handleSpreadChange = (index: number) => {
    setEpubCurrentSpread(index);
  };

  return (
    <div className="preview-area">
      {epubPages.length === 0 ? (
        <div className="spread-viewer-empty">
          <p>ページがありません</p>
        </div>
      ) : (
        <>
          <EpubSpreadPreview
            pages={epubPages}
            currentSpread={epubCurrentSpread}
            selectedPageId={epubSelectedPageId}
            onSpreadChange={handleSpreadChange}
            onSelectPage={handleSelectPage}
            zoom={zoom}
            onZoomChange={onZoomChange}
            isViewerMode={isViewerMode}
            onExitViewerMode={onExitViewerMode}
            isPageBarVisible={isPageBarVisible}
          />
          {!isViewerMode && (
            <EpubThumbnailBar
              pages={epubPages}
              currentSpread={epubCurrentSpread}
              selectedPageId={epubSelectedPageId}
              onSelectPage={handleSelectPage}
              onSpreadChange={handleSpreadChange}
            />
          )}
        </>
      )}
    </div>
  );
}
