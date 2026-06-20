import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Chapter, Page } from '../types';
import type { ExportOptions, BleedRegion, BleedSettings } from '../components/modals/ExportModal';

interface AllPageItem {
  page: Page;
  chapter: Chapter;
  globalIndex: number;
}

export type KenbanBounds = { left: number; top: number; right: number; bottom: number };

// KENBAN（差分比較ツール）連携用ペイロード。
// JPEG/TIFF 生成成功時に「原稿(PSD)→出力」のペアと断ち切り範囲を保持し、
// 完了ダイアログの「KENBANで差分比較」ボタンから launch_kenban_diff へ渡す。
// 各ペアが自分のクロップ範囲(bounds)を持つ（ページ別bounds対応）。表紙と本文で範囲が違っても
// 各ページが自分の範囲で正しくトリミング比較される。
export interface KenbanHandoff {
  outputDir: string;
  pairs: { sourcePath: string; outputPath: string; bounds: KenbanBounds }[];
  // 代表範囲（後方互換: per-page 非対応の KENBAN でも selectionRanges として使う）
  bounds: KenbanBounds | null;
}

interface ExportResultDialog {
  show: boolean;
  title: string;
  message: string;
  details?: string;
  outputDir?: string;
  isError?: boolean;
  exportedPages?: { filename: string; pageType: string; chapterName?: string; label?: string }[];
  kenbanHandoff?: KenbanHandoff;
}

// 原稿が PSD/PSB か（KENBAN psd-tiff 比較は原稿=PSD が対象）
function isPsdSourcePath(path: string): boolean {
  return /\.(psd|psb)$/i.test(path);
}

// KENBAN（検版）の送信対象判定用に、ページ自身のチャプターへ「明示設定」された断ち切り範囲を返す。
// resolveBleedRegion と違い、本文ごとモードのフォールバック（未設定チャプターへ先頭話の設定を流用）は
// 行わない。これにより「断ち切りを設定したファイルのみ」を厳密に判定し、未設定チャプターのページは
// 検版へ送らない（出力処理側は従来どおり resolveBleedRegion を使い、全本文へ断ち切りを適用する）。
function explicitBleedRegion(
  bleedSettings: BleedSettings | undefined,
  chapterType: string,
  chapterId: string
): BleedRegion | null {
  if (!bleedSettings?.enabled) return null;
  if (chapterType === 'cover') return bleedSettings.cover ?? null;
  if (bleedSettings.mode === 'per-chapter') {
    // フォールバックしない: そのチャプターに明示設定された範囲のみ
    return bleedSettings.perChapter?.[chapterId] ?? null;
  }
  return bleedSettings.body ?? null;
}

// ページが属するチャプターの断ち切りが「クロップ系」(crop_only / crop_and_stroke) として
// 明示設定されているとき、そのクロップ範囲を返す。
// none / fill / stroke / 未設定（フォールバック含む）は null（＝検版に送らない）。
// KENBAN psd-tiff は cropBounds でPSDをトリミングして比較するため、クロップ系のみが対象。
function cropBoundsOf(
  bleedSettings: BleedSettings | undefined,
  chapterType: string,
  chapterId: string
): KenbanBounds | null {
  const region = explicitBleedRegion(bleedSettings, chapterType, chapterId);
  if (!region) return null;
  if (region.tachikiriType !== 'crop_only' && region.tachikiriType !== 'crop_and_stroke') return null;
  return {
    left: Math.max(0, Math.round(region.left)),
    top: Math.max(0, Math.round(region.top)),
    right: Math.max(0, Math.round(region.right)),
    bottom: Math.max(0, Math.round(region.bottom)),
  };
}

// 送るページ群のクロップ範囲から代表を1つ選ぶ（KENBAN は1範囲のみ受け付ける）。
// 最多数の範囲を採用。範囲が混在する場合、少数派ページはトリミングが厳密一致しない可能性がある。
function pickRepresentativeBounds(boundsList: KenbanBounds[]): KenbanBounds | null {
  const tally = new Map<string, { bounds: KenbanBounds; count: number }>();
  for (const b of boundsList) {
    const key = `${b.left},${b.top},${b.right},${b.bottom}`;
    const e = tally.get(key);
    if (e) e.count += 1;
    else tally.set(key, { bounds: b, count: 1 });
  }
  let rep: KenbanBounds | null = null;
  let max = 0;
  for (const e of tally.values()) {
    if (e.count > max) {
      max = e.count;
      rep = e.bounds;
    }
  }
  return rep;
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
  // JPEG「デフォルト(fixed)」リサイズの目標寸法（格納サイズ 1280×1818）に揃える。
  // fixed のときのみ Rust 側が resizeTargetW/H を参照（none/percent では無視）。
  const fixedResize =
    options.resizeMode === 'fixed' ? { resizeTargetW: 1280, resizeTargetH: 1818 } : {};
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
      ...fixedResize,
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
    ...fixedResize,
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

  // JPEG生成（run_native_jpeg_convert）の進捗。直接JPEGエクスポート中のみ表示する。
  // 同じ jpeg-convert-progress イベントは PDF生成/EPUB生成の内部変換でも発火するため、
  // activeRef で「直接JPEGエクスポート中」に限定して取りこぼし/誤表示を防ぐ。
  const [jpegProgress, setJpegProgress] = useState<{ current: number; total: number } | null>(null);
  const jpegProgressActiveRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;
    listen<{ phase: string; current: number; total: number }>('jpeg-convert-progress', (event) => {
      if (!mounted || !jpegProgressActiveRef.current) return;
      const { phase, current, total } = event.payload;
      setJpegProgress({ current: phase === 'done' ? total : current, total });
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn();
    }).catch((err) => console.warn('[useExport] JPEG progress listener failed:', err));
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const handleExport = useCallback(async (options: ExportOptions) => {
    const { outputPath, exportMode, convertToJpg, jpgQuality, convertToTiff, renameTiffAndSave, renameMode, startNumber, digits, prefix, perChapterSettings, bleedSettings, runAction, actionSetPath, actionName, stripActionSaveClose, tiffResizeEnabled, tiffTargetWidth, tiffTargetHeight } = options;

    // 分割: 出力順ページの範囲ごとにサブフォルダ(01,02…)へ分ける（全形式共通）。
    const sortedSplitRanges = [...(options.splitRanges ?? [])].sort((a, b) => a.startIndex - b.startIndex);
    const folderForIndex = (idx: number): string => {
      const ri = sortedSplitRanges.findIndex((r) => idx >= r.startIndex && idx <= r.endIndex);
      return ri >= 0 ? String(ri + 1).padStart(2, '0') : '';
    };
    const pageIndexById = new Map<string, number>();
    allPages.forEach((it, i) => pageIndexById.set(it.page.id, i));
    const folderForPageId = (id?: string): string => {
      if (!id) return '';
      const idx = pageIndexById.get(id);
      return idx === undefined ? '' : folderForIndex(idx);
    };
    const withFolder = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
    // 「分割しないもの（全体）」も同時に作成する（分割範囲があるときのみ意味を持つ）。
    const alsoWhole = !!options.splitAlsoWhole && sortedSplitRanges.length > 0;
    const WHOLE_FOLDER = '全体';
    const baseName = (n: string) => n.split('/').pop() || n;

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
      const convertiblePages: { path: string; outputName: string; pageType: string; chapterType: string; chapterId: string; chapterName?: string; label?: string; colorMode?: string; splitFolder?: string }[] = [];
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
              splitFolder: folderForIndex(index),
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
                splitFolder: folderForPageId(page.id),
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
        // 各ページの実効ぼかし半径は「断ち切りタブ(アクション/JSON)由来(region.blurRadius)」のみ。
        // カラー原稿(RGB/CMYK)はぼかし0。グレースケール原稿はPhotoshopが背景ガウスぼかしを適用する。
        // （旧: TIFFタブ独自のぼかし設定は断ち切りタブと重複のため撤去。）
        const effTiffBlurFor = (p: { chapterType: string; chapterId: string; colorMode?: string }) => {
          if (p.colorMode === 'RGB' || p.colorMode === 'CMYK') return 0; // カラーはぼかし0
          const region = resolveBleedRegion(bleedSettings, p.chapterType, p.chapterId);
          return region?.blurRadius ?? 0;
        };
        const anyTiffBlur = convertiblePages.some((p) => effTiffBlurFor(p) > 0);
        const config = {
          globalSettings: {
            flattenImage: true,
            // ぼかし「背景のみ」: テキスト/背景を分離して背景だけぼかす（テキストはシャープ維持）。
            // 断ち切りタブ由来のぼかしがあるとき有効化。
            separateTextAndBackground: anyTiffBlur,
            reorganizeText: anyTiffBlur,
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
          files: (alsoWhole
            ? [...convertiblePages, ...convertiblePages.map((p) => ({ ...p, splitFolder: WHOLE_FOLDER }))]
            : convertiblePages
          ).map(p => {
            // 断ち切りは範囲方式に統一（action-ratio も .atn から範囲を読み込んで範囲として扱う）
            const cropBounds = resolveTiffCropBounds(bleedSettings, p.chapterType, p.chapterId);
            // ぼかし: 断ち切りタブ由来(アクション/JSON)を優先。カラーは0。グレースケールは維持してぼかし。
            const effBlur = effTiffBlurFor(p);
            return {
              path: p.path,
              // 分割時は範囲ごとのサブフォルダへ（JSXがフォルダを作成）
              outputPath: p.splitFolder ? `${outputPath}/${p.splitFolder}` : outputPath,
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
        const nonConvertiblePages: { source_path: string | null; output_name: string; page_type: string; subfolder?: string }[] = [];

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
                subfolder: folderForIndex(index) || undefined,
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
                  subfolder: folderForPageId(page.id) || undefined,
                });
              }
            });
          }
        }

        if (nonConvertiblePages.length > 0) {
          try {
            await invoke<number>('export_pages', {
              outputPath: response.outputDir,
              pages: alsoWhole
                ? [...nonConvertiblePages, ...nonConvertiblePages.map((p) => ({ ...p, subfolder: WHOLE_FOLDER }))]
                : nonConvertiblePages,
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

        // KENBAN 連携: 原稿PSD → 出力TIFF のペアを収集。
        // 「断ち切り(クロップ)を設定したページのみ」送る（未設定ページは除外）。各ペアに自分のクロップ範囲を付与。
        // TIFF応答には outputPath が無いため、出力先＝response.outputDir(+分割サブフォルダ)+outputName で再構成する。
        const kenbanPairs: { sourcePath: string; outputPath: string; bounds: KenbanBounds }[] = [];
        for (const p of convertiblePages) {
          if (!isPsdSourcePath(p.path)) continue;
          const crop = cropBoundsOf(bleedSettings, p.chapterType, p.chapterId);
          if (!crop) continue; // 断ち切り(クロップ)未設定は送らない
          kenbanPairs.push({
            sourcePath: p.path,
            outputPath: `${response.outputDir}\\${p.splitFolder ? `${p.splitFolder}\\` : ''}${p.outputName}`,
            bounds: crop,
          });
        }
        const kenbanHandoff: KenbanHandoff | undefined =
          successResults.length > 0 && kenbanPairs.length > 0
            ? { outputDir: response.outputDir, pairs: kenbanPairs, bounds: pickRepresentativeBounds(kenbanPairs.map((p) => p.bounds)) }
            : undefined;

        setExportResultDialog({
          show: true,
          title: errorResults.length > 0 ? 'エクスポート完了（一部エラー）' : 'エクスポート完了',
          message,
          details: errorResults.length > 0 ? `エラー: ${errorResults.length}件\n${details}` : undefined,
          outputDir: response.outputDir,
          isError: errorResults.length > 0,
          exportedPages,
          kenbanHandoff,
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
              outputName: withFolder(folderForIndex(index), `${prefix}${String(startNumber + index).padStart(digits, '0')}.jpg`),
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
                outputName: withFolder(folderForPageId(page.id), `${settings.prefix}${String(settings.startNumber + pageIndex).padStart(settings.digits, '0')}.jpg`),
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
        const jpegFilesSource = alsoWhole
          ? [...convertiblePages, ...convertiblePages.map((p) => ({ ...p, outputName: `${WHOLE_FOLDER}/${baseName(p.outputName)}` }))]
          : convertiblePages;
        const config = {
          files: jpegFilesSource.map(p => {
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
        // 進捗バー表示を開始（jpeg-convert-progress を受け付ける）
        jpegProgressActiveRef.current = true;
        setJpegProgress({ current: 0, total: config.files.length });
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

        // EPUB_maker連携用のページ情報を生成（分割サブフォルダはファイル名から除く）
        const exportedPages = convertiblePages.map(p => ({
          filename: p.outputName.split('/').pop() || p.outputName,
          pageType: p.pageType,
          chapterName: p.chapterName,
          label: p.label,
        }));

        // 画像ファイルを持たないページ（白紙・特殊）も同じ出力先に生成
        const nonFilePages: { source_path: string | null; output_name: string; page_type: string; subfolder?: string }[] = [];

        if (renameMode === 'unified') {
          allPages.forEach((item, index) => {
            if (!(item.page.filePath && item.page.fileType)) {
              nonFilePages.push({
                source_path: item.page.filePath || null,
                output_name: `${prefix}${String(startNumber + index).padStart(digits, '0')}`,
                page_type: item.page.pageType,
                subfolder: folderForIndex(index) || undefined,
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
                  subfolder: folderForPageId(page.id) || undefined,
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
              pages: alsoWhole
                ? [...nonFilePages, ...nonFilePages.map((p) => ({ ...p, subfolder: WHOLE_FOLDER }))]
                : nonFilePages,
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

        // KENBAN 連携: 原稿PSD → 出力JPEG のペアを収集。
        // 「断ち切り(クロップ)を設定したページのみ」送る（未設定ページは除外）。各ペアに自分のクロップ範囲を付与。
        // results は入力順（convertiblePages 順）で outputPath を返すため index で対応付けできる。
        const kenbanPairs: { sourcePath: string; outputPath: string; bounds: KenbanBounds }[] = [];
        for (let i = 0; i < convertiblePages.length; i++) {
          const cp = convertiblePages[i];
          if (!isPsdSourcePath(cp.path)) continue;
          const crop = cropBoundsOf(bleedSettings, cp.chapterType, cp.chapterId);
          if (!crop) continue; // 断ち切り(クロップ)未設定は送らない
          const r = response.results[i];
          if (r && r.success && r.outputPath) {
            kenbanPairs.push({ sourcePath: cp.path, outputPath: r.outputPath, bounds: crop });
          }
        }
        const kenbanHandoff: KenbanHandoff | undefined =
          kenbanPairs.length > 0
            ? { outputDir: response.outputDir, pairs: kenbanPairs, bounds: pickRepresentativeBounds(kenbanPairs.map((p) => p.bounds)) }
            : undefined;

        setExportResultDialog({
          show: true,
          title: errorResults.length > 0 ? 'エクスポート完了（一部エラー）' : 'エクスポート完了',
          message,
          details: errorResults.length > 0 ? `エラー: ${errorResults.length}件\n${details}` : undefined,
          outputDir: response.outputDir,
          isError: errorResults.length > 0,
          exportedPages,
          kenbanHandoff,
        });
      } catch (error) {
        setExportResultDialog({
          show: true,
          title: 'JPEG変換エラー',
          message: String(error),
          isError: true,
        });
      } finally {
        // 進捗バーを閉じる（結果ダイアログと重ならないよう成功/失敗どちらでもクリア）
        jpegProgressActiveRef.current = false;
        setJpegProgress(null);
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
        subfolder: folderForIndex(index) || undefined,
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
            // 分割が有効ならその範囲フォルダを優先。なければ従来どおりチャプター名サブフォルダ。
            subfolder: folderForPageId(page.id) || (shouldFlattenTiffCopy ? undefined : chapter.name),
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
        pages: alsoWhole
          ? [...exportPages, ...exportPages.map((p) => ({ ...p, subfolder: WHOLE_FOLDER }))]
          : exportPages,
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
    jpegProgress,
    // Actions
    handleExport,
    setExportResultDialog,
    closeExportResultDialog,
  };
}
