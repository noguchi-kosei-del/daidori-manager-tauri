import { useEffect, type ReactNode } from 'react';
import { useStore } from '../../store';
import { EpubSpreadPreview } from './EpubSpreadPreview';
import { NoPageIcon, EyeIcon, EyeOffIcon } from '../../icons';

interface EpubMakerViewProps {
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  isViewerMode?: boolean;
  onExitViewerMode?: () => void;
  isPageBarVisible?: boolean;
  bindingDirection?: 'rtl' | 'ltr';
  onReplaceFile?: (originalPageId: string) => void;
  topBar?: ReactNode;
  onTogglePageBar?: () => void;
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
  onTogglePageBar,
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
      {/* 色サマリ（JPG/TIFF・PDFと同じ自然な上部バー） */}
      {topBar}
      {/* ビューア操作（綴じ方向・ズーム・閲覧モード）は行き先バー右側へ移設 */}
      <div id="epub-split-preview-host" className="epub-split-preview-host" />
      {epubPages.length === 0 ? (
        <div className="spread-viewer-empty">
          <NoPageIcon size={48} />
          <p>ページがありません。チャプターを追加してください</p>
        </div>
      ) : (
        <div className="epub-canvas-inner viewer-canvas">
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
          {onTogglePageBar && !isViewerMode && (
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
          )}
        </div>
      )}
    </div>
  );
}
