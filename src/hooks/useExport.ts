import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Chapter, Page } from '../types';
import type { ExportOptions, BleedMargins } from '../components/modals/ExportModal';

interface AllPageItem {
  page: Page;
  chapter: Chapter;
  globalIndex: number;
}

interface ExportResultDialog {
  show: boolean;
  title: string;
  message: string;
  details?: string;
  outputDir?: string;
  isError?: boolean;
  exportedPages?: { filename: string; pageType: string; chapterName?: string; label?: string }[];
}

interface BleedEditorState {
  pendingExportOptions: ExportOptions | null;
  coverPsd: { thumbnailPath: string; filePath: string } | null;
  bodyPsd: { thumbnailPath: string; filePath: string } | null;
  currentStep: 'cover' | 'body' | null;
  coverMargins: BleedMargins | null;
  bodyMargins: BleedMargins | null;
}

const INITIAL_BLEED_STATE: BleedEditorState = {
  pendingExportOptions: null,
  coverPsd: null,
  bodyPsd: null,
  currentStep: null,
  coverMargins: null,
  bodyMargins: null,
};

export function useExport(chapters: Chapter[], allPages: AllPageItem[]) {
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [bleedEditorState, setBleedEditorState] = useState<BleedEditorState>(INITIAL_BLEED_STATE);
  const [exportResultDialog, setExportResultDialog] = useState<ExportResultDialog>({ show: false, title: '', message: '' });

  const handleExport = useCallback(async (options: ExportOptions) => {
    const { outputPath, exportMode, convertToJpg, jpgQuality, convertToTiff, convertToJpgPhotoshop, renameMode, startNumber, digits, prefix, perChapterSettings, bleedSettings } = options;

    // TIFF変換モードの場合
    if (convertToTiff) {
      // PSD・JPEGファイルを抽出（Photoshopで開いてTIFFに変換）
      // EPUB_maker連携用にページ情報も保持
      const convertibleTypes = ['psd', 'jpg'];
      const convertiblePages: { path: string; outputName: string; pageType: string; chapterType: string; chapterName?: string; label?: string }[] = [];

      if (renameMode === 'unified') {
        allPages.forEach((item, index) => {
          if (item.page.fileType && convertibleTypes.includes(item.page.fileType) && item.page.filePath) {
            convertiblePages.push({
              path: item.page.filePath,
              outputName: `${prefix}${String(startNumber + index).padStart(digits, '0')}.tif`,
              pageType: item.page.pageType,
              chapterType: item.chapter.type,
              chapterName: item.chapter.name,
              label: item.page.label,
            });
          }
        });
      } else {
        for (const chapter of chapters) {
          const settings = perChapterSettings[chapter.id] || { enabled: true, startNumber: 1, digits: 4, prefix: '' };
          if (settings.enabled === false) continue;
          chapter.pages.forEach((page, pageIndex) => {
            if (page.fileType && convertibleTypes.includes(page.fileType) && page.filePath) {
              convertiblePages.push({
                path: page.filePath,
                outputName: `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}.tif`,
                pageType: page.pageType,
                chapterType: chapter.type,
                chapterName: chapter.name,
                label: page.label,
              });
            }
          });
        }
      }

      if (convertiblePages.length === 0) {
        alert('変換可能なファイル（PSD・JPEG）がありません');
        return;
      }

      try {
        const config = {
          globalSettings: {
            flattenImage: true,
          },
          files: convertiblePages.map(p => ({
            path: p.path,
            outputPath: outputPath,
            outputName: p.outputName,
            ...(bleedSettings?.enabled && {
              cropBounds: {
                ...(p.chapterType === 'cover' ? bleedSettings.cover : bleedSettings.body),
                isMargin: true,
              },
            }),
          })),
        };

        console.log('TIFF変換開始:', { config, outputDir: outputPath });
        const response = await invoke<{ results: { fileName: string; success: boolean; colorMode?: string; error?: string }[]; outputDir: string; jpgOutputDir?: string }>('run_photoshop_tiff_convert', {
          config,
          outputDir: outputPath,
          jpgOutputDir: null,
        });
        console.log('TIFF変換完了:', response);

        const successResults = response.results.filter(r => r.success);
        const errorResults = response.results.filter(r => !r.success);

        let details = '';
        if (errorResults.length > 0) {
          details = errorResults.map(r => `${r.fileName}: ${r.error}`).join('\n');
          console.error('TIFF変換エラー:', details);
        }

        // EPUB_maker連携用のページ情報を生成
        const exportedPages = convertiblePages.map(p => ({
          filename: p.outputName,
          pageType: p.pageType,
          chapterName: p.chapterName,
          label: p.label,
        }));

        // TIFF変換対象外のファイル（白紙、PNGなど）も同じ出力先にエクスポート
        const nonConvertiblePages: { source_path: string | null; output_name: string; page_type: string }[] = [];

        if (renameMode === 'unified') {
          allPages.forEach((item, index) => {
            if (!item.page.fileType || !convertibleTypes.includes(item.page.fileType)) {
              nonConvertiblePages.push({
                source_path: item.page.filePath || null,
                output_name: `${prefix}${String(startNumber + index).padStart(digits, '0')}`,
                page_type: item.page.pageType,
              });
            }
          });
        } else {
          for (const chapter of chapters) {
            const settings = perChapterSettings[chapter.id] || { enabled: true, startNumber: 1, digits: 4, prefix: '' };
            if (settings.enabled === false) continue;
            chapter.pages.forEach((page, pageIndex) => {
              if (!page.fileType || !convertibleTypes.includes(page.fileType)) {
                nonConvertiblePages.push({
                  source_path: page.filePath || null,
                  output_name: `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}`,
                  page_type: page.pageType,
                });
              }
            });
          }
        }

        if (nonConvertiblePages.length > 0) {
          try {
            await invoke<number>('export_pages', {
              outputPath: response.outputDir,
              pages: nonConvertiblePages,
              moveFiles: exportMode === 'move',
              convertToJpg: false,
              jpgQuality: 100,
            });
          } catch (e) {
            console.error('非変換対象ページのエクスポートエラー:', e);
          }
        }

        const totalPages = successResults.length + nonConvertiblePages.length;
        const message = `${totalPages}ページのエクスポートが完了しました`;

        setExportResultDialog({
          show: true,
          title: errorResults.length > 0 ? 'エクスポート完了（一部エラー）' : 'エクスポート完了',
          message,
          details: errorResults.length > 0 ? `エラー: ${errorResults.length}件\n${details}` : undefined,
          outputDir: response.outputDir,
          isError: errorResults.length > 0,
          exportedPages,
        });
      } catch (error) {
        setExportResultDialog({
          show: true,
          title: 'TIFF変換エラー',
          message: String(error),
          isError: true,
        });
      }
      return;
    }

    // PhotoshopでJPEG変換モードの場合
    if (convertToJpgPhotoshop) {
      // PSDファイルを抽出（Photoshopで開いてJPEGに変換）
      // EPUB_maker連携用にページ情報も保持
      const convertiblePages: { path: string; outputName: string; pageType: string; chapterType: string; chapterName?: string; label?: string }[] = [];

      if (renameMode === 'unified') {
        allPages.forEach((item, index) => {
          if (item.page.fileType === 'psd' && item.page.filePath) {
            convertiblePages.push({
              path: item.page.filePath,
              outputName: `${prefix}${String(startNumber + index).padStart(digits, '0')}.jpg`,
              pageType: item.page.pageType,
              chapterType: item.chapter.type,
              chapterName: item.chapter.name,
              label: item.page.label,
            });
          }
        });
      } else {
        for (const chapter of chapters) {
          const settings = perChapterSettings[chapter.id] || { enabled: true, startNumber: 1, digits: 4, prefix: '' };
          if (settings.enabled === false) continue;
          chapter.pages.forEach((page, pageIndex) => {
            if (page.fileType === 'psd' && page.filePath) {
              convertiblePages.push({
                path: page.filePath,
                outputName: `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}.jpg`,
                pageType: page.pageType,
                chapterType: chapter.type,
                chapterName: chapter.name,
                label: page.label,
              });
            }
          });
        }
      }

      if (convertiblePages.length === 0) {
        alert('変換可能なファイル（PSD）がありません');
        return;
      }

      try {
        const config = {
          globalSettings: {
            jpgQuality: 12,  // 最高品質
          },
          files: convertiblePages.map(p => ({
            path: p.path,
            outputPath: outputPath,
            outputName: p.outputName,
            ...(bleedSettings?.enabled && {
              cropBounds: {
                ...(p.chapterType === 'cover' ? bleedSettings.cover : bleedSettings.body),
                isMargin: true,
              },
            }),
          })),
        };

        console.log('JPEG変換開始:', { config, outputDir: outputPath });
        const response = await invoke<{ results: { fileName: string; success: boolean; error?: string }[]; outputDir: string }>('run_photoshop_jpeg_convert', {
          config,
          outputDir: outputPath,
        });
        console.log('JPEG変換完了:', response);

        const successResults = response.results.filter(r => r.success);
        const errorResults = response.results.filter(r => !r.success);

        let details = '';
        if (errorResults.length > 0) {
          details = errorResults.map(r => `${r.fileName}: ${r.error}`).join('\n');
          console.error('JPEG変換エラー:', details);
        }

        // EPUB_maker連携用のページ情報を生成
        const exportedPages = convertiblePages.map(p => ({
          filename: p.outputName,
          pageType: p.pageType,
          chapterName: p.chapterName,
          label: p.label,
        }));

        // PSD以外のファイル（白紙、その他画像）も同じ出力先にエクスポート
        const nonPsdPages: { source_path: string | null; output_name: string; page_type: string }[] = [];

        if (renameMode === 'unified') {
          allPages.forEach((item, index) => {
            if (item.page.fileType !== 'psd') {
              nonPsdPages.push({
                source_path: item.page.filePath || null,
                output_name: `${prefix}${String(startNumber + index).padStart(digits, '0')}`,
                page_type: item.page.pageType,
              });
            }
          });
        } else {
          for (const chapter of chapters) {
            const settings = perChapterSettings[chapter.id] || { enabled: true, startNumber: 1, digits: 4, prefix: '' };
            if (settings.enabled === false) continue;
            chapter.pages.forEach((page, pageIndex) => {
              if (page.fileType !== 'psd') {
                nonPsdPages.push({
                  source_path: page.filePath || null,
                  output_name: `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}`,
                  page_type: page.pageType,
                });
              }
            });
          }
        }

        if (nonPsdPages.length > 0) {
          try {
            await invoke<number>('export_pages', {
              outputPath: response.outputDir,
              pages: nonPsdPages,
              moveFiles: exportMode === 'move',
              convertToJpg: false,
              jpgQuality: 100,
            });
          } catch (e) {
            console.error('非PSDページのエクスポートエラー:', e);
          }
        }

        const totalPages = successResults.length + nonPsdPages.length;
        const message = `${totalPages}ページのエクスポートが完了しました`;

        setExportResultDialog({
          show: true,
          title: errorResults.length > 0 ? 'エクスポート完了（一部エラー）' : 'エクスポート完了',
          message,
          details: errorResults.length > 0 ? `エラー: ${errorResults.length}件\n${details}` : undefined,
          outputDir: response.outputDir,
          isError: errorResults.length > 0,
          exportedPages,
        });
      } catch (error) {
        setExportResultDialog({
          show: true,
          title: 'JPEG変換エラー',
          message: String(error),
          isError: true,
        });
      }
      return;
    }

    // 通常のエクスポート処理
    // エクスポートページを生成（EPUB_maker連携用にchapterName, labelも保持）
    let exportPages: { source_path: string | null; output_name: string; page_type: string; subfolder?: string; chapter_name?: string; label?: string; file_type?: string }[] = [];

    if (renameMode === 'unified') {
      // 一括設定: 全ページを通し番号でリネーム
      exportPages = allPages.map((item, index) => ({
        source_path: item.page.filePath || null,
        output_name: `${prefix}${String(startNumber + index).padStart(digits, '0')}`,
        page_type: item.page.pageType,
        chapter_name: item.chapter.name,
        label: item.page.label,
        file_type: item.page.fileType,
      }));
    } else {
      // チャプターごとの設定: 各チャプター内で個別にリネーム、サブフォルダに出力
      for (const chapter of chapters) {
        const settings = perChapterSettings[chapter.id] || { enabled: true, startNumber: 1, digits: 4, prefix: '' };
        // 無効なチャプターはスキップ
        if (settings.enabled === false) continue;
        chapter.pages.forEach((page, pageIndex) => {
          exportPages.push({
            source_path: page.filePath || null,
            output_name: `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}`,
            page_type: page.pageType,
            subfolder: chapter.name, // チャプター名をサブフォルダとして使用
            chapter_name: chapter.name,
            label: page.label,
            file_type: page.fileType,
          });
        });
      }
    }

    try {
      const count = await invoke<number>('export_pages', {
        outputPath,
        pages: exportPages,
        moveFiles: exportMode === 'move',
        convertToJpg,
        jpgQuality,
      });

      const message = `${count}ページのエクスポートが完了しました`;

      // EPUB_maker連携用のページ情報を生成
      const exportedPages = exportPages.map((p) => {
        // 拡張子を決定: JPG変換時は.jpg、それ以外は元のファイルタイプ
        const ext = convertToJpg ? 'jpg' : (p.file_type || 'jpg');
        return {
          filename: `${p.output_name}.${ext}`,
          pageType: p.page_type,
          chapterName: p.chapter_name,
          label: p.label,
        };
      });

      setExportResultDialog({
        show: true,
        title: 'エクスポート完了',
        message,
        outputDir: outputPath,
        isError: false,
        exportedPages,
      });
    } catch (error) {
      setExportResultDialog({
        show: true,
        title: 'エクスポートエラー',
        message: String(error),
        isError: true,
      });
    }
  }, [chapters, allPages]);

  // エクスポート前に断ち切り確認が必要か判定し、必要ならエディタを表示
  const handlePreExport = useCallback((options: ExportOptions) => {
    const { convertToTiff, convertToJpgPhotoshop } = options;

    // Photoshop変換モードでPSDファイルがある場合、断ち切りエディタを表示
    if (convertToTiff || convertToJpgPhotoshop) {
      // 表紙チャプターのPSD
      let coverPsd: { thumbnailPath: string; filePath: string } | null = null;
      // 本文チャプターのPSD
      let bodyPsd: { thumbnailPath: string; filePath: string } | null = null;

      for (const chapter of chapters) {
        for (const page of chapter.pages) {
          if (page.fileType === 'psd' && page.filePath && page.thumbnailCachePath) {
            if (chapter.type === 'cover' && !coverPsd) {
              coverPsd = { thumbnailPath: page.thumbnailCachePath, filePath: page.filePath };
            } else if (chapter.type !== 'cover' && !bodyPsd) {
              bodyPsd = { thumbnailPath: page.thumbnailCachePath, filePath: page.filePath };
            }
          }
          if (coverPsd && bodyPsd) break;
        }
        if (coverPsd && bodyPsd) break;
      }

      if (coverPsd || bodyPsd) {
        // 断ち切りエディタを表示
        setBleedEditorState({
          pendingExportOptions: options,
          coverPsd,
          bodyPsd,
          currentStep: coverPsd ? 'cover' : 'body',
          coverMargins: null,
          bodyMargins: null,
        });
        return;
      }
    }

    // PSDなし or 通常エクスポート → そのまま実行
    handleExport(options);
  }, [chapters, handleExport]);

  // 断ち切りエディタ: 適用コールバック
  const handleBleedApply = useCallback((margins: BleedMargins) => {
    setBleedEditorState(state => {
      if (state.currentStep === 'cover') {
        if (state.bodyPsd) {
          // 表紙完了 → 本文PSDがあれば次へ
          return { ...state, coverMargins: margins, currentStep: 'body' as const };
        }
        // 本文なし → エクスポート実行
        const opts = state.pendingExportOptions!;
        const bleedSettings = { enabled: true, cover: margins, body: { top: 0, bottom: 0, left: 0, right: 0 } };
        // Schedule export outside setState
        setTimeout(() => handleExport({ ...opts, bleedSettings }), 0);
        return { ...state, coverMargins: margins, currentStep: null, pendingExportOptions: null };
      } else {
        // 本文完了 → エクスポート実行
        const opts = state.pendingExportOptions!;
        const coverMargins = state.coverMargins || { top: 0, bottom: 0, left: 0, right: 0 };
        const bleedSettings = { enabled: true, cover: coverMargins, body: margins };
        setTimeout(() => handleExport({ ...opts, bleedSettings }), 0);
        return { ...state, bodyMargins: margins, currentStep: null, pendingExportOptions: null };
      }
    });
  }, [handleExport]);

  // 断ち切りエディタ: スキップコールバック
  const handleBleedSkip = useCallback(() => {
    setBleedEditorState(state => {
      if (state.currentStep === 'cover') {
        if (state.bodyPsd) {
          // 表紙スキップ → 本文PSDがあれば次へ
          return { ...state, coverMargins: null, currentStep: 'body' as const };
        }
        // 本文なし → 断ち切りなしでエクスポート
        const opts = state.pendingExportOptions!;
        setTimeout(() => handleExport(opts), 0);
        return { ...state, currentStep: null, pendingExportOptions: null };
      } else {
        // 本文スキップ → エクスポート実行
        const opts = state.pendingExportOptions!;
        if (state.coverMargins) {
          const bleedSettings = { enabled: true, cover: state.coverMargins, body: { top: 0, bottom: 0, left: 0, right: 0 } };
          setTimeout(() => handleExport({ ...opts, bleedSettings }), 0);
        } else {
          setTimeout(() => handleExport(opts), 0);
        }
        return { ...state, bodyMargins: null, currentStep: null, pendingExportOptions: null };
      }
    });
  }, [handleExport]);

  // 断ち切りエディタ: キャンセル（エクスポート中止）
  const handleBleedCancel = useCallback(() => {
    setBleedEditorState(INITIAL_BLEED_STATE);
  }, []);

  const openExportModal = useCallback(() => {
    setIsExportModalOpen(true);
  }, []);

  const closeExportModal = useCallback(() => {
    setIsExportModalOpen(false);
  }, []);

  const closeExportResultDialog = useCallback(() => {
    setExportResultDialog({ show: false, title: '', message: '' });
  }, []);

  return {
    // State
    isExportModalOpen,
    bleedEditorState,
    exportResultDialog,
    // Actions
    openExportModal,
    closeExportModal,
    handlePreExport,
    handleBleedApply,
    handleBleedSkip,
    handleBleedCancel,
    setExportResultDialog,
    closeExportResultDialog,
  };
}
