import { useState, useEffect, type ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import { useBleedStore } from '../../bleedStore';
import { ExportModal } from '../modals/ExportModal';
import { EpubMakerView, EpubWizard } from '../epub';
import type { ExportOptions } from '../modals/ExportModal';
import type { Chapter, EpubMetadata, EpubSplitSettings } from '../../types';
import { CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS } from '../../types';
import { ExportIcon, BookIcon, PdfIcon, NoPageIcon, ScissorsIcon } from '../../icons';

const TACHIKIRI_LABELS: Record<string, string> = {
  none: 'なし',
  crop_only: '切り抜き',
  crop_and_stroke: '切り抜き＋線',
  stroke_only: '線のみ',
  fill_white: '塗り',
  fill_and_stroke: '塗り＋線',
};

export type OutputTarget = 'image' | 'epub' | 'pdf';

interface OutputTabProps {
  chapters: Chapter[];
  projectName: string;
  // 画像出力（JPEG / TIFF / コピー&リネーム）。断ち切りは呼び出し側で bleedStore から注入する。
  onExportImages: (options: ExportOptions) => void | Promise<void>;
  // EPUB 生成（CMYK ガードは呼び出し側で適用）
  onGenerateEpub: (metadata: EpubMetadata, outputPath: string, splitSettings?: EpubSplitSettings) => void | Promise<void>;
  // PDF 生成（断ち切りは bleedStore から注入）
  onGeneratePdf: () => void | Promise<void>;
  // EPUB プレビュー操作
  zoom: number;
  onZoomChange: (zoom: number) => void;
  isViewerMode: boolean;
  onExitViewerMode: () => void;
  isPageBarVisible: boolean;
  bindingDirection: 'rtl' | 'ltr';
  onReplaceFile: (originalPageId: string) => void;
  onBindingChange: (d: 'rtl' | 'ltr') => void;
  onEnterViewerMode: () => void;
  onTogglePageBar: () => void;
  topBar?: ReactNode;
}

export function OutputTab({
  chapters,
  projectName,
  onExportImages,
  onGenerateEpub,
  onGeneratePdf,
  zoom,
  onZoomChange,
  isViewerMode,
  onExitViewerMode,
  isPageBarVisible,
  bindingDirection,
  onReplaceFile,
  onBindingChange,
  onEnterViewerMode,
  onTogglePageBar,
  topBar,
}: OutputTabProps) {
  const [target, setTarget] = useState<OutputTarget>('image');
  const [wizardOpen, setWizardOpen] = useState(false);
  const loadEpubFromDaidori = useStore((s) => s.loadEpubFromDaidori);
  const bleed = useBleedStore();

  const totalPages = chapters.reduce((sum, c) => sum + c.pages.length, 0);

  // 断ち切りタブで設定済みの内容を要約（出力前の確認用）
  const bleedSummary = (() => {
    const coverSet = bleed.coverRegion && bleed.coverRegion.tachikiriType !== 'none';
    if (bleed.mode === 'per-chapter') {
      const n = Object.values(bleed.perChapterRegions).filter((r) => r.tachikiriType !== 'none').length;
      const parts: string[] = [];
      if (coverSet) parts.push(`表紙=${TACHIKIRI_LABELS[bleed.coverRegion!.tachikiriType]}`);
      parts.push(n > 0 ? `本文 ${n}章を個別設定` : '本文 未設定');
      return { configured: coverSet || n > 0, scope: '本文ごと', text: parts.join(' / ') };
    }
    const bodySet = bleed.bodyRegion && bleed.bodyRegion.tachikiriType !== 'none';
    const parts: string[] = [];
    parts.push(`表紙=${coverSet ? TACHIKIRI_LABELS[bleed.coverRegion!.tachikiriType] : 'なし'}`);
    parts.push(`本文=${bodySet ? TACHIKIRI_LABELS[bleed.bodyRegion!.tachikiriType] : 'なし'}`);
    return { configured: !!(coverSet || bodySet), scope: '一括', text: parts.join(' / ') };
  })();

  // EPUB 行き先選択中は台割の変更に追従して再同期
  useEffect(() => {
    if (target === 'epub') {
      loadEpubFromDaidori();
    }
  }, [target, chapters, loadEpubFromDaidori]);

  const selectTarget = (t: OutputTarget) => {
    setTarget(t);
  };

  const targetCards: { value: OutputTarget; label: string; desc: string; icon: ReactNode }[] = [
    { value: 'image', label: 'JPG／TIFF', desc: 'JPEG / TIFF / コピー&リネーム', icon: <ExportIcon size={20} /> },
    { value: 'epub', label: 'EPUB', desc: '電子書籍（電書協／Hybrid 他）', icon: <BookIcon size={20} /> },
    { value: 'pdf', label: 'PDF', desc: 'まとめPDF（Tachimi連携）', icon: <PdfIcon size={20} /> },
  ];

  const targetBar = (
    <div className="output-target-bar">
      {targetCards.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`output-target-chip ${target === c.value ? 'active' : ''}`}
          onClick={() => selectTarget(c.value)}
        >
          {c.icon}
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );

  // 出力内容の要約バナー（中央上部）。ページ数・色構成・断ち切り適用を一目で確認できる。
  const summaryBanner = (
    <div className="output-summary-banner">
      <div className="output-summary-banner-row">
        <span className="output-summary-chip">
          {chapters.length} チャプター / {totalPages} ページ
        </span>
        <span className={`output-summary-chip output-summary-bleed ${bleedSummary.configured ? 'on' : ''}`}>
          <ScissorsIcon size={13} />
          断ち切り（{bleedSummary.scope}）: {bleedSummary.text}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {/* 中央: 行き先選択（固定行）＋ 行き先別の本体 */}
      <div className="output-center">
        {targetBar}
        {target === 'epub' ? (
          <>
            <EpubMakerView
              zoom={zoom}
              onZoomChange={onZoomChange}
              isViewerMode={isViewerMode}
              onExitViewerMode={onExitViewerMode}
              isPageBarVisible={isPageBarVisible}
              bindingDirection={bindingDirection}
              onReplaceFile={onReplaceFile}
              onBindingChange={onBindingChange}
              onEnterViewerMode={onEnterViewerMode}
              onTogglePageBar={onTogglePageBar}
              topBar={topBar}
            />
            <div className="output-epub-cta">
              <span className="output-epub-cta-text">
                プレビューで内容を確認したら、ガイドに沿って5ステップでEPUBを作成できます。
              </span>
              <button
                type="button"
                className="btn-primary output-epub-create"
                disabled={totalPages === 0}
                onClick={() => setWizardOpen(true)}
              >
                <BookIcon size={16} />
                EPUBを作成
              </button>
            </div>
          </>
        ) : (
          <>
          <div className={`preview-area output-settings-center ${target === 'pdf' ? 'output-pdf-mode' : ''}`}>
            <div className="output-topbar-row">
              <div className="output-topbar-summary">{topBar}</div>
              {totalPages > 0 && summaryBanner}
            </div>
            {totalPages === 0 ? (
              <div className="spread-viewer-empty">
                <NoPageIcon size={48} />
                <p>出力できるページがありません</p>
              </div>
            ) : target === 'image' ? (
              <div className="output-settings-body">
                <ExportModal
                  isOpen={true}
                  embedded
                  onClose={() => {}}
                  onExport={onExportImages}
                  chapters={chapters}
                />
              </div>
            ) : (
              // PDF: 全ページをチャプター順に並べたプレビュー（PDFは単ページを順に結合）
              <div className="output-pdf-preview">
                {(() => {
                  let pageNo = 0;
                  return chapters.map((ch) => (
                    <section key={ch.id} className="output-pdf-chapter">
                      <div className="output-pdf-chapter-head">
                        <span className="output-pdf-chapter-badge" style={{ backgroundColor: CHAPTER_TYPE_COLORS[ch.type] }}>
                          {CHAPTER_TYPE_LABELS[ch.type]}
                        </span>
                        <span className="output-pdf-chapter-name">{ch.name}</span>
                        <span className="output-pdf-chapter-count">{ch.pages.length}P</span>
                      </div>
                      <div className="output-pdf-thumbs">
                        {ch.pages.map((p) => {
                          pageNo += 1;
                          const src = p.thumbnailCachePath ? convertFileSrc(p.thumbnailCachePath) : null;
                          return (
                            <div key={p.id} className="output-pdf-thumb">
                              <div className="output-pdf-thumb-img">
                                {src ? <img src={src} alt="" loading="lazy" /> : <span className="ph">{p.pageType === 'blank' ? '白紙' : '—'}</span>}
                              </div>
                              <span className="output-pdf-thumb-no">{pageNo}</span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ));
                })()}
              </div>
            )}
          </div>
          {/* 青いPDF生成バー（プレビューとは別ブロックで区切る） */}
          {target === 'pdf' && totalPages > 0 && (
            <div className="output-pdf-bar">
              <span className="output-pdf-bar-note">
                全{totalPages}ページを1つのPDFに結合します（JPEG化 → サイズ統一 → 断ち切り → PDF化）。
              </span>
              <button
                type="button"
                className="btn-primary output-pdf-generate-lg"
                onClick={() => void onGeneratePdf()}
              >
                <PdfIcon size={18} />
                PDFを生成
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {/* EPUB作成ウィザード（モーダル） */}
      <EpubWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onGenerate={onGenerateEpub}
        chapters={chapters}
        projectName={projectName}
      />
    </>
  );
}
