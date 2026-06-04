import { useEffect, type ReactNode } from 'react';
import { useStore } from '../../store';
import { EpubSpreadPreview } from './EpubSpreadPreview';
import { NoPageIcon } from '../../icons';

interface EpubMakerViewProps {
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  isViewerMode?: boolean;
  onExitViewerMode?: () => void;
  isPageBarVisible?: boolean;
  bindingDirection?: 'rtl' | 'ltr';
  onReplaceFile?: (originalPageId: string) => void;
  topBar?: ReactNode;
}

export function EpubMakerView({
  zoom = 100,
  onZoomChange,
  isViewerMode = false,
  onExitViewerMode,
  isPageBarVisible = true,
  bindingDirection = 'rtl',
  onReplaceFile,
  topBar,
}: EpubMakerViewProps) {
  const {
    epubPages,
    epubCurrentSpread,
    epubSelectedPageId,
    epubSelectedPageIds,
    setEpubCurrentSpread,
    setEpubSelectedPageId,
    toggleEpubPageSelection,
    selectEpubPageRange,
  } = useStore();

  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.preview-area')) {
        event.preventDefault();
      }
    };

    document.addEventListener('contextmenu', preventNativeContextMenu, { capture: true });
    return () => document.removeEventListener('contextmenu', preventNativeContextMenu, { capture: true });
  }, []);

  // ページ選択（Ctrl/Shift対応・再選択で解除）
  const handleSelectPage = (pageId: string, e?: React.MouseEvent) => {
    if (e?.ctrlKey || e?.metaKey) {
      toggleEpubPageSelection(pageId);
      return;
    }
    if (e?.shiftKey && epubSelectedPageId) {
      selectEpubPageRange(epubSelectedPageId, pageId);
      return;
    }
    if (epubSelectedPageId === pageId && epubSelectedPageIds.length <= 1) {
      setEpubSelectedPageId(null);
      return;
    }
    setEpubSelectedPageId(pageId);
    // ページインデックス→スプレッドインデックスのマッピング（表紙単独スプレッド対応）
    const pageIndex = epubPages.findIndex(p => p.id === pageId);
    if (pageIndex < 0) return;
    let spreadIdx = 0;
    let i = 0;
    while (i < epubPages.length) {
      const current = epubPages[i];
      const spanCount = current.isCover ? 1 : (epubPages[i + 1] ? 2 : 1);
      if (i <= pageIndex && pageIndex < i + spanCount) {
        setEpubCurrentSpread(spreadIdx);
        return;
      }
      i += spanCount;
      spreadIdx++;
    }
  };

  // サムネイルバーからのスプレッド変更
  const handleSpreadChange = (index: number) => {
    setEpubCurrentSpread(index);
  };

  return (
    <div className="preview-area epub-mode-preview">
      {topBar}
      <div id="epub-split-preview-host" className="epub-split-preview-host" />
      {epubPages.length === 0 ? (
        <div className="spread-viewer-empty">
          <NoPageIcon size={48} />
          <p>ページがありません。チャプターを追加してください</p>
        </div>
      ) : (
        <>
          <EpubSpreadPreview
            pages={epubPages}
            currentSpread={epubCurrentSpread}
            selectedPageId={epubSelectedPageId}
            selectedPageIds={epubSelectedPageIds}
            onSpreadChange={handleSpreadChange}
            onSelectPage={handleSelectPage}
            onReplaceFile={onReplaceFile}
            zoom={zoom}
            onZoomChange={onZoomChange}
            isViewerMode={isViewerMode}
            onExitViewerMode={onExitViewerMode}
            isPageBarVisible={isPageBarVisible}
            bindingDirection={bindingDirection}
          />
        </>
      )}
    </div>
  );
}
