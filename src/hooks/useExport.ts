import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Chapter, Page } from '../types';
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

function isAutoZeroBlurColorMode(colorMode?: string): boolean {
  return colorMode === 'RGB' || colorMode === 'CMYK';
}

// BleedRegion + グローバル設定 → Rust ProcessOptions (camelCase JSON)
export function buildProcessOptions(
  region: BleedRegion | null,
  options: {
    resizeMode: string;
    resizePercent: number;
    jpgQuality: number;
    // ぼかし（任意・PDF経路など未指定でも可）
    jpegBlurEnabled?: boolean;
    jpegBlurRadius?: number;
    jpegBlurBackgroundOnly?: boolean;
    colorMode?: string;
  }
) {
  // ぼかし半径: アクション/JSON由来(region.blurRadius)を優先、無ければ手動設定(jpegBlur*)。
  const regionBlur = region?.blurRadius ?? 0;
  const manualBlur = options.jpegBlurEnabled ? (options.jpegBlurRadius ?? 0) : 0;
  const effBlur = isAutoZeroBlurColorMode(options.colorMode)
    ? 0
    : (regionBlur > 0 ? regionBlur : manualBlur);
  const applyBlur = effBlur > 0;
  const blurFields = {
    applyBlur,
    blurRadius: applyBlur ? effBlur : 0,
    // テキスト保護（背景のみ）。region由来は既定で背景のみ、手動時は設定値に従う。
    blurBackgroundOnly: regionBlur > 0 ? true : !!options.jpegBlurBackgroundOnly,
    blurSkipIfColor: false,
  };
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
      ...blurFields,
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
    ...blurFields,
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

function sanitizeOutputNamePart(name: string): string {
  return (name.trim() || 'chapter').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '');
}

function isTiffFileType(fileType?: string): boolean {
  return fileType === 'tif' || fileType === 'tiff';
}

function removeTiffExtension(fileName: string): string {
  return fileName.replace(/\.tiff?$/i, '');
}

function makeUniqueFileName(fileName: string, usedNames: Set<string>): string {
  const dotIndex = fileName.lastIndexOf('.');
  const stem = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : '';
  let candidate = fileName;
  let counter = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem}_${counter}${ext}`;
    counter += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function buildChapterTiffFileName(
  chapterName: string,
  rawBaseName: string,
  usedNames: Set<string>
): string {
  const chapterPrefix = sanitizeOutputNamePart(chapterName);
  return makeUniqueFileName(`${chapterPrefix}_${rawBaseName}.tif`, usedNames);
}

export function useExport(chapters: Chapter[], allPages: AllPageItem[]) {
  const [exportResultDialog, setExportResultDialog] = useState<ExportResultDialog>({ show: false, title: '', message: '' });

  const handleExport = useCallback(async (options: ExportOptions) => {
    const { outputPath, exportMode, convertToJpg, jpgQuality, convertToTiff, renameTiffAndSave, renameMode, startNumber, digits, prefix, perChapterSettings, bleedSettings, runAction, actionSetPath, actionName, stripActionSaveClose, tiffResizeEnabled, tiffTargetWidth, tiffTargetHeight, tiffBlurEnabled, tiffBlurRadius, tiffBlurBackgroundOnly } = options;

    // TIFF変換モードの場合
    if (convertToTiff) {
      if (!renameTiffAndSave) {
        setExportResultDialog({
          show: true,
          title: 'TIFF変換エラー',
          message: '「リネームして保存」にチェックを入れてください。',
          isError: true,
        });
        return;
      }

      // PSD・JPEGファイルを抽出（Photoshopで開いてTIFFに変換）
      // EPUB_maker連携用にページ情報も保持
      const convertibleTypes = ['psd', 'jpg', 'jpeg'];
      const convertiblePages: { path: string; outputName: string; pageType: string; chapterType: string; chapterId: string; chapterName?: string; label?: string; colorMode?: string }[] = [];
      const usedTiffOutputNames = new Set<string>();

      if (renameMode === 'unified') {
        allPages.forEach((item, index) => {
          if (item.page.fileType && convertibleTypes.includes(item.page.fileType) && item.page.filePath) {
            convertiblePages.push({
              path: item.page.filePath,
              outputName: makeUniqueFileName(`${prefix}${String(startNumber + index).padStart(digits, '0')}.tif`, usedTiffOutputNames),
              pageType: item.page.pageType,
              chapterType: item.chapter.type,
              chapterId: item.chapter.id,
              chapterName: item.chapter.name,
              label: item.page.label,
              colorMode: item.page.imageColorMode,
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
                outputName: buildChapterTiffFileName(
                  chapter.name,
                  `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}`,
                  usedTiffOutputNames
                ),
                pageType: page.pageType,
                chapterType: chapter.type,
                chapterId: chapter.id,
                chapterName: chapter.name,
                label: page.label,
                colorMode: page.imageColorMode,
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
        // 断ち切りタブ(アクション/JSON)由来のぼかしを各ページに適用するための実効ぼかし半径。
        // カラー原稿(RGB/CMYK)はぼかし0。グレースケール原稿はPhotoshopがグレースケール・600ppiを維持して
        // 背景ガウスぼかしを適用する。region由来を優先し、無ければ手動(tiffBlur)設定。
        const effTiffBlurFor = (p: { chapterType: string; chapterId: string; colorMode?: string }) => {
          if (p.colorMode === 'RGB' || p.colorMode === 'CMYK') return 0; // カラーはぼかし0
          const region = resolveBleedRegion(bleedSettings, p.chapterType, p.chapterId);
          const regionBlur = region?.blurRadius ?? 0;
          return regionBlur > 0 ? regionBlur : (useTiffBlur ? tiffBlurRadius : 0);
        };
        const anyTiffBlur = convertiblePages.some((p) => effTiffBlurFor(p) > 0);
        const config = {
          globalSettings: {
            flattenImage: true,
            // ぼかし「背景のみ」: テキスト/背景を分離して背景だけぼかす（テキストはシャープ維持）。
            // 手動ぼかし(背景のみ) もしくは 断ち切りタブ由来のぼかしがあるとき有効化。
            separateTextAndBackground: (useTiffBlur && tiffBlurBackgroundOnly) || anyTiffBlur,
            reorganizeText: (useTiffBlur && tiffBlurBackgroundOnly) || anyTiffBlur,
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
            // 「保存」「閉じる」を無効化した一時 .atn を読み込ませ、保存先をアプリの出力先に一本化
            stripActionSaveClose: stripActionSaveClose !== false,
          },
          files: convertiblePages.map(p => {
            // 断ち切りは範囲方式に統一（action-ratio も .atn から範囲を読み込んで範囲として扱う）
            const cropBounds = resolveTiffCropBounds(bleedSettings, p.chapterType, p.chapterId);
            // ぼかし: 断ち切りタブ由来(アクション/JSON)を優先。カラーは0。グレースケールは維持してぼかし。
            const effBlur = effTiffBlurFor(p);
            return {
              path: p.path,
              outputPath: outputPath,
              outputName: p.outputName,
              // ぼかし（背景ぼかし）。JSX step 9 が applyBlur/blurRadius を見て背景レイヤーに適用
              applyBlur: effBlur > 0,
              blurRadius: effBlur,
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
              const outputFileName = makeUniqueFileName(
                `${prefix}${String(startNumber + index).padStart(digits, '0')}.tif`,
                usedTiffOutputNames
              );
              nonConvertiblePages.push({
                source_path: item.page.filePath || null,
                output_name: removeTiffExtension(outputFileName),
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
                const outputFileName = buildChapterTiffFileName(
                  chapter.name,
                  `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}`,
                  usedTiffOutputNames
                );
                nonConvertiblePages.push({
                  source_path: page.filePath || null,
                  output_name: removeTiffExtension(outputFileName),
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
      const convertiblePages: { path: string; outputName: string; pageType: string; chapterType: string; chapterId: string; chapterName?: string; label?: string; colorMode?: string }[] = [];

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
              colorMode: item.page.imageColorMode,
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
                colorMode: page.imageColorMode,
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
              options: buildProcessOptions(region, { ...options, colorMode: p.colorMode }),
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
    const filePages = allPages.filter((item) => item.page.filePath && item.page.fileType);
    const shouldFlattenTiffCopy =
      renameMode === 'perChapter' &&
      filePages.length > 0 &&
      filePages.every((item) => isTiffFileType(item.page.fileType));
    const usedFlatTiffCopyNames = new Set<string>();

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
          const rawOutputName = `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}`;
          const outputName = shouldFlattenTiffCopy
            ? removeTiffExtension(buildChapterTiffFileName(chapter.name, rawOutputName, usedFlatTiffCopyNames))
            : rawOutputName;
          exportPages.push({
            source_path: page.filePath || null,
            output_name: outputName,
            page_type: page.pageType,
            subfolder: shouldFlattenTiffCopy ? undefined : chapter.name, // チャプター名をサブフォルダとして使用
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

  const closeExportResultDialog = useCallback(() => {
    setExportResultDialog({ show: false, title: '', message: '' });
  }, []);

  return {
    // State
    exportResultDialog,
    // Actions
    handleExport,
    setExportResultDialog,
    closeExportResultDialog,
  };
}
