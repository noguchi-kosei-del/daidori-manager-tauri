import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Chapter, Page, ThumbnailResult } from '../types';
import type { ExportOptions, BleedRegion, BleedSettings } from '../components/modals/ExportModal';

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

// 断ち切りキューの完了後アクション: 通常エクスポート or TachimiPDF生成
type BleedPurpose = 'export' | 'tachimi';

interface BleedEditorState {
  purpose: BleedPurpose;
  pendingExportOptions: ExportOptions | null;
  mode: 'bulk' | 'per-chapter';
  queue: BleedQueueItem[];
  currentIndex: number; // -1 で未開始／完了
  coverRegion: BleedRegion | null;
  bodyRegion: BleedRegion | null;
  perChapterRegions: Record<string, BleedRegion>;
}

const INITIAL_BLEED_STATE: BleedEditorState = {
  purpose: 'export',
  pendingExportOptions: null,
  mode: 'bulk',
  queue: [],
  currentIndex: -1,
  coverRegion: null,
  bodyRegion: null,
  perChapterRegions: {},
};

const ZERO_REGION: BleedRegion = {
  left: 0, top: 0, right: 0, bottom: 0,
  refWidth: 0, refHeight: 0,
  tachikiriType: 'none',
  strokeColor: 'black',
  fillColor: 'white',
  fillOpacity: 50,
};

// 完了時の bleedSettings を構築
function buildBleedSettings(state: BleedEditorState): BleedSettings | undefined {
  const { mode, coverRegion, bodyRegion, perChapterRegions } = state;
  const hasAny = coverRegion || bodyRegion || Object.keys(perChapterRegions).length > 0;
  if (!hasAny) return undefined;
  return {
    enabled: true,
    mode,
    cover: coverRegion ?? ZERO_REGION,
    body: bodyRegion ?? ZERO_REGION,
    perChapter: mode === 'per-chapter' ? perChapterRegions : undefined,
  };
}

// 断ち切り適用: chapterType/chapterId から該当 BleedRegion を取得
export function resolveBleedRegion(
  bleedSettings: BleedSettings | undefined,
  chapterType: string,
  chapterId: string
): BleedRegion | null {
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

// BleedRegion + グローバル設定 → Rust ProcessOptions (camelCase JSON)
export function buildProcessOptions(
  region: BleedRegion | null,
  options: { resizeMode: string; resizePercent: number; jpgQuality: number }
) {
  if (!region || region.tachikiriType === 'none') {
    return {
      cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
      tachikiriType: 'none',
      strokeColor: region?.strokeColor ?? 'black',
      fillColor: region?.fillColor ?? 'white',
      fillOpacity: region?.fillOpacity ?? 50,
      referenceWidth: region?.refWidth ?? 0,
      referenceHeight: region?.refHeight ?? 0,
      resizeMode: options.resizeMode,
      resizePercent: options.resizePercent,
      jpegQuality: options.jpgQuality,
    };
  }
  return {
    cropLeft: Math.max(0, Math.round(region.left)),
    cropTop: Math.max(0, Math.round(region.top)),
    cropRight: Math.max(0, Math.round(region.right)),
    cropBottom: Math.max(0, Math.round(region.bottom)),
    tachikiriType: region.tachikiriType,
    strokeColor: region.strokeColor,
    fillColor: region.fillColor,
    fillOpacity: region.fillOpacity,
    referenceWidth: Math.round(region.refWidth),
    referenceHeight: Math.round(region.refHeight),
    resizeMode: options.resizeMode,
    resizePercent: options.resizePercent,
    jpegQuality: options.jpgQuality,
  };
}

// TIFF(Photoshop)経路用: BleedRegion → cropBounds。none/未設定は null。
// 参照ページの絶対座標(left/top/right/bottom)＋参照サイズ(refWidth/refHeight)を渡し、
// JSX側で各画像の実サイズに対する比率でスケーリングしてクロップする（ネイティブJPEG経路と同じ比率方式）。
// これによりサイズ違いのPSDでも断ち切り範囲が正しく揃う（旧マージン方式は固定pxで黒余白/見切れの原因だった）。
function resolveTiffCropBounds(
  bleedSettings: BleedSettings | undefined,
  chapterType: string,
  chapterId: string
) {
  const region = resolveBleedRegion(bleedSettings, chapterType, chapterId);
  if (!region || region.tachikiriType === 'none') return null;
  return {
    left: Math.max(0, Math.round(region.left)),
    top: Math.max(0, Math.round(region.top)),
    right: Math.max(0, Math.round(region.right)),
    bottom: Math.max(0, Math.round(region.bottom)),
    refWidth: Math.round(region.refWidth),
    refHeight: Math.round(region.refHeight),
    isProportional: true,
  };
}

export function useExport(chapters: Chapter[], allPages: AllPageItem[]) {
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [bleedEditorState, setBleedEditorState] = useState<BleedEditorState>(INITIAL_BLEED_STATE);
  const [exportResultDialog, setExportResultDialog] = useState<ExportResultDialog>({ show: false, title: '', message: '' });
  // TachimiPDF用: 断ち切りキュー完了時に呼ぶコールバック（bleedSettings を受け取る）
  const tachimiCompleteRef = useRef<((bleedSettings: BleedSettings | undefined) => void) | null>(null);

  const handleExport = useCallback(async (options: ExportOptions) => {
    const { outputPath, exportMode, convertToJpg, jpgQuality, convertToTiff, renameMode, startNumber, digits, prefix, perChapterSettings, bleedSettings, runAction, actionSetPath, actionName, tiffResizeEnabled, tiffTargetWidth, tiffTargetHeight, tiffBlurEnabled, tiffBlurRadius, tiffBlurBackgroundOnly } = options;

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
        const useTiffResize = !!(tiffResizeEnabled && tiffTargetWidth > 0 && tiffTargetHeight > 0);
        const useTiffBlur = !!(tiffBlurEnabled && tiffBlurRadius > 0);
        const config = {
          globalSettings: {
            flattenImage: true,
            // ぼかし「背景のみ」: テキスト/背景を分離して背景だけぼかす（テキストはシャープ維持）
            separateTextAndBackground: useTiffBlur && tiffBlurBackgroundOnly,
            reorganizeText: useTiffBlur && tiffBlurBackgroundOnly,
            // サイズ統一: 指定ピクセルへ自動リサイズ（JSX step 13 が targetWidth/targetHeight を見て実行）
            ...(useTiffResize ? { targetWidth: tiffTargetWidth, targetHeight: tiffTargetHeight } : {}),
            // 処理の途中で実行するPhotoshopアクション（ぼかし・切り抜き等の加工。リサイズより前に実行）
            // actionSetPath(.atnファイル) は Rust 側でセット名を解析して action_set に補完する
            // ★サイズ統一(useTiffResize)が有効なときはアクションを強制無効化する。
            //   アクションが保存・閉じるを行うとアプリのリサイズ・保存が全てスキップされるため
            //   （localStorageに runAction=true が残っていても確実に無効化）。
            runAction: !!(runAction && actionName) && !useTiffResize,
            actionSetPath: actionSetPath ?? '',
            actionName: actionName ?? '',
          },
          files: convertiblePages.map(p => {
            const cropBounds = resolveTiffCropBounds(bleedSettings, p.chapterType, p.chapterId);
            return {
              path: p.path,
              outputPath: outputPath,
              outputName: p.outputName,
              // ぼかし（背景ぼかし）。JSX step 9 が applyBlur/blurRadius を見て背景レイヤーに適用
              applyBlur: useTiffBlur,
              blurRadius: useTiffBlur ? tiffBlurRadius : 0,
              ...(cropBounds && { cropBounds }),
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

    // JPEG変換モード（Photoshop不要・Rust/MozJPEG、断ち切り・リサイズ適用）
    if (convertToJpg) {
      // 画像ファイルを持つ全ページを抽出（PSD/JPEG/PNG/TIFF 区別なし）
      // EPUB_maker連携用にページ情報も保持
      const convertiblePages: { path: string; outputName: string; pageType: string; chapterType: string; chapterId: string; chapterName?: string; label?: string }[] = [];

      if (renameMode === 'unified') {
        allPages.forEach((item, index) => {
          if (item.page.filePath && item.page.fileType) {
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
            if (page.filePath && page.fileType) {
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

      try {
        const config = {
          files: convertiblePages.map(p => {
            const region = resolveBleedRegion(bleedSettings, p.chapterType, p.chapterId);
            return {
              path: p.path,
              outputPath: outputPath,
              outputName: p.outputName,
              options: buildProcessOptions(region, options),
            };
          }),
        };

        console.log('ネイティブJPEG変換開始:', { fileCount: config.files.length, outputDir: outputPath });
        const response = await invoke<{ results: { fileName: string; success: boolean; outputPath?: string; error?: string }[]; outputDir: string }>('run_native_jpeg_convert', {
          config,
          outputDir: outputPath,
        });
        console.log('ネイティブJPEG変換完了:', response);

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

        // 画像ファイルを持たないページ（白紙・特殊）も同じ出力先に生成
        const nonFilePages: { source_path: string | null; output_name: string; page_type: string }[] = [];

        if (renameMode === 'unified') {
          allPages.forEach((item, index) => {
            if (!(item.page.filePath && item.page.fileType)) {
              nonFilePages.push({
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
              if (!(page.filePath && page.fileType)) {
                nonFilePages.push({
                  source_path: page.filePath || null,
                  output_name: `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}`,
                  page_type: page.pageType,
                });
              }
            });
          }
        }

        if (nonFilePages.length > 0) {
          try {
            // outputPath は Rustが書き出した response.outputDir と同一 → 全ファイルが同じフォルダに集約される
            await invoke<number>('export_pages', {
              outputPath: response.outputDir,
              pages: nonFilePages,
              moveFiles: exportMode === 'move',
              convertToJpg: true,
              jpgQuality: jpgQuality ?? 95,
              blankFormat: 'jpg',
            });
          } catch (e) {
            console.error('非ファイルページのエクスポートエラー:', e);
          }
        }

        const totalPages = successResults.length + nonFilePages.length;
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

  // 断ち切りキュー（cover/body or 本文ごと）を構築
  const buildBleedQueue = useCallback(async (bleedMode: 'bulk' | 'per-chapter'): Promise<BleedQueueItem[]> => {
    // 各チャプターから先頭の画像ファイルページを探す（PSD優先＝ガイド自動読込が効く）
    const findFirstFilePage = (chapter: Chapter): Page | null => {
      let firstFile: Page | null = null;
      for (const page of chapter.pages) {
        if (page.filePath && page.fileType) {
          if (page.fileType === 'psd') return page;
          if (!firstFile) firstFile = page;
        }
      }
      return firstFile;
    };

    const queue: BleedQueueItem[] = [];

    // 表紙チャプターの先頭ファイルページ
    for (const chapter of chapters) {
      if (chapter.type !== 'cover') continue;
      const fp = findFirstFilePage(chapter);
      if (fp && fp.filePath) {
        const thumb = await ensureThumbnail(fp);
        if (thumb) {
          queue.push({ kind: 'cover', label: '表紙', thumbnailPath: thumb, filePath: fp.filePath });
          break;
        }
      }
    }

    if (bleedMode === 'per-chapter') {
      // 本文(chapter)タイプのチャプターごとに先頭ファイルページを追加
      for (const chapter of chapters) {
        if (chapter.type !== 'chapter') continue;
        const fp = findFirstFilePage(chapter);
        if (fp && fp.filePath) {
          const thumb = await ensureThumbnail(fp);
          if (thumb) {
            queue.push({
              kind: 'chapter',
              chapterId: chapter.id,
              label: chapter.name,
              thumbnailPath: thumb,
              filePath: fp.filePath,
            });
          }
        }
      }
    } else {
      // bulk モード: 本文（cover以外の先頭ファイルページ）を1件追加
      for (const chapter of chapters) {
        if (chapter.type === 'cover') continue;
        const fp = findFirstFilePage(chapter);
        if (fp && fp.filePath) {
          const thumb = await ensureThumbnail(fp);
          if (thumb) {
            queue.push({ kind: 'body', label: '本文', thumbnailPath: thumb, filePath: fp.filePath });
            break;
          }
        }
      }
    }

    return queue;
  }, [chapters, ensureThumbnail]);

  // エクスポート前に断ち切り確認が必要か判定し、必要ならエディタを表示
  const handlePreExport = useCallback(async (options: ExportOptions) => {
    const { convertToTiff, convertToJpg, bleedMode } = options;
    // JPEG/TIFF いずれも断ち切りエディタを経由（JPEGはネイティブで断ち切り対応）
    const needsBleedEditor = convertToTiff || convertToJpg;

    // 変換しないならそのままエクスポート
    if (!needsBleedEditor) {
      handleExport(options);
      return;
    }

    const queue = await buildBleedQueue(bleedMode);

    if (queue.length === 0) {
      // 画像ファイルなし → そのままエクスポート
      handleExport(options);
      return;
    }

    tachimiCompleteRef.current = null;
    setBleedEditorState({
      purpose: 'export',
      pendingExportOptions: options,
      mode: bleedMode,
      queue,
      currentIndex: 0,
      coverRegion: null,
      bodyRegion: null,
      perChapterRegions: {},
    });
  }, [handleExport, buildBleedQueue]);

  // TachimiPDF生成前に断ち切りエディタを表示し、完了で onComplete(bleedSettings) を呼ぶ
  const startTachimiBleed = useCallback(async (
    bleedMode: 'bulk' | 'per-chapter',
    onComplete: (bleedSettings: BleedSettings | undefined) => void
  ) => {
    const queue = await buildBleedQueue(bleedMode);
    if (queue.length === 0) {
      // 画像ファイルなし → 断ち切りなしでそのまま続行
      onComplete(undefined);
      return;
    }
    tachimiCompleteRef.current = onComplete;
    setBleedEditorState({
      purpose: 'tachimi',
      pendingExportOptions: null,
      mode: bleedMode,
      queue,
      currentIndex: 0,
      coverRegion: null,
      bodyRegion: null,
      perChapterRegions: {},
    });
  }, [buildBleedQueue]);

  // キュー次ステップ進行 or 完了アクション実行（purpose で分岐）
  const advanceOrFinish = useCallback((nextState: BleedEditorState) => {
    if (nextState.currentIndex >= nextState.queue.length) {
      const bleedSettings = buildBleedSettings(nextState);
      if (nextState.purpose === 'tachimi') {
        const cb = tachimiCompleteRef.current;
        tachimiCompleteRef.current = null;
        if (cb) setTimeout(() => cb(bleedSettings), 0);
      } else {
        const opts = nextState.pendingExportOptions!;
        setTimeout(() => handleExport({ ...opts, bleedSettings }), 0);
      }
      return { ...INITIAL_BLEED_STATE };
    }
    return nextState;
  }, [handleExport]);

  // 断ち切りエディタ: 適用コールバック
  const handleBleedApply = useCallback((region: BleedRegion) => {
    setBleedEditorState(state => {
      if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) return state;
      const item = state.queue[state.currentIndex];
      const next: BleedEditorState = { ...state };
      if (item.kind === 'cover') {
        next.coverRegion = region;
      } else if (item.kind === 'body') {
        next.bodyRegion = region;
      } else if (item.kind === 'chapter' && item.chapterId) {
        next.perChapterRegions = { ...state.perChapterRegions, [item.chapterId]: region };
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

  // 断ち切りエディタ: キャンセル（エクスポート／PDF生成 中止）
  const handleBleedCancel = useCallback(() => {
    tachimiCompleteRef.current = null;
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
    startTachimiBleed,
    handleBleedApply,
    handleBleedSkip,
    handleBleedCancel,
    setExportResultDialog,
    closeExportResultDialog,
  };
}
