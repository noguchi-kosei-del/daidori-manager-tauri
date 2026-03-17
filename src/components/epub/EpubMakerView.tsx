import { useState } from 'react';
import { useStore } from '../../store';
import { EpubMetadataPanel } from './EpubMetadataPanel';
import { EpubSpreadPreview } from './EpubSpreadPreview';
import { EpubThumbnailBar } from './EpubThumbnailBar';
import { EpubCssEditorModal } from './EpubCssEditorModal';
import { FolderIcon, BookIcon } from '../../icons';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { EpubPageInfo } from '../../types';

interface EpubMakerViewProps {
  onGenerateEpub: () => void;
}

export function EpubMakerView({ onGenerateEpub }: EpubMakerViewProps) {
  const {
    epubPages,
    epubMetadata,
    epubCurrentSpread,
    epubSelectedPageId,
    setEpubPages,
    setEpubCurrentSpread,
    setEpubSelectedPageId,
    setEpubImageFolder,
  } = useStore();

  const [isCssEditorOpen, setIsCssEditorOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 画像フォルダを読み込む
  const handleLoadFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        title: '画像フォルダを選択',
      });

      if (!selected) return;

      setIsLoading(true);
      setEpubImageFolder(selected);

      // フォルダ内の画像を取得
      const files = await invoke<Array<{
        path: string;
        name: string;
        size: number;
        modified_time: number;
        file_type: string;
      }>>('get_folder_contents', { path: selected });

      // EpubPageInfo形式に変換
      const pages: EpubPageInfo[] = files.map((file, index) => ({
        id: crypto.randomUUID(),
        filename: `p${String(index + 1).padStart(3, '0')}.jpg`,
        sourcePath: file.path,
        width: 0,
        height: 0,
        isCover: index === 0,
        isColophon: false,
        thumbnailStatus: 'pending',
      }));

      setEpubPages(pages);
    } catch (error) {
      console.error('フォルダ読み込みエラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ページ選択
  const handleSelectPage = (pageId: string) => {
    setEpubSelectedPageId(pageId);
    // 選択したページを含むスプレッドに移動
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
    <div className="epub-maker-view">
      {/* サイドバー: メタデータパネル */}
      <aside className={`epub-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <button
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? 'サイドバーを展開' : 'サイドバーを折り畳む'}
          >
            {isSidebarCollapsed ? '»' : '«'}
          </button>
        </div>
        {!isSidebarCollapsed && (
          <EpubMetadataPanel />
        )}
      </aside>

      {/* メインエリア */}
      <div className="epub-main-area">
        {/* ツールバー */}
        <div className="epub-toolbar">
          <button
            className="btn-secondary btn-small"
            onClick={handleLoadFolder}
            disabled={isLoading}
          >
            <FolderIcon size={14} />
            {isLoading ? '読み込み中...' : '画像を読み込む'}
          </button>

          <button
            className="btn-secondary btn-small"
            onClick={() => setIsCssEditorOpen(true)}
          >
            CSSエディタ
          </button>

          <div className="epub-toolbar-spacer" />

          <button
            className="btn-primary btn-small"
            onClick={onGenerateEpub}
            disabled={epubPages.length === 0 || !epubMetadata}
          >
            <BookIcon size={14} />
            EPUB生成
          </button>
        </div>

        {/* プレビューエリア */}
        {epubPages.length === 0 ? (
          <div className="epub-empty-state">
            <FolderIcon size={48} />
            <p>画像フォルダを読み込んでください</p>
            <button
              className="btn-primary"
              onClick={handleLoadFolder}
              disabled={isLoading}
            >
              フォルダを選択
            </button>
          </div>
        ) : (
          <>
            <EpubSpreadPreview
              pages={epubPages}
              currentSpread={epubCurrentSpread}
              selectedPageId={epubSelectedPageId}
              onSpreadChange={handleSpreadChange}
              onSelectPage={handleSelectPage}
            />
            <EpubThumbnailBar
              pages={epubPages}
              currentSpread={epubCurrentSpread}
              selectedPageId={epubSelectedPageId}
              onSelectPage={handleSelectPage}
              onSpreadChange={handleSpreadChange}
            />
          </>
        )}
      </div>

      {/* CSSエディタモーダル */}
      <EpubCssEditorModal
        isOpen={isCssEditorOpen}
        onClose={() => setIsCssEditorOpen(false)}
      />
    </div>
  );
}
