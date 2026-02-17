import { useState, useEffect } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { desktopDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { Chapter, CHAPTER_TYPE_LABELS, CHAPTER_TYPE_COLORS } from '../../types';

// チャプターごとのリネーム設定
export interface ChapterRenameSettings {
  enabled: boolean;
  startNumber: number;
  startNumberText?: string;
  digits: number;
  digitsText?: string;
  prefix: string;
}

// エクスポート設定
export interface ExportOptions {
  outputPath: string;
  exportMode: 'copy' | 'move';  // コピーか移動か
  convertToJpg: boolean;  // JPGに変換するか
  jpgQuality: number;  // JPG品質（1-100）
  convertToTiff: boolean;  // PhotoshopでTIFFに変換するか
  renameMode: 'unified' | 'perChapter';
  // 一括設定
  startNumber: number;
  digits: number;
  prefix: string;
  // チャプターごとの設定
  perChapterSettings: Record<string, ChapterRenameSettings>;
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
  const [jpgQuality, setJpgQuality] = useState(100);
  const [convertToTiff, setConvertToTiff] = useState(false);
  const [photoshopInstalled, setPhotoshopInstalled] = useState<boolean | null>(null);
  const [renameMode, setRenameMode] = useState<'unified' | 'perChapter'>('unified');
  const [startNumber, setStartNumber] = useState(1);
  const [startNumberText, setStartNumberText] = useState('1');
  const [digits, setDigits] = useState(4);
  const [digitsText, setDigitsText] = useState('4');
  const [prefix, setPrefix] = useState('');
  const [perChapterSettings, setPerChapterSettings] = useState<Record<string, ChapterRenameSettings>>({});
  const [isExporting, setIsExporting] = useState(false);

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

  // PSDファイルがあるかチェック
  const hasPsdFiles = chapters.some(chapter =>
    chapter.pages.some(page => page.fileType === 'psd')
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
    setIsExporting(true);
    await onExport({ outputPath, exportMode, convertToJpg, jpgQuality, convertToTiff, renameMode, startNumber, digits, prefix, perChapterSettings });
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>エクスポート</h2>
          <button className="btn-icon modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>出力先フォルダ</label>
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
            <label>出力方法</label>
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
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={convertToJpg}
                onChange={(e) => {
                  setConvertToJpg(e.target.checked);
                  if (e.target.checked) setConvertToTiff(false);
                }}
              />
              高画質JPGに変換して出力
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
          </div>

          <div className="form-group">
            <label className={`checkbox-label ${!hasPsdFiles || !photoshopInstalled ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={convertToTiff}
                disabled={!hasPsdFiles || !photoshopInstalled}
                onChange={(e) => {
                  setConvertToTiff(e.target.checked);
                  if (e.target.checked) setConvertToJpg(false);
                }}
              />
              PhotoshopでTIFFに変換（PSDのみ）
              {!photoshopInstalled && photoshopInstalled !== null && (
                <span className="option-note"> - Photoshopが見つかりません</span>
              )}
              {photoshopInstalled && !hasPsdFiles && (
                <span className="option-note"> - PSDファイルがありません</span>
              )}
            </label>
            {convertToTiff && (
              <div className="tiff-options">
                <div className="tiff-note">
                  ※ LZW圧縮、レイヤー統合で出力（カラーモードは元ファイルを維持）
                </div>
              </div>
            )}
          </div>

          <div className="form-section">
            <h3>リネーム設定</h3>
            <div className="form-group">
              <label>リネームモード</label>
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
                  <label>プレフィックス（任意）</label>
                  <input
                    type="text"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="例: page_"
                  />
                </div>
                <div className="form-group">
                  <label>プレビュー</label>
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
            disabled={!outputPath || isExporting || (!convertToJpg && !convertToTiff)}
          >
            {isExporting ? 'エクスポート中...' : 'エクスポート'}
          </button>
        </div>
      </div>
    </div>
  );
}
