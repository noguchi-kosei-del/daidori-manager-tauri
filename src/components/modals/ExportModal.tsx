import { useState, useEffect } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { desktopDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { Chapter, CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS } from '../../types';
import { ExportIcon } from '../../icons';
import { useModalAnimation } from '../../hooks';

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
  // TIFF変換時のサイズ統一（指定ピクセルへ自動リサイズ）
  tiffResizeEnabled: boolean;
  tiffTargetWidth: number;
  tiffTargetHeight: number;
  // TIFF変換時のぼかし（ガウス）
  tiffBlurEnabled: boolean;
  tiffBlurRadius: number;
  tiffBlurBackgroundOnly: boolean; // true: テキスト/背景を分離し背景のみぼかす
}

// エクスポートモーダル
export function ExportModal({
  isOpen,
  onClose,
  onExport,
  chapters,
}: {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  chapters: Chapter[];
}) {
  const [outputPath, setOutputPath] = useState('');
  const [exportMode, setExportMode] = useState<'copy' | 'move'>('copy');
  const [convertToJpg, setConvertToJpg] = useState(false);
  const [jpgQuality, setJpgQuality] = useState(95);
  const [convertToTiff, setConvertToTiff] = useState(false);
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
  const [bleedMode, setBleedMode] = useState<BleedMode>('bulk');
  // 処理の最後に実行するPhotoshopアクション（サイズ統一など）。設定はlocalStorageに永続化
  const [runAction, setRunAction] = useState(false);
  const [actionSetPath, setActionSetPath] = useState('');
  const [actionName, setActionName] = useState('');
  const [atnActions, setAtnActions] = useState<string[]>([]); // .atn内のアクション名一覧
  const [atnSetName, setAtnSetName] = useState('');           // .atnのセット名（表示用）
  const [atnError, setAtnError] = useState('');               // .atn解析エラー
  // TIFF変換時のサイズ統一（指定ピクセルへリサイズ）
  const [tiffResizeEnabled, setTiffResizeEnabled] = useState(false);
  const [tiffWidthText, setTiffWidthText] = useState('2250');
  const [tiffHeightText, setTiffHeightText] = useState('3000');
  // TIFF変換時のぼかし（背景ぼかし）
  const [tiffBlurEnabled, setTiffBlurEnabled] = useState(false);
  const [tiffBlurRadiusText, setTiffBlurRadiusText] = useState('10');
  const [tiffBlurBackgroundOnly, setTiffBlurBackgroundOnly] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // アクション設定をlocalStorageから復元
  useEffect(() => {
    if (!isOpen) return;
    try {
      const saved = localStorage.getItem('daidori_tiff_action');
      if (saved) {
        const obj = JSON.parse(saved);
        if (typeof obj.runAction === 'boolean') setRunAction(obj.runAction);
        if (typeof obj.actionSetPath === 'string') setActionSetPath(obj.actionSetPath);
        if (typeof obj.actionName === 'string') setActionName(obj.actionName);
        if (typeof obj.tiffResizeEnabled === 'boolean') setTiffResizeEnabled(obj.tiffResizeEnabled);
        if (typeof obj.tiffWidthText === 'string') setTiffWidthText(obj.tiffWidthText);
        if (typeof obj.tiffHeightText === 'string') setTiffHeightText(obj.tiffHeightText);
        if (typeof obj.tiffBlurEnabled === 'boolean') setTiffBlurEnabled(obj.tiffBlurEnabled);
        if (typeof obj.tiffBlurRadiusText === 'string') setTiffBlurRadiusText(obj.tiffBlurRadiusText);
        if (typeof obj.tiffBlurBackgroundOnly === 'boolean') setTiffBlurBackgroundOnly(obj.tiffBlurBackgroundOnly);
      }
    } catch {
      // 破損データは無視
    }
  }, [isOpen]);

  // 選択した .atn からアクション名一覧を取得（ドロップダウン用）
  useEffect(() => {
    if (!actionSetPath) {
      setAtnActions([]);
      setAtnSetName('');
      setAtnError('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await invoke<{ setName: string | null; actions: string[] }>('read_atn_actions', { path: actionSetPath });
        if (cancelled) return;
        setAtnActions(info.actions ?? []);
        setAtnSetName(info.setName ?? '');
        setAtnError('');
        // 既存のアクション名が一覧に無ければ、1件だけのときは自動選択
        setActionName((prev) => {
          if (prev && (info.actions ?? []).includes(prev)) return prev;
          if ((info.actions ?? []).length === 1) return info.actions[0];
          return (info.actions ?? []).includes(prev) ? prev : '';
        });
      } catch (e) {
        if (cancelled) return;
        setAtnActions([]);
        setAtnSetName('');
        setAtnError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [actionSetPath]);

  // アクションセット(.atn)ファイルをエクスプローラーで選択
  const handleSelectActionSet = async () => {
    const selected = await open({
      title: 'Photoshopアクションセット(.atn)を選択',
      multiple: false,
      directory: false,
      filters: [{ name: 'Photoshopアクション', extensions: ['atn'] }],
    });
    if (typeof selected === 'string') {
      setActionSetPath(selected);
    }
  };

  // 初期化：デフォルトの出力パスを設定
  useEffect(() => {
    const initDefaultPath = async () => {
      try {
        const desktop = await desktopDir();
        const defaultPath = await join(desktop, 'Script_Output', '台割');
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
    const checkPhotoshop = async () => {
      try {
        const installed = await invoke<boolean>('check_photoshop_installed');
        setPhotoshopInstalled(installed);
      } catch (e) {
        console.error('Failed to check Photoshop:', e);
        setPhotoshopInstalled(false);
      }
    };
    if (isOpen && photoshopInstalled === null) {
      checkPhotoshop();
    }
  }, [isOpen, photoshopInstalled]);

  // PSD・JPEGファイルがあるかチェック（TIFF変換対象）
  const hasTiffConvertibleFiles = chapters.some(chapter =>
    chapter.pages.some(page => page.fileType === 'psd' || page.fileType === 'jpg')
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
      localStorage.setItem('daidori_tiff_action', JSON.stringify({ runAction, actionSetPath, actionName, tiffResizeEnabled, tiffWidthText, tiffHeightText, tiffBlurEnabled, tiffBlurRadiusText, tiffBlurBackgroundOnly }));
    } catch {
      // 保存失敗は無視
    }
    const tiffTargetWidth = Math.max(0, parseInt(tiffWidthText, 10) || 0);
    const tiffTargetHeight = Math.max(0, parseInt(tiffHeightText, 10) || 0);
    const tiffBlurRadius = Math.max(0, parseFloat(tiffBlurRadiusText) || 0);
    setIsExporting(true);
    await onExport({ outputPath, exportMode, convertToJpg, jpgQuality, convertToTiff, resizeMode, resizePercent, renameMode, startNumber, digits, prefix, perChapterSettings, bleedMode, runAction, actionSetPath, actionName: actionName.trim(), tiffResizeEnabled, tiffTargetWidth, tiffTargetHeight, tiffBlurEnabled, tiffBlurRadius, tiffBlurBackgroundOnly });
    setIsExporting(false);
    onClose();
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
  if (!shouldRender) return null;

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={onClose}>
      <div className={`modal-content export-modal ${isClosing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <ExportIcon size={18} />
            エクスポート
          </h2>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="section-heading">出力先フォルダ</label>
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

          <div className="form-group">
            <label className="section-heading">出力方法</label>
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === 'copy'}
                  onChange={() => setExportMode('copy')}
                />
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
                移動
                <span className="radio-description">元ファイルを整理</span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className={`checkbox-label ${!hasFilePages ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={convertToJpg}
                disabled={!hasFilePages}
                onChange={(e) => {
                  setConvertToJpg(e.target.checked);
                  if (e.target.checked) {
                    setConvertToTiff(false);
                  }
                }}
              />
              JPEGに変換（Photoshop不要）
              <span className="option-note">
                {' '}- PSD/JPEG/PNG/TIFF をMozJPEGで変換
              </span>
            </label>
            {convertToJpg && (
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
            )}
            {convertToJpg && (
              <div className="resize-settings">
                <label className="resize-label">リサイズ</label>
                <select
                  className="select-full"
                  value={resizeMode}
                  onChange={(e) => setResizeMode(e.target.value as ResizeMode)}
                >
                  <option value="none">なし（原寸）</option>
                  <option value="percent">%指定</option>
                  <option value="fixed">デフォルト（2250×3000）</option>
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
            )}
          </div>

          <div className="form-group">
            <label className={`checkbox-label ${!hasTiffConvertibleFiles || !photoshopInstalled ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={convertToTiff}
                disabled={!hasTiffConvertibleFiles || !photoshopInstalled}
                onChange={(e) => {
                  setConvertToTiff(e.target.checked);
                  if (e.target.checked) {
                    setConvertToJpg(false);
                  }
                }}
              />
              TIFFに変換（対応ファイル：PSD・JPEG）
              {!photoshopInstalled && photoshopInstalled !== null && (
                <span className="option-note"> - Photoshopが見つかりません</span>
              )}
              {photoshopInstalled && !hasTiffConvertibleFiles && (
                <span className="option-note"> - 変換可能なファイルがありません</span>
              )}
            </label>
            {convertToTiff && (
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
                          placeholder="例: 2250"
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
                          placeholder="例: 3000"
                        />
                      </div>
                    </div>
                    <div className="tiff-note">
                      ※ 全ページを指定した幅×高さ(px)に拡大縮小して揃えます（縦横比が異なるページは指定寸法に合わせて変形します）。
                    </div>
                  </div>
                )}
                <label className="checkbox-label" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={tiffBlurEnabled}
                    onChange={(e) => setTiffBlurEnabled(e.target.checked)}
                  />
                  ぼかし（ガウス）を適用
                  <span className="option-note"> - 背景をぼかす加工をアプリが自動実行</span>
                </label>
                {tiffBlurEnabled && (
                  <div className="action-settings">
                    <div className="form-group">
                      <label>ぼかし半径 (px)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={tiffBlurRadiusText}
                        onChange={(e) => setTiffBlurRadiusText(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="例: 10"
                      />
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={tiffBlurBackgroundOnly}
                        onChange={(e) => setTiffBlurBackgroundOnly(e.target.checked)}
                      />
                      テキストを保護（背景のみぼかす）
                      <span className="option-note"> - テキストグループ（#text#/写植 等）を分離して背景だけぼかす</span>
                    </label>
                    <div className="tiff-note">
                      ※ ぼかしは原寸（リサイズ前）で適用されます。半径はアクションで使っていた値に合わせて調整してください。
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
                      <label>アクションセット（.atnファイル）</label>
                      <div className="input-with-button">
                        <input
                          type="text"
                          value={actionSetPath}
                          placeholder="エクスプローラーで .atn を選択..."
                          readOnly
                        />
                        <button className="btn-secondary btn-small" onClick={handleSelectActionSet}>
                          参照
                        </button>
                      </div>
                    </div>
                    {atnSetName && (
                      <div className="tiff-note">セット名: {atnSetName}</div>
                    )}
                    <div className="form-group">
                      <label>アクション名</label>
                      {atnActions.length > 0 ? (
                        <select
                          className="select-full"
                          value={atnActions.includes(actionName) ? actionName : ''}
                          onChange={(e) => setActionName(e.target.value)}
                        >
                          <option value="">（アクションを選択してください）</option>
                          {atnActions.map((a) => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={actionName}
                          onChange={(e) => setActionName(e.target.value)}
                          placeholder="例: サイズ統一"
                        />
                      )}
                    </div>
                    {atnError && (
                      <div className="tiff-note" style={{ color: 'var(--color-error, #dc2626)' }}>
                        .atnの解析に失敗しました（手入力してください）: {atnError}
                      </div>
                    )}
                    <div className="tiff-note">
                      ※ 選択した .atn を処理開始時にPhotoshopへ読み込み、リサイズ前に各ページへ実行します。サイズ統一とTIFF保存はアプリが自動で行うため、<b>アクションには「保存」「閉じる」を含めないでください</b>（ぼかし・切り抜き等の加工のみ）。アクションが画像を閉じた場合はアプリ側の保存・リサイズはスキップされます。
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {(convertToTiff || convertToJpg) && (
            <div className="form-group">
              <label>断ち切り設定</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="bleedMode"
                    checked={bleedMode === 'bulk'}
                    onChange={() => setBleedMode('bulk')}
                  />
                  一括断ち切り
                  <span className="radio-description">表紙と本文で1回ずつ設定</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="bleedMode"
                    checked={bleedMode === 'per-chapter'}
                    onChange={() => setBleedMode('per-chapter')}
                  />
                  本文ごと
                  <span className="radio-description">各本文チャプターごとに個別設定</span>
                </label>
              </div>
            </div>
          )}

          <div className="form-section">
            <h3 className="section-heading">リネーム設定</h3>
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
        <div className="modal-footer">
          <button className="btn-secondary btn-small" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="btn-primary btn-small"
            onClick={handleExport}
            disabled={!outputPath || isExporting}
          >
            {isExporting ? '生成中...' : '生成'}
          </button>
        </div>
      </div>
    </div>
  );
}
