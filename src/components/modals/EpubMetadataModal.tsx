import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { desktopDir, join } from '@tauri-apps/api/path';
import {
  EpubMetadata,
  EpubFormat,
  AuthorInfo,
  AuthorRole,
  PageDirection,
  SpreadMode,
  Orientation,
  EPUB_FORMAT_LABELS,
  EPUB_FORMAT_VIEWPORTS,
  PAGE_DIRECTION_LABELS,
  SPREAD_MODE_LABELS,
  AUTHOR_ROLE_LABELS,
  Chapter,
} from '../../types';

interface EpubMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (metadata: EpubMetadata, outputPath: string) => void;
  chapters: Chapter[];
  projectName: string;
}

export function EpubMetadataModal({
  isOpen,
  onClose,
  onGenerate,
  chapters,
  projectName,
}: EpubMetadataModalProps) {
  // 基本情報
  const [title, setTitle] = useState('');
  const [titleFileAs, setTitleFileAs] = useState('');
  const [publisher, setPublisher] = useState('');
  const [publisherFileAs, setPublisherFileAs] = useState('');
  const [isbn, setIsbn] = useState('');
  const [description, setDescription] = useState('');
  const [language] = useState('ja');

  // 著者情報
  const [authors, setAuthors] = useState<AuthorInfo[]>([
    { name: '', role: 'aut' },
  ]);

  // 出力設定
  const [outputFormat, setOutputFormat] = useState<EpubFormat>('kadokawa');
  const [pageDirection, setPageDirection] = useState<PageDirection>('rtl');
  const [spreadMode, setSpreadMode] = useState<SpreadMode>('landscape');
  const [orientation] = useState<Orientation>('auto');

  // ビューポート
  const [viewportWidth, setViewportWidth] = useState(1442);
  const [viewportHeight, setViewportHeight] = useState(2048);

  // UUID
  const [bookUuid, setBookUuid] = useState('');

  // 出力パス
  const [outputPath, setOutputPath] = useState('');

  // 生成中フラグ
  const [isGenerating, setIsGenerating] = useState(false);

  // 初期化
  useEffect(() => {
    if (isOpen) {
      // プロジェクト名をタイトルに設定
      if (!title && projectName) {
        setTitle(projectName);
      }

      // UUIDが空なら生成
      if (!bookUuid) {
        invoke<string>('generate_book_uuid').then(setBookUuid);
      }

      // 出力パスが空なら設定
      if (!outputPath) {
        initOutputPath();
      }
    }
  }, [isOpen, projectName]);

  const initOutputPath = async () => {
    try {
      const desktop = await desktopDir();
      const fileName = `${projectName || 'output'}.epub`;
      const defaultPath = await join(desktop, fileName);
      setOutputPath(defaultPath);
    } catch (e) {
      console.error('Failed to set default path:', e);
    }
  };

  // 形式変更時にビューポートサイズを更新
  const handleFormatChange = (format: EpubFormat) => {
    setOutputFormat(format);
    const viewport = EPUB_FORMAT_VIEWPORTS[format];
    setViewportWidth(viewport.width);
    setViewportHeight(viewport.height);
  };

  // 著者追加
  const addAuthor = () => {
    setAuthors([...authors, { name: '', role: 'aut' }]);
  };

  // 著者削除
  const removeAuthor = (index: number) => {
    if (authors.length > 1) {
      setAuthors(authors.filter((_, i) => i !== index));
    }
  };

  // 著者更新
  const updateAuthor = (index: number, field: keyof AuthorInfo, value: string) => {
    const newAuthors = [...authors];
    newAuthors[index] = { ...newAuthors[index], [field]: value };
    setAuthors(newAuthors);
  };

  // UUID再生成
  const regenerateUuid = async () => {
    const newUuid = await invoke<string>('generate_book_uuid');
    setBookUuid(newUuid);
  };

  // 出力先選択
  const handleSelectOutput = async () => {
    const selected = await save({
      title: 'EPUBの保存先を選択',
      defaultPath: outputPath || `${projectName || 'output'}.epub`,
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
    });
    if (selected) {
      setOutputPath(selected);
    }
  };

  // バリデーション
  const validate = (): string | null => {
    if (!title.trim()) return 'タイトルを入力してください';
    if (!publisher.trim()) return '出版社を入力してください';
    if (authors.length === 0 || !authors[0].name.trim()) {
      return '著者を1人以上入力してください';
    }
    if (!outputPath) return '出力先を選択してください';

    // 奥付ページの確認
    const hasColophon = chapters.some((ch) =>
      ch.pages.some((p) => p.pageType === 'colophon')
    );
    if (!hasColophon) return '奥付ページを設定してください';

    return null;
  };

  // 生成
  const handleGenerate = async () => {
    const error = validate();
    if (error) {
      alert(error);
      return;
    }

    setIsGenerating(true);

    const metadata: EpubMetadata = {
      title: title.trim(),
      titleFileAs: titleFileAs.trim() || undefined,
      authors: authors
        .filter((a) => a.name.trim())
        .map((a) => ({
          name: a.name.trim(),
          fileAs: a.fileAs?.trim() || undefined,
          role: a.role,
          roleDisplay: a.roleDisplay?.trim() || undefined,
        })),
      publisher: publisher.trim(),
      publisherFileAs: publisherFileAs.trim() || undefined,
      isbn: isbn.trim() || undefined,
      language,
      pageDirection,
      viewportWidth,
      viewportHeight,
      spreadMode,
      orientation,
      bookUuid,
      outputFormat,
      description: description.trim() || undefined,
    };

    try {
      await onGenerate(metadata, outputPath);
    } finally {
      setIsGenerating(false);
    }
  };

  // ページ数カウント
  const totalPages = chapters.reduce((sum, ch) => sum + ch.pages.length, 0);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content epub-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>EPUB生成</h2>
          <button className="btn-icon modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body epub-modal-body">
          {/* 出力設定 */}
          <div className="form-section">
            <h3>出力設定</h3>
            <div className="form-group">
              <label>出力形式</label>
              <select
                value={outputFormat}
                onChange={(e) => handleFormatChange(e.target.value as EpubFormat)}
              >
                {(Object.keys(EPUB_FORMAT_LABELS) as EpubFormat[]).map((fmt) => (
                  <option key={fmt} value={fmt}>
                    {EPUB_FORMAT_LABELS[fmt]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>出力先</label>
              <div className="input-with-button">
                <input
                  type="text"
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  placeholder="ファイルを選択..."
                  readOnly
                />
                <button className="btn-secondary btn-small" onClick={handleSelectOutput}>
                  参照
                </button>
              </div>
            </div>
          </div>

          {/* 書籍情報 */}
          <div className="form-section">
            <h3>書籍情報</h3>
            <div className="form-group">
              <label>タイトル *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="作品タイトル"
              />
            </div>
            <div className="form-group">
              <label>タイトル読み仮名</label>
              <input
                type="text"
                value={titleFileAs}
                onChange={(e) => setTitleFileAs(e.target.value)}
                placeholder="サクヒンタイトル"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>出版社 *</label>
                <input
                  type="text"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  placeholder="出版社名"
                />
              </div>
              <div className="form-group">
                <label>出版社読み仮名</label>
                <input
                  type="text"
                  value={publisherFileAs}
                  onChange={(e) => setPublisherFileAs(e.target.value)}
                  placeholder="シュッパンシャメイ"
                />
              </div>
            </div>
            <div className="form-group">
              <label>ISBN</label>
              <input
                type="text"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                placeholder="978-4-XXXX-XXXX-X"
              />
            </div>
            <div className="form-group">
              <label>説明</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="作品の説明（オプション）"
                rows={2}
              />
            </div>
          </div>

          {/* 著者情報 */}
          <div className="form-section">
            <h3>著者情報</h3>
            {authors.map((author, index) => (
              <div key={index} className="author-entry">
                <div className="form-row">
                  <div className="form-group">
                    <label>役割</label>
                    <select
                      value={author.role}
                      onChange={(e) =>
                        updateAuthor(index, 'role', e.target.value)
                      }
                    >
                      {(Object.keys(AUTHOR_ROLE_LABELS) as AuthorRole[]).map(
                        (role) => (
                          <option key={role} value={role}>
                            {AUTHOR_ROLE_LABELS[role]}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                  <div className="form-group flex-grow">
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
                      onChange={(e) =>
                        updateAuthor(index, 'fileAs', e.target.value)
                      }
                      placeholder="チョシャメイ"
                    />
                  </div>
                  {authors.length > 1 && (
                    <button
                      className="btn-icon btn-delete author-remove"
                      onClick={() => removeAuthor(index)}
                      title="削除"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button className="btn-secondary btn-small" onClick={addAuthor}>
              + 著者を追加
            </button>
          </div>

          {/* レイアウト設定 */}
          <div className="form-section">
            <h3>レイアウト設定</h3>
            <div className="form-row">
              <div className="form-group">
                <label>ページ綴じ方向</label>
                <select
                  value={pageDirection}
                  onChange={(e) =>
                    setPageDirection(e.target.value as PageDirection)
                  }
                >
                  {(Object.keys(PAGE_DIRECTION_LABELS) as PageDirection[]).map(
                    (dir) => (
                      <option key={dir} value={dir}>
                        {PAGE_DIRECTION_LABELS[dir]}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div className="form-group">
                <label>見開きモード</label>
                <select
                  value={spreadMode}
                  onChange={(e) => setSpreadMode(e.target.value as SpreadMode)}
                >
                  {(Object.keys(SPREAD_MODE_LABELS) as SpreadMode[]).map(
                    (mode) => (
                      <option key={mode} value={mode}>
                        {SPREAD_MODE_LABELS[mode]}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>ビューポート幅</label>
                <input
                  type="number"
                  value={viewportWidth}
                  onChange={(e) => setViewportWidth(parseInt(e.target.value) || 0)}
                  min={100}
                  max={4096}
                />
              </div>
              <div className="form-group">
                <label>ビューポート高さ</label>
                <input
                  type="number"
                  value={viewportHeight}
                  onChange={(e) => setViewportHeight(parseInt(e.target.value) || 0)}
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
                  value={bookUuid}
                  readOnly
                  className="uuid-input"
                />
                <button
                  className="btn-secondary btn-small"
                  onClick={regenerateUuid}
                >
                  再生成
                </button>
              </div>
              <div className="form-hint">
                電子書店での識別に使用されます。同じ本の更新版では同じUUIDを使用してください。
              </div>
            </div>
          </div>

          {/* プレビュー情報 */}
          <div className="form-section epub-preview-info">
            <h3>生成情報</h3>
            <div className="epub-stats">
              <div className="epub-stat">
                <span className="stat-label">チャプター数</span>
                <span className="stat-value">{chapters.length}</span>
              </div>
              <div className="epub-stat">
                <span className="stat-label">総ページ数</span>
                <span className="stat-value">{totalPages}</span>
              </div>
              <div className="epub-stat">
                <span className="stat-label">形式</span>
                <span className="stat-value">{EPUB_FORMAT_LABELS[outputFormat]}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary btn-small" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="btn-primary btn-small"
            onClick={handleGenerate}
            disabled={isGenerating || totalPages === 0}
          >
            {isGenerating ? 'EPUB生成中...' : 'EPUBを生成'}
          </button>
        </div>
      </div>
    </div>
  );
}
