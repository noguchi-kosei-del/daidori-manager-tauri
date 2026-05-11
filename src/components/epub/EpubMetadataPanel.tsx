import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import {
  EpubFormat,
  HybridCssProfile,
  AuthorRole,
  PageDirection,
  SpreadMode,
  EPUB_FORMAT_LABELS,
  EPUB_FORMAT_VIEWPORTS,
  HYBRID_CSS_PROFILE_LABELS,
  PAGE_DIRECTION_LABELS,
  SPREAD_MODE_LABELS,
  AUTHOR_ROLE_LABELS,
} from '../../types';

export function EpubMetadataPanel() {
  const {
    epubMetadata,
    epubPages,
    updateEpubMetadata,
  } = useStore();

  // 初期化: UUIDがなければ生成
  useEffect(() => {
    if (epubMetadata && !epubMetadata.bookUuid) {
      invoke<string>('generate_book_uuid').then((uuid) => {
        updateEpubMetadata({ bookUuid: uuid });
      });
    }
  }, [epubMetadata]);

  if (!epubMetadata) {
    return (
      <div className="epub-metadata-panel">
        <div className="epub-metadata-empty">
          <p>画像を読み込んでください</p>
        </div>
      </div>
    );
  }

  // 形式変更時にビューポートサイズを更新
  const handleFormatChange = (format: EpubFormat) => {
    const viewport = EPUB_FORMAT_VIEWPORTS[format];
    updateEpubMetadata({
      outputFormat: format,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      allowMissingColophon: format === 'hybrid' ? (epubMetadata.allowMissingColophon ?? false) : undefined,
      hybridCssProfile: format === 'hybrid' ? (epubMetadata.hybridCssProfile ?? 'current') : undefined,
    });
  };

  const handleHybridCssProfileChange = (profile: HybridCssProfile) => {
    updateEpubMetadata({
      hybridCssProfile: profile,
      allowMissingColophon: profile === 'legacy' ? true : epubMetadata.allowMissingColophon,
    });
  };

  // 著者追加
  const addAuthor = () => {
    updateEpubMetadata({
      authors: [...epubMetadata.authors, { name: '', role: 'aut' }],
    });
  };

  // 著者削除
  const removeAuthor = (index: number) => {
    if (epubMetadata.authors.length > 1) {
      updateEpubMetadata({
        authors: epubMetadata.authors.filter((_, i) => i !== index),
      });
    }
  };

  // 著者更新
  const updateAuthor = (index: number, field: string, value: string) => {
    const newAuthors = [...epubMetadata.authors];
    newAuthors[index] = { ...newAuthors[index], [field]: value };
    updateEpubMetadata({ authors: newAuthors });
  };

  // UUID再生成
  const regenerateUuid = async () => {
    if (!confirm('UUIDを再生成しますか？\n電子書店での識別子が変わります。')) return;
    const newUuid = await invoke<string>('generate_book_uuid');
    updateEpubMetadata({ bookUuid: newUuid });
  };

  // ページ数情報
  const coverPage = epubPages.find(p => p.isCover);
  const colophonPages = epubPages.filter(p => p.isColophon);
  const isLegacyHybrid = epubMetadata.outputFormat === 'hybrid' && epubMetadata.hybridCssProfile === 'legacy';

  return (
    <div className="epub-metadata-panel">
        {/* 出力設定 */}
        <div className="form-section">
          <h3>出力設定</h3>
          <div className="form-group">
            <label>出力形式</label>
            <select
              value={epubMetadata.outputFormat}
              onChange={(e) => handleFormatChange(e.target.value as EpubFormat)}
            >
              {(Object.keys(EPUB_FORMAT_LABELS) as EpubFormat[]).map((fmt) => (
                <option key={fmt} value={fmt}>
                  {EPUB_FORMAT_LABELS[fmt]}
                </option>
              ))}
            </select>
          </div>
          {epubMetadata.outputFormat === 'hybrid' && (
            <>
              <div className="form-group">
                <label>Hybrid CSS</label>
                <select
                  value={epubMetadata.hybridCssProfile ?? 'current'}
                  onChange={(e) => handleHybridCssProfileChange(e.target.value as HybridCssProfile)}
                >
                  {(Object.keys(HYBRID_CSS_PROFILE_LABELS) as HybridCssProfile[]).map((profile) => (
                    <option key={profile} value={profile}>
                      {HYBRID_CSS_PROFILE_LABELS[profile]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={isLegacyHybrid || (epubMetadata.allowMissingColophon ?? false)}
                    disabled={isLegacyHybrid}
                    onChange={(e) => updateEpubMetadata({ allowMissingColophon: e.target.checked })}
                  />
                  奥付なしを許可
                </label>
              </div>
            </>
          )}
        </div>

        {/* 書籍情報 */}
        <div className="form-section">
          <h3>書籍情報</h3>
          <div className="form-group">
            <label>タイトル *</label>
            <input
              type="text"
              value={epubMetadata.title}
              onChange={(e) => updateEpubMetadata({ title: e.target.value })}
              placeholder="作品タイトル"
            />
          </div>
          <div className="form-group">
            <label>タイトル読み仮名</label>
            <input
              type="text"
              value={epubMetadata.titleFileAs || ''}
              onChange={(e) => updateEpubMetadata({ titleFileAs: e.target.value })}
              placeholder="サクヒンタイトル"
            />
          </div>
          <div className="form-group">
            <label>出版社 *</label>
            <input
              type="text"
              value={epubMetadata.publisher}
              onChange={(e) => updateEpubMetadata({ publisher: e.target.value })}
              placeholder="出版社名"
            />
          </div>
          <div className="form-group">
            <label>出版社読み仮名</label>
            <input
              type="text"
              value={epubMetadata.publisherFileAs || ''}
              onChange={(e) => updateEpubMetadata({ publisherFileAs: e.target.value })}
              placeholder="シュッパンシャメイ"
            />
          </div>
        </div>

        {/* 著者情報 */}
        <div className="form-section">
          <h3>著者情報</h3>
          {epubMetadata.authors.map((author, index) => (
            <div key={index} className="author-entry">
              <div className="form-group">
                <label>役割</label>
                <select
                  value={author.role}
                  onChange={(e) => updateAuthor(index, 'role', e.target.value)}
                >
                  {(Object.keys(AUTHOR_ROLE_LABELS) as AuthorRole[]).map((role) => (
                    <option key={role} value={role}>
                      {AUTHOR_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>名前 *</label>
                <input
                  type="text"
                  value={author.name}
                  onChange={(e) => updateAuthor(index, 'name', e.target.value)}
                  placeholder="著者名"
                />
              </div>
              <div className="form-group">
                <label>読み仮名</label>
                <input
                  type="text"
                  value={author.fileAs || ''}
                  onChange={(e) => updateAuthor(index, 'fileAs', e.target.value)}
                  placeholder="チョシャメイ"
                />
              </div>
              {epubMetadata.authors.length > 1 && (
                <button
                  className="btn-icon btn-delete"
                  onClick={() => removeAuthor(index)}
                  title="削除"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button className="btn-secondary btn-small" onClick={addAuthor}>
            + 著者を追加
          </button>
        </div>

        {/* レイアウト設定 */}
        <div className="form-section">
          <h3>レイアウト設定</h3>
          <div className="form-group">
            <label>ページ綴じ方向</label>
            <select
              value={epubMetadata.pageDirection}
              onChange={(e) => updateEpubMetadata({ pageDirection: e.target.value as PageDirection })}
            >
              {(Object.keys(PAGE_DIRECTION_LABELS) as PageDirection[]).map((dir) => (
                <option key={dir} value={dir}>
                  {PAGE_DIRECTION_LABELS[dir]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>見開きモード</label>
            <select
              value={epubMetadata.spreadMode}
              onChange={(e) => updateEpubMetadata({ spreadMode: e.target.value as SpreadMode })}
            >
              {(Object.keys(SPREAD_MODE_LABELS) as SpreadMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {SPREAD_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>幅</label>
              <input
                type="number"
                value={epubMetadata.viewportWidth}
                onChange={(e) => updateEpubMetadata({ viewportWidth: parseInt(e.target.value) || 0 })}
                min={100}
                max={4096}
              />
            </div>
            <div className="form-group">
              <label>高さ</label>
              <input
                type="number"
                value={epubMetadata.viewportHeight}
                onChange={(e) => updateEpubMetadata({ viewportHeight: parseInt(e.target.value) || 0 })}
                min={100}
                max={4096}
              />
            </div>
          </div>
        </div>

        {/* 識別子 */}
        <div className="form-section">
          <h3>識別子</h3>
          <div className="form-group">
            <label>UUID</label>
            <div className="input-with-button">
              <input
                type="text"
                value={epubMetadata.bookUuid}
                readOnly
                className="uuid-input"
              />
              <button className="btn-secondary btn-small" onClick={regenerateUuid}>
                再生成
              </button>
            </div>
            <div className="form-hint">
              電子書店での識別に使用
            </div>
          </div>
        </div>

        {/* ページ情報 */}
        <div className="form-section">
          <h3>ページ情報</h3>
          <div className="epub-stats">
            <div className="epub-stat">
              <span className="stat-label">総ページ数</span>
              <span className="stat-value">{epubPages.length}</span>
            </div>
            <div className="epub-stat">
              <span className="stat-label">表紙</span>
              <span className="stat-value">{coverPage ? '設定済み' : '未設定'}</span>
            </div>
            <div className="epub-stat">
              <span className="stat-label">奥付</span>
              <span className="stat-value">{colophonPages.length > 0 ? `${colophonPages.length}件` : '未設定'}</span>
            </div>
          </div>
        </div>
    </div>
  );
}
