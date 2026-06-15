import { useState, useEffect } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { desktopDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { Chapter, CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS } from '../../types';
import { ExportIcon, FolderIcon, CopyIcon, PencilIcon, ReplaceIcon } from '../../icons';
import { useModalAnimation } from '../../hooks';
import { useBleedStore } from '../../bleedStore';

// チャプターごとのリネーム設定
export interface ChapterRenameSettings {
  enabled: boolean;
  startNumber: number;
  startNumberText?: string;
  digits: number;
  digitsText?: string;
  prefix: string;
}

// 断ち切りマージン（TIFF=Photoshop経路用に残す）
export interface BleedMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// 断ち切り処理タイプ（Tachimi準拠の6モード）
export type TachikiriType =
  | 'none'
  | 'crop_only'
  | 'crop_and_stroke'
  | 'stroke_only'
  | 'fill_white'
  | 'fill_and_stroke';

// 線色・塗り色
export type BleedColor = 'black' | 'white' | 'cyan';

// 色名 → CSS色（Tachimi COLOR_MAP 準拠）
export const BLEED_COLOR_MAP: Record<BleedColor, string> = {
  black: '#000000',
  white: '#ffffff',
  cyan: '#00bfff',
};

// 断ち切り領域＋モード設定（Tachimi ProcessOptions 相当）
// 座標は設定時の元画像ピクセル座標（絶対座標）
export interface BleedRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
  refWidth: number;  // 設定時の元画像サイズ（スケール基準）
  refHeight: number;
  tachikiriType: TachikiriType;
  strokeColor: BleedColor;
  fillColor: BleedColor;
  fillOpacity: number; // 0-100
  // アクション/JSONから取り込んだぼかし半径(px)。0/未指定でぼかしなし。
  // カラー原稿は出力時に自動で0扱い（ネイティブ経路）。
  blurRadius?: number;
}

// BleedRegion → BleedMargins 変換（TIFF=Photoshopはクロップのみ対応）
export function regionToMargins(r: BleedRegion): BleedMargins {
  return {
    left: Math.max(0, r.left),
    top: Math.max(0, r.top),
    right: Math.max(0, r.refWidth - r.right),
    bottom: Math.max(0, r.refHeight - r.bottom),
  };
}

// 断ち切り設定
export interface BleedSettings {
  enabled: boolean;
  mode: 'bulk' | 'per-chapter';
  cover: BleedRegion;
  body: BleedRegion;
  perChapter?: Record<string, BleedRegion>;
}

// 断ち切りモード（UIで選択するモード）
export type BleedMode = 'bulk' | 'per-chapter';

// リサイズモード（Tachimi準拠）
export type ResizeMode = 'none' | 'percent' | 'fixed';

// エクスポート設定
export interface ExportOptions {
  outputPath: string;
  exportMode: 'copy' | 'move';  // コピーか移動か
  convertToJpg: boolean;  // JPEGに変換するか（Photoshop不要・Rust/MozJPEG）
  jpgQuality: number;  // MozJPEG品質（70-100）
  convertToTiff: boolean;  // PhotoshopでTIFFに変換するか
  renameTiffAndSave: boolean;  // TIFF変換時にリネームして保存するか
  resizeMode: ResizeMode;  // リサイズモード（none/percent/fixed）
  resizePercent: number;   // %指定時の倍率（1-100）
  renameMode: 'unified' | 'perChapter';
  // 一括設定
  startNumber: number;
  digits: number;
  prefix: string;
  // チャプターごとの設定
  perChapterSettings: Record<string, ChapterRenameSettings>;
  // 断ち切り設定
  bleedSettings?: BleedSettings;
  // 断ち切りモード（Photoshop変換時のみ使用）
  bleedMode: BleedMode;
  // 処理の最後に実行するPhotoshopアクション（TIFF変換時のみ・サイズ統一など）
  runAction: boolean;
  actionSetPath: string;  // 選択した .atn ファイルのフルパス（空なら読込済みセットを使用）
  actionName: string;
  // アクション内の「保存」「閉じる」を無効化してアプリの出力先に一本化するか
  stripActionSaveClose: boolean;
  // TIFF変換時のサイズ統一（指定ピクセルへ自動リサイズ）
  tiffResizeEnabled: boolean;
  tiffTargetWidth: number;
  tiffTargetHeight: number;
  // JPEG変換時のぼかし（ガウス・Photoshop不要のネイティブ処理）
  jpegBlurEnabled: boolean;
  jpegBlurRadius: number;
  jpegBlurBackgroundOnly: boolean; // true: PSDテキストレイヤーをマスクに文字をシャープ保持
}

// エクスポートモーダル
export function ExportModal({
  isOpen,
  onClose,
  onExport,
  chapters,
  embedded = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  chapters: Chapter[];
  embedded?: boolean;
}) {
  const [outputPath, setOutputPath] = useState('');
  const [exportMode, setExportMode] = useState<'copy' | 'move'>('copy');
  // 出力形式: そのままコピー(変換なし) / JPEG変換 / TIFF変換 の3択
  const [outputFormat, setOutputFormat] = useState<'copy' | 'jpg' | 'tiff'>('copy');
  const convertToJpg = outputFormat === 'jpg';
  const convertToTiff = outputFormat === 'tiff';
  const renameTiffAndSave = true; // リネーム設定は常時適用（旧「リネームして保存」チェックは廃止）
  const [jpgQuality, setJpgQuality] = useState(95);
  const [resizeMode, setResizeMode] = useState<ResizeMode>('none');
  const [resizePercent, setResizePercent] = useState(50);
  const [photoshopInstalled, setPhotoshopInstalled] = useState<boolean | null>(null);
  const [renameMode, setRenameMode] = useState<'unified' | 'perChapter'>('unified');
  const [startNumber, setStartNumber] = useState(1);
  const [startNumberText, setStartNumberText] = useState('1');
  const [digits, setDigits] = useState(4);
  const [digitsText, setDigitsText] = useState('4');
  const [prefix, setPrefix] = useState('');
  const [perChapterSettings, setPerChapterSettings] = useState<Record<string, ChapterRenameSettings>>({});
  // 断ち切りモード（一括/本文ごと）は「断ち切り」タブで管理。互換のため bulk 固定で渡す。
  const bleedMode: BleedMode = 'bulk';
  // 処理の最後に実行するPhotoshopアクション（サイズ統一など）。設定はlocalStorageに永続化。
  // アクションの .atn / アクション名は「断ち切り」タブの設定を参照する。
  const [runAction, setRunAction] = useState(false);
  const tabActionSetPath = useBleedStore((s) => s.actionSetPath);
  const tabActionName = useBleedStore((s) => s.actionName);
  // TIFF変換時のサイズ統一（指定ピクセルへリサイズ）
  const [tiffResizeEnabled, setTiffResizeEnabled] = useState(false);
  const [tiffWidthText, setTiffWidthText] = useState('1280');
  const [tiffHeightText, setTiffHeightText] = useState('1818');
  // TIFF変換時のぼかし（背景ぼかし）
  // JPEG変換時のぼかし（Photoshop不要のネイティブ・ガウス）
  const [jpegBlurEnabled, setJpegBlurEnabled] = useState(false);
  const [jpegBlurRadiusText, setJpegBlurRadiusText] = useState('2.5');
  const [jpegBlurBackgroundOnly, setJpegBlurBackgroundOnly] = useState(true);
  // アクションの「保存」「閉じる」を無効化してアプリの出力先に一本化（既定ON）
  const [stripActionSaveClose, setStripActionSaveClose] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // アクション設定をlocalStorageから復元
  useEffect(() => {
    if (!isOpen) return;
    try {
      const saved = localStorage.getItem('daidori_tiff_action');
      if (saved) {
        const obj = JSON.parse(saved);
        if (typeof obj.runAction === 'boolean') setRunAction(obj.runAction);
        if (typeof obj.tiffResizeEnabled === 'boolean') setTiffResizeEnabled(obj.tiffResizeEnabled);
        if (typeof obj.tiffWidthText === 'string') setTiffWidthText(obj.tiffWidthText);
        if (typeof obj.tiffHeightText === 'string') setTiffHeightText(obj.tiffHeightText);
        if (typeof obj.jpegBlurEnabled === 'boolean') setJpegBlurEnabled(obj.jpegBlurEnabled);
        if (typeof obj.jpegBlurRadiusText === 'string') setJpegBlurRadiusText(obj.jpegBlurRadiusText);
        if (typeof obj.jpegBlurBackgroundOnly === 'boolean') setJpegBlurBackgroundOnly(obj.jpegBlurBackgroundOnly);
        if (typeof obj.stripActionSaveClose === 'boolean') setStripActionSaveClose(obj.stripActionSaveClose);
      }
    } catch {
      // 破損データは無視
    }
  }, [isOpen]);

  // 初期化：デフォルトの出力パスを設定
  useEffect(() => {
    const initDefaultPath = async () => {
      try {
        const desktop = await desktopDir();
        const defaultPath = await join(desktop, 'Script_Output', '台割TIF');
        setOutputPath(defaultPath);
      } catch (e) {
        console.error('Failed to get desktop path:', e);
      }
    };
    if (isOpen && !outputPath) {
      initDefaultPath();
    }
  }, [isOpen, outputPath]);

  // Photoshopインストールチェック
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const checkPhotoshop = async () => {
      setPhotoshopInstalled(null);
      try {
        const installed = await invoke<boolean>('check_photoshop_installed');
        if (!cancelled) {
          setPhotoshopInstalled(installed);
        }
      } catch (e) {
        console.error('Failed to check Photoshop:', e);
        if (!cancelled) {
          setPhotoshopInstalled(false);
        }
      }
    };
    checkPhotoshop();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // PSD・JPEGファイルがあるかチェック（TIFF変換対象）
  const hasTiffConvertibleFiles = chapters.some(chapter =>
    chapter.pages.some(page => page.fileType === 'psd' || page.fileType === 'jpg' || page.fileType === 'jpeg')
  );

  // 画像ファイルページがあるか（JPEG変換対象。Photoshop不要）
  const hasFilePages = chapters.some(chapter =>
    chapter.pages.some(page => !!page.filePath && !!page.fileType)
  );

  // チャプターごとの設定を初期化
  useEffect(() => {
    const newSettings: Record<string, ChapterRenameSettings> = {};
    chapters.forEach((chapter) => {
      if (!perChapterSettings[chapter.id]) {
        newSettings[chapter.id] = { enabled: true, startNumber: 1, startNumberText: '1', digits: 4, digitsText: '4', prefix: '' };
      } else {
        const existing = perChapterSettings[chapter.id];
        newSettings[chapter.id] = {
          ...existing,
          startNumberText: existing.startNumberText ?? String(existing.startNumber),
          digitsText: existing.digitsText ?? String(existing.digits),
        };
      }
    });
    if (Object.keys(newSettings).length > 0) {
      setPerChapterSettings((prev) => ({ ...prev, ...newSettings }));
    }
  }, [chapters]);

  // 変換系（JPEG/TIFF）では原本のコピー/移動は成立しないため、コピー固定に戻す
  useEffect(() => {
    if (outputFormat !== 'copy') setExportMode('copy');
  }, [outputFormat]);

  const handleSelectFolder = async () => {
    const selected = await save({
      title: '出力先を選択',
      defaultPath: outputPath || 'export',
    });
    if (selected) {
      setOutputPath(selected);
    }
  };

  const handleExport = async () => {
    if (!outputPath) return;
    // アクション設定を永続化（次回のために記憶）
    try {
      localStorage.setItem('daidori_tiff_action', JSON.stringify({ runAction, tiffResizeEnabled, tiffWidthText, tiffHeightText, jpegBlurEnabled, jpegBlurRadiusText, jpegBlurBackgroundOnly, stripActionSaveClose }));
    } catch {
      // 保存失敗は無視
    }
    const tiffTargetWidth = Math.max(0, parseInt(tiffWidthText, 10) || 0);
    const tiffTargetHeight = Math.max(0, parseInt(tiffHeightText, 10) || 0);
    const jpegBlurRadius = Math.max(0, parseFloat(jpegBlurRadiusText) || 0);
    setIsExporting(true);
    // アクションの .atn / アクション名は「断ち切り」タブの設定を参照する
    await onExport({ outputPath, exportMode, convertToJpg, jpgQuality, convertToTiff, renameTiffAndSave, resizeMode, resizePercent, renameMode, startNumber, digits, prefix, perChapterSettings, bleedMode, runAction, actionSetPath: tabActionSetPath, actionName: tabActionName.trim(), stripActionSaveClose, tiffResizeEnabled, tiffTargetWidth, tiffTargetHeight, jpegBlurEnabled, jpegBlurRadius, jpegBlurBackgroundOnly });
    setIsExporting(false);
    if (!embedded) onClose();
  };

  const updateChapterSetting = (chapterId: string, key: keyof ChapterRenameSettings, value: number | string | boolean) => {
    setPerChapterSettings((prev) => ({
      ...prev,
      [chapterId]: { ...prev[chapterId], [key]: value },
    }));
  };

  // プレビュー例
  const previewName1 = `${prefix}${String(startNumber).padStart(digits, '0')}.jpg`;
  const previewName2 = `${prefix}${String(startNumber + 1).padStart(digits, '0')}.jpg`;

  const { shouldRender, isClosing } = useModalAnimation(isOpen);
  if (!embedded && !shouldRender) return null;

  const inner = (
    <>
        {!embedded && (
          <div className="modal-header">
            <h2>
              <ExportIcon size={18} />
              エクスポート
            </h2>
          </div>
        )}
        <div className="modal-body">
          {/* 出力形式: 中サイズカードで選ぶ（全幅） */}
          <div className="form-group export-fullrow export-format-group">
            <label className="section-heading"><ExportIcon size={15} />出力形式</label>
            <div className="export-format-cards">
              <button
                type="button"
                className={`export-format-card ${outputFormat === 'copy' ? 'selected' : ''}`}
                onClick={() => setOutputFormat('copy')}
              >
                <span className="export-fmt-badge copy">原本</span>
                <span className="export-format-card-title">そのままコピー</span>
                <span className="export-format-card-sub">変換なし・形式を維持してリネーム</span>
              </button>
              <button
                type="button"
                className={`export-format-card ${outputFormat === 'jpg' ? 'selected' : ''} ${!hasFilePages ? 'disabled' : ''}`}
                disabled={!hasFilePages}
                onClick={() => setOutputFormat('jpg')}
              >
                <span className="export-fmt-badge jpg">JPG</span>
                <span className="export-format-card-title">JPEGに変換</span>
                <span className="export-format-card-sub">MozJPEGで高画質変換</span>
              </button>
              <button
                type="button"
                className={`export-format-card ${outputFormat === 'tiff' ? 'selected' : ''} ${!hasTiffConvertibleFiles || !photoshopInstalled ? 'disabled' : ''}`}
                disabled={!hasTiffConvertibleFiles || !photoshopInstalled}
                onClick={() => setOutputFormat('tiff')}
              >
                <span className="export-fmt-badge tif">TIFF</span>
                <span className="export-format-card-title">TIFFに変換</span>
                <span className="export-format-card-sub">
                  {!photoshopInstalled && photoshopInstalled !== null
                    ? 'Photoshopが見つかりません'
                    : photoshopInstalled && !hasTiffConvertibleFiles
                      ? '変換可能なファイルがありません'
                      : 'LZW圧縮・レイヤー統合'}
                </span>
              </button>
            </div>
          </div>

          <div className="export-grid">
          <div className="export-col">
            {convertToJpg && (
              <div className="form-group">
                <div className="quality-slider">
                  <label>品質: {jpgQuality}%</label>
                  <input
                    type="range"
                    min="70"
                    max="100"
                    value={jpgQuality}
                    onChange={(e) => setJpgQuality(parseInt(e.target.value))}
                  />
                  <div className="quality-labels">
                    <span>小さめ</span>
                    <span>高画質</span>
                  </div>
                </div>
                <div className="resize-settings">
                  <label className="resize-label">リサイズ</label>
                  <select
                    className="select-full"
                    value={resizeMode}
                    onChange={(e) => setResizeMode(e.target.value as ResizeMode)}
                  >
                    <option value="none">なし（原寸）</option>
                    <option value="percent">%指定</option>
                    <option value="fixed">デフォルト（1280×1818）</option>
                  </select>
                  {resizeMode === 'percent' && (
                    <div className="resize-percent-row">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={resizePercent}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          setResizePercent(Number.isNaN(v) ? 1 : Math.min(100, Math.max(1, v)));
                        }}
                      />
                      <span>%</span>
                    </div>
                  )}
                </div>
                <label className="checkbox-label" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={jpegBlurEnabled}
                    onChange={(e) => setJpegBlurEnabled(e.target.checked)}
                  />
                  ぼかし（ガウス）を適用
                  <span className="option-note"> - Photoshop不要・アプリ内で実行</span>
                </label>
                {jpegBlurEnabled && (
                  <div className="action-settings">
                    <div className="form-group">
                      <label>ぼかし半径 (px)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={jpegBlurRadiusText}
                        onChange={(e) => setJpegBlurRadiusText(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="例: 2.5"
                      />
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={jpegBlurBackgroundOnly}
                        onChange={(e) => setJpegBlurBackgroundOnly(e.target.checked)}
                      />
                      テキストを保護（背景のみぼかす）
                      <span className="option-note"> - PSDのテキストレイヤー（#text#/写植 等）を検出し文字をシャープに保つ。フチや背景はぼけます</span>
                    </label>
                    <div className="tiff-note">
                      ※ ぼかしは原寸（断ち切り・リサイズ前）で適用されます。「テキストを保護」はPSDのみ有効で、検出できない場合は全体ぼかしになります。
                    </div>
                  </div>
                )}
              </div>
            )}

          {/* コピー/移動は「そのままコピー（変換なし）」のときだけ意味を持つ */}
          {outputFormat === 'copy' && (
            <div className="form-group">
              <label className="section-heading"><CopyIcon size={15} />出力方法</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="exportMode"
                    checked={exportMode === 'copy'}
                    onChange={() => setExportMode('copy')}
                  />
                  <span className="radio-ico"><CopyIcon size={16} /></span>
                  コピー
                  <span className="radio-description">元ファイルを残す</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="exportMode"
                    checked={exportMode === 'move'}
                    onChange={() => setExportMode('move')}
                  />
                  <span className="radio-ico"><ReplaceIcon size={16} /></span>
                  移動
                  <span className="radio-description">元ファイルを整理</span>
                </label>
              </div>
            </div>
          )}

          {/* TIFF変換オプション（0602由来: サイズ統一・背景ぼかし・Photoshopアクション実行） */}
          {convertToTiff && (
            <div className="form-group">
              <label className="section-heading">TIFF変換オプション</label>
              <div className="tiff-options">
                <div className="tiff-note">
                  ※ LZW圧縮、レイヤー統合で出力（カラーモードは元ファイルを維持）
                </div>
                <label className="checkbox-label" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={tiffResizeEnabled}
                    onChange={(e) => {
                      setTiffResizeEnabled(e.target.checked);
                      // サイズ統一とアクションは同時に使えない（アクションが保存・閉じるを行いアプリ処理を奪うため）
                      if (e.target.checked) setRunAction(false);
                    }}
                  />
                  サイズを統一（指定ピクセルに自動リサイズ＋自動保存）
                  <span className="option-note"> - 全ページを同じ寸法に揃えてアプリが自動保存（推奨）</span>
                </label>
                {tiffResizeEnabled && (
                  <div className="action-settings">
                    <div className="form-row">
                      <div className="form-group">
                        <label>幅 (px)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={tiffWidthText}
                          onChange={(e) => setTiffWidthText(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="例: 1280"
                        />
                      </div>
                      <div className="form-group">
                        <label>高さ (px)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={tiffHeightText}
                          onChange={(e) => setTiffHeightText(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="例: 1818"
                        />
                      </div>
                    </div>
                    <div className="tiff-note">
                      ※ 全ページを指定した幅×高さ(px)に拡大縮小して揃えます（縦横比が異なるページは指定寸法に合わせて変形します）。
                    </div>
                  </div>
                )}
                <label className={`checkbox-label ${tiffResizeEnabled ? 'disabled' : ''}`} style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={runAction && !tiffResizeEnabled}
                    disabled={tiffResizeEnabled}
                    onChange={(e) => {
                      setRunAction(e.target.checked);
                      if (e.target.checked) setTiffResizeEnabled(false);
                    }}
                  />
                  処理の途中でPhotoshopアクションを実行（任意）
                  <span className="option-note">
                    {tiffResizeEnabled
                      ? ' - 「サイズを統一」と同時には使えません（アクションが保存・閉じるを行いアプリの保存・リサイズを奪うため）'
                      : ' - ぼかし等の加工用。ただし保存・閉じるを含むアクションはアプリの自動保存と競合します'}
                  </span>
                </label>
                {runAction && (
                  <div className="action-settings">
                    <div className="form-group">
                      <label>実行するアクション（「断ち切り」タブで設定）</label>
                      {tabActionName ? (
                        <div className="tiff-note">
                          {tabActionName}{tabActionSetPath ? `（${tabActionSetPath.split(/[\\/]/).pop()}）` : ''}
                        </div>
                      ) : (
                        <div className="tiff-note" style={{ color: 'var(--color-error, #dc2626)' }}>
                          アクションが未選択です。「断ち切り」タブで方式を「アクション…」にして .atn とアクション名を選んでください。
                        </div>
                      )}
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={stripActionSaveClose}
                        onChange={(e) => setStripActionSaveClose(e.target.checked)}
                      />
                      アクションの「保存」「閉じる」を無視してアプリの出力先に保存（推奨）
                      <span className="option-note"> - .atnに焼き込まれた保存先（別PCのパス等）を使わず、上で指定した出力フォルダに一律で保存します</span>
                    </label>
                    <div className="tiff-note">
                      {stripActionSaveClose
                        ? '※ アクション内の「保存」「閉じる」を自動で無効化し、加工（ぼかし・切り抜き等）だけを実行します。保存・サイズ統一・TIFF化はアプリが行い、すべて上の出力フォルダに集約されます（.atnの元データは変更しません）。'
                        : '※ オフの場合、アクションに「保存」「閉じる」が含まれていると、.atnに焼き込まれた保存先へ保存され、保存ダイアログが出ることがあります。'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {(convertToTiff || convertToJpg) && (
            <div className="form-group">
              <div className="tiff-note">
                ※ 断ち切りは「断ち切り」タブで設定した内容（方式・範囲）が適用されます
              </div>
            </div>
          )}
          </div>

          <div className="export-col">
          <div className="form-section">
            <h3 className="section-heading"><PencilIcon size={15} />リネーム設定</h3>
            <div className="form-group">
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="renameMode"
                    checked={renameMode === 'unified'}
                    onChange={() => setRenameMode('unified')}
                  />
                  一括設定
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="renameMode"
                    checked={renameMode === 'perChapter'}
                    onChange={() => setRenameMode('perChapter')}
                  />
                  チャプターごとに設定
                </label>
              </div>
            </div>

            {renameMode === 'unified' ? (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>開始番号</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={startNumberText}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setStartNumberText(val);
                        if (val !== '') {
                          setStartNumber(parseInt(val, 10));
                        }
                      }}
                      onBlur={() => {
                        if (startNumberText === '') {
                          setStartNumber(0);
                          setStartNumberText('0');
                        }
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>桁数</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={digitsText}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setDigitsText(val);
                        if (val !== '') {
                          setDigits(Math.min(8, Math.max(1, parseInt(val, 10))));
                        }
                      }}
                      onBlur={() => {
                        if (digitsText === '') {
                          setDigits(1);
                          setDigitsText('1');
                        } else {
                          const clamped = Math.min(8, Math.max(1, parseInt(digitsText, 10)));
                          setDigits(clamped);
                          setDigitsText(String(clamped));
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>ファイル名（任意）</label>
                  <input
                    type="text"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="例: page_"
                  />
                </div>
                <div className="form-group">
                  <label>ファイル名プレビュー</label>
                  <div className="filename-preview">
                    {previewName1}, {previewName2}, ...
                  </div>
                </div>
              </>
            ) : (
              <div className="per-chapter-settings">
                {chapters.map((chapter) => {
                  const settings = perChapterSettings[chapter.id] || { enabled: true, startNumber: 1, startNumberText: '1', digits: 4, digitsText: '4', prefix: '' };
                  const isEnabled = settings.enabled !== false;
                  const startNumberTextVal = settings.startNumberText ?? String(settings.startNumber);
                  const digitsTextVal = settings.digitsText ?? String(settings.digits);
                  const chPreview1 = `${chapter.name}/${settings.prefix}${String(settings.startNumber).padStart(settings.digits, '0')}.jpg`;
                  const chPreview2 = `${settings.prefix}${String(settings.startNumber + 1).padStart(settings.digits, '0')}.jpg`;
                  return (
                    <div key={chapter.id} className={`chapter-rename-settings ${!isEnabled ? 'disabled' : ''}`}>
                      <div className="chapter-rename-header">
                        <label className="chapter-enable-checkbox">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => updateChapterSetting(chapter.id, 'enabled', e.target.checked)}
                          />
                        </label>
                        <span
                          className="chapter-type-badge"
                          style={{ backgroundColor: CHAPTER_TYPE_COLORS[chapter.type] }}
                        >
                          {CHAPTER_TYPE_LABELS[chapter.type]}
                        </span>
                        <span className="chapter-rename-name">{chapter.name}</span>
                        <span className="chapter-rename-count">({chapter.pages.length}P)</span>
                      </div>
                      {isEnabled && (
                        <>
                          <div className="chapter-rename-inputs">
                            <div className="form-group-inline">
                              <label>開始</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={startNumberTextVal}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9]/g, '');
                                  updateChapterSetting(chapter.id, 'startNumberText', val);
                                  if (val !== '') {
                                    updateChapterSetting(chapter.id, 'startNumber', parseInt(val, 10));
                                  }
                                }}
                                onBlur={() => {
                                  if (startNumberTextVal === '') {
                                    updateChapterSetting(chapter.id, 'startNumber', 0);
                                    updateChapterSetting(chapter.id, 'startNumberText', '0');
                                  }
                                }}
                              />
                            </div>
                            <div className="form-group-inline">
                              <label>桁</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={digitsTextVal}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9]/g, '');
                                  updateChapterSetting(chapter.id, 'digitsText', val);
                                  if (val !== '') {
                                    updateChapterSetting(chapter.id, 'digits', Math.min(8, Math.max(1, parseInt(val, 10))));
                                  }
                                }}
                                onBlur={() => {
                                  if (digitsTextVal === '') {
                                    updateChapterSetting(chapter.id, 'digits', 1);
                                    updateChapterSetting(chapter.id, 'digitsText', '1');
                                  } else {
                                    const clamped = Math.min(8, Math.max(1, parseInt(digitsTextVal, 10)));
                                    updateChapterSetting(chapter.id, 'digits', clamped);
                                    updateChapterSetting(chapter.id, 'digitsText', String(clamped));
                                  }
                                }}
                              />
                            </div>
                            <div className="form-group-inline prefix-input">
                              <label>接頭</label>
                              <input
                                type="text"
                                value={settings.prefix}
                                onChange={(e) => updateChapterSetting(chapter.id, 'prefix', e.target.value)}
                                placeholder="prefix_"
                              />
                            </div>
                          </div>
                          <div className="chapter-rename-preview">
                            → {chPreview1}, {chPreview2}, ...
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
          </div>
          {/* 出力先フォルダは最後（生成ボタンの直前）に */}
          <div className="form-group export-fullrow export-dest-row">
            <label className="section-heading"><FolderIcon size={15} />出力先フォルダ</label>
            <div className="input-with-button">
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="フォルダを選択..."
                readOnly
              />
              <button className="btn-secondary btn-small" onClick={handleSelectFolder}>
                参照
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          {!embedded && (
            <button className="btn-secondary btn-small" onClick={onClose}>
              キャンセル
            </button>
          )}
          <button
            className="btn-primary btn-small"
            onClick={handleExport}
            disabled={!outputPath || isExporting || !renameTiffAndSave}
          >
            {isExporting ? '生成中...' : '生成'}
          </button>
        </div>
    </>
  );

  if (embedded) {
    return <div className="export-modal export-modal-embedded">{inner}</div>;
  }

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={onClose}>
      <div className={`modal-content export-modal ${isClosing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        {inner}
      </div>
    </div>
  );
}
