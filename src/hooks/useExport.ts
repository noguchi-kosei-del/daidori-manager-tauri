import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Chapter, Page, ThumbnailResult } from '../types';
import type { ExportOptions, BleedMargins, BleedSettings } from '../components/modals/ExportModal';

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

export interface BleedQueueItem {
  kind: 'cover' | 'body' | 'chapter';
  chapterId?: string; // kind === 'chapter' のときに必須
  label: string;
  thumbnailPath: string;
  filePath: string;
}

interface BleedEditorState {
  pendingExportOptions: ExportOptions | null;
  mode: 'bulk' | 'per-chapter';
  queue: BleedQueueItem[];
  currentIndex: number; // -1 で未開始／完了
  coverMargins: BleedMargins | null;
  bodyMargins: BleedMargins | null;
  perChapterMargins: Record<string, BleedMargins>;
}

const INITIAL_BLEED_STATE: BleedEditorState = {
  pendingExportOptions: null,
  mode: 'bulk',
  queue: [],
  currentIndex: -1,
  coverMargins: null,
  bodyMargins: null,
  perChapterMargins: {},
};

const ZERO_MARGINS: BleedMargins = { top: 0, bottom: 0, left: 0, right: 0 };

// 完了時の bleedSettings を構築
function buildBleedSettings(state: BleedEditorState): BleedSettings | undefined {
  const { mode, coverMargins, bodyMargins, perChapterMargins } = state;
  const hasAny = coverMargins || bodyMargins || Object.keys(perChapterMargins).length > 0;
  if (!hasAny) return undefined;
  return {
    enabled: true,
    mode,
    cover: coverMargins ?? ZERO_MARGINS,
    body: bodyMargins ?? ZERO_MARGINS,
    perChapter: mode === 'per-chapter' ? perChapterMargins : undefined,
  };
}

// 断ち切り適用: chapterType/chapterId から該当マージンを取得
function resolveMargins(
  bleedSettings: BleedSettings | undefined,
  chapterType: string,
  chapterId: string
): BleedMargins | null {
  if (!bleedSettings?.enabled) return null;
  if (chapterType === 'cover') return bleedSettings.cover ?? null;
  if (bleedSettings.mode === 'per-chapter') {
    const perCh = bleedSettings.perChapter?.[chapterId];
    if (perCh) return perCh;
    // フォールバック: perChapter の先頭エントリ（= 先頭話の値）
    const values = bleedSettings.perChapter ? Object.values(bleedSettings.perChapter) : [];
    return values.length > 0 ? values[0] : null;
  }
  return bleedSettings.body ?? null;
}

export function useExport(chapters: Chapter[], allPages: AllPageItem[]) {
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [bleedEditorState, setBleedEditorState] = useState<BleedEditorState>(INITIAL_BLEED_STATE);
  const [exportResultDialog, setExportResultDialog] = useState<ExportResultDialog>({ show: false, title: '', message: '' });

  const handleExport = useCallback(async (options: ExportOptions) => {
    const { outputPath, exportMode, convertToJpg, jpgQuality, convertToTiff, renameMode, startNumber, digits, prefix, perChapterSettings, bleedSettings } = options;
    // JPEG指定でPSDが含まれる場合はPhotoshop経由で変換（旧 convertToJpgPhotoshop 相当）
    const hasPsdFiles = chapters.some(c => c.pages.some(p => p.fileType === 'psd'));
    const convertToJpgPhotoshop = convertToJpg && hasPsdFiles;

    // TIFF変換モードの場合
    if (convertToTiff) {
      // PSD・JPEGファイルを抽出（Photoshopで開いてTIFFに変換）
      // EPUB_maker連携用にページ情報も保持
      const convertibleTypes = ['psd', 'jpg'];
      const convertiblePages: { path: string; outputName: string; pageType: string; chapterType: string; chapterId: string; chapterName?: string; label?: string }[] = [];

      if (renameMode === 'unified') {
        allPages.forEach((item, index) => {
          if (item.page.fileType && convertibleTypes.includes(item.page.fileType) && item.page.filePath) {
            convertiblePages.push({
              path: item.page.filePath,
              outputName: `${prefix}${String(startNumber + index).padStart(digits, '0')}.tif`,
              pageType: item.page.pageType,
              chapterType: item.chapter.type,
              chapterId: item.chapter.id,
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
                chapterId: chapter.id,
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
          files: convertiblePages.map(p => {
            const margins = resolveMargins(bleedSettings, p.chapterType, p.chapterId);
            return {
              path: p.path,
              outputPath: outputPath,
              outputName: p.outputName,
              ...(margins && {
                cropBounds: {
                  ...margins,
                  isMargin: true,
                },
              }),
            };
          }),
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
              blankFormat: 'tif',
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
      const convertiblePages: { path: string; outputName: string; pageType: string; chapterType: string; chapterId: string; chapterName?: string; label?: string }[] = [];

      if (renameMode === 'unified') {
        allPages.forEach((item, index) => {
          if (item.page.fileType === 'psd' && item.page.filePath) {
            convertiblePages.push({
              path: item.page.filePath,
              outputName: `${prefix}${String(startNumber + index).padStart(digits, '0')}.jpg`,
              pageType: item.page.pageType,
              chapterType: item.chapter.type,
              chapterId: item.chapter.id,
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
                chapterId: chapter.id,
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
          files: convertiblePages.map(p => {
            const margins = resolveMargins(bleedSettings, p.chapterType, p.chapterId);
            return {
              path: p.path,
              outputPath: outputPath,
              outputName: p.outputName,
              ...(margins && {
                cropBounds: {
                  ...margins,
                  isMargin: true,
                },
              }),
            };
          }),
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
            // JPEGモード: PSDはPhotoshop経由、それ以外もRustでJPEG再エンコード
            // outputPath は Photoshopが書き出した response.outputDir と同一 → 全ファイルが同じフォルダに集約される
            await invoke<number>('export_pages', {
              outputPath: response.outputDir,
              pages: nonPsdPages,
              moveFiles: exportMode === 'move',
              convertToJpg: true,
              jpgQuality: jpgQuality ?? 100,
              blankFormat: 'jpg',
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

  // 指定PSDのサムネイルパスを確保（キャッシュ済みならそれを返し、なければ生成）
  const ensureThumbnail = useCallback(async (page: Page): Promise<string | null> => {
    if (!page.filePath) return null;
    if (page.thumbnailCachePath) return page.thumbnailCachePath;
    try {
      const result = await invoke<ThumbnailResult>('generate_thumbnail', {
        filePath: page.filePath,
        modifiedTime: page.modifiedTime ?? 0,
      });
      return result.cache_path;
    } catch (e) {
      console.error('ensureThumbnail failed:', e);
      return null;
    }
  }, []);

  // エクスポート前に断ち切り確認が必要か判定し、必要ならエディタを表示
  const handlePreExport = useCallback(async (options: ExportOptions) => {
    const { convertToTiff, convertToJpg, bleedMode } = options;
    // JPEG選択 + PSD含む = Photoshop経由のJPEG変換が走るので断ち切り設定が必要
    const hasPsdFiles = chapters.some(c => c.pages.some(p => p.fileType === 'psd'));
    const needsPhotoshop = convertToTiff || (convertToJpg && hasPsdFiles);

    // Photoshop変換が不要ならそのままエクスポート
    if (!needsPhotoshop) {
      handleExport(options);
      return;
    }

    // 各チャプターから先頭PSDページ（thumbnail有無問わず）を探す
    const findFirstPsd = (chapter: Chapter): Page | null => {
      for (const page of chapter.pages) {
        if (page.fileType === 'psd' && page.filePath) return page;
      }
      return null;
    };

    // キュー構築
    const queue: BleedQueueItem[] = [];

    // 表紙チャプターの先頭PSD
    for (const chapter of chapters) {
      if (chapter.type !== 'cover') continue;
      const psd = findFirstPsd(chapter);
      if (psd && psd.filePath) {
        const thumb = await ensureThumbnail(psd);
        if (thumb) {
          queue.push({ kind: 'cover', label: '表紙', thumbnailPath: thumb, filePath: psd.filePath });
          break;
        }
      }
    }

    if (bleedMode === 'per-chapter') {
      // 話(chapter)タイプのチャプターごとに先頭PSDを追加
      for (const chapter of chapters) {
        if (chapter.type !== 'chapter') continue;
        const psd = findFirstPsd(chapter);
        if (psd && psd.filePath) {
          const thumb = await ensureThumbnail(psd);
          if (thumb) {
            queue.push({
              kind: 'chapter',
              chapterId: chapter.id,
              label: chapter.name,
              thumbnailPath: thumb,
              filePath: psd.filePath,
            });
          }
        }
      }
    } else {
      // bulk モード: 本文PSD（cover以外の先頭PSD）を1件追加
      for (const chapter of chapters) {
        if (chapter.type === 'cover') continue;
        const psd = findFirstPsd(chapter);
        if (psd && psd.filePath) {
          const thumb = await ensureThumbnail(psd);
          if (thumb) {
            queue.push({ kind: 'body', label: '本文', thumbnailPath: thumb, filePath: psd.filePath });
            break;
          }
        }
      }
    }

    if (queue.length === 0) {
      // PSDなし → そのままエクスポート
      handleExport(options);
      return;
    }

    setBleedEditorState({
      pendingExportOptions: options,
      mode: bleedMode,
      queue,
      currentIndex: 0,
      coverMargins: null,
      bodyMargins: null,
      perChapterMargins: {},
    });
  }, [chapters, handleExport, ensureThumbnail]);

  // キュー次ステップ進行 or エクスポート実行
  const advanceOrFinish = useCallback((nextState: BleedEditorState) => {
    if (nextState.currentIndex >= nextState.queue.length) {
      // キュー終了 → エクスポート実行
      const opts = nextState.pendingExportOptions!;
      const bleedSettings = buildBleedSettings(nextState);
      setTimeout(() => handleExport({ ...opts, bleedSettings }), 0);
      return { ...INITIAL_BLEED_STATE };
    }
    return nextState;
  }, [handleExport]);

  // 断ち切りエディタ: 適用コールバック
  const handleBleedApply = useCallback((margins: BleedMargins) => {
    setBleedEditorState(state => {
      if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) return state;
      const item = state.queue[state.currentIndex];
      const next: BleedEditorState = { ...state };
      if (item.kind === 'cover') {
        next.coverMargins = margins;
      } else if (item.kind === 'body') {
        next.bodyMargins = margins;
      } else if (item.kind === 'chapter' && item.chapterId) {
        next.perChapterMargins = { ...state.perChapterMargins, [item.chapterId]: margins };
      }
      next.currentIndex = state.currentIndex + 1;
      return advanceOrFinish(next);
    });
  }, [advanceOrFinish]);

  // 断ち切りエディタ: スキップコールバック
  const handleBleedSkip = useCallback(() => {
    setBleedEditorState(state => {
      if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) return state;
      const next: BleedEditorState = { ...state, currentIndex: state.currentIndex + 1 };
      return advanceOrFinish(next);
    });
  }, [advanceOrFinish]);

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
