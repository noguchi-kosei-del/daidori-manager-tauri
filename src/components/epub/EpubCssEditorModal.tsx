import { useState, useEffect } from 'react';
import { useStore } from '../../store';

// CSSプリセット
const CSS_PRESETS: Record<string, string> = {
  'Fixed Layout（推奨）': `@charset "UTF-8";

/* Fixed Layout EPUB CSS */
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  background-color: #ffffff;
}

/* 画像コンテナ */
.image-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 画像 */
.image-container img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* ページタイプ別スタイル */
.page-cover img,
.page-colophon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
`,
  'シンプル': `@charset "UTF-8";

body {
  margin: 0;
  padding: 0;
}

img {
  max-width: 100%;
  height: auto;
}
`,
  '黒背景': `@charset "UTF-8";

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background-color: #000000;
}

.image-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-container img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
`,
};

interface EpubCssEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EpubCssEditorModal({ isOpen, onClose }: EpubCssEditorModalProps) {
  const { epubCustomCss, setEpubCustomCss } = useStore();
  const [localCss, setLocalCss] = useState(epubCustomCss);
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  // モーダルが開いたときにローカル状態を同期
  useEffect(() => {
    if (isOpen) {
      setLocalCss(epubCustomCss || CSS_PRESETS['Fixed Layout（推奨）']);
    }
  }, [isOpen, epubCustomCss]);

  // プリセット適用
  const handleApplyPreset = () => {
    if (selectedPreset && CSS_PRESETS[selectedPreset]) {
      setLocalCss(CSS_PRESETS[selectedPreset]);
    }
  };

  // リセット
  const handleReset = () => {
    setLocalCss(CSS_PRESETS['Fixed Layout（推奨）']);
    setSelectedPreset('Fixed Layout（推奨）');
  };

  // 保存
  const handleSave = () => {
    setEpubCustomCss(localCss);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content css-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>CSSエディタ</h2>
          <button className="btn-icon modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="css-editor-toolbar">
          <div className="preset-selector">
            <label>プリセット:</label>
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
            >
              <option value="">選択...</option>
              {Object.keys(CSS_PRESETS).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary btn-small"
              onClick={handleApplyPreset}
              disabled={!selectedPreset}
            >
              適用
            </button>
          </div>
          <button className="btn-secondary btn-small" onClick={handleReset}>
            リセット
          </button>
        </div>

        <div className="css-editor-body">
          <textarea
            className="css-editor-textarea"
            value={localCss}
            onChange={(e) => setLocalCss(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="modal-footer">
          <button className="btn-secondary btn-small" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-primary btn-small" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
