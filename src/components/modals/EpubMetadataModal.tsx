import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
  HybridCssProfile,
  EpubImageColorPolicy,
  EpubPageImageProfileOverride,
  EPUB_FORMAT_LABELS,
  EPUB_FORMAT_VIEWPORTS,
  HYBRID_CSS_PROFILE_LABELS,
  EPUB_IMAGE_COLOR_POLICY_LABELS,
  EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS,
  PAGE_DIRECTION_LABELS,
  SPREAD_MODE_LABELS,
  AUTHOR_ROLE_LABELS,
  Chapter,
} from '../../types';
import { BookIcon, NoPageIcon } from '../../icons';
import { useStore } from '../../store';
import { EpubSpreadPreview } from '../epub/EpubSpreadPreview';
import { useModalAnimation } from '../../hooks';

interface EpubMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (metadata: EpubMetadata, outputPath: string) => void;
  chapters: Chapter[];
  projectName: string;
}

const PUBLISHER_OPTIONS = [
  { name: 'CLLENN', fileAs: 'シレン' },
  { name: 'DEEPER-ZERO', fileAs: 'ディーパーゼロ' },
];

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
  const [publisher, setPublisher] = useState('CLLENN');
  const [publisherFileAs, setPublisherFileAs] = useState('シレン');
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
  const [allowMissingColophon, setAllowMissingColophon] = useState(false);
  const [hybridCssProfile, setHybridCssProfile] = useState<HybridCssProfile>('current');
  const [imageColorPolicy, setImageColorPolicy] = useState<EpubImageColorPolicy>('auto');

  // ビューポート
  const [viewportWidth, setViewportWidth] = useState(1442);
  const [viewportHeight, setViewportHeight] = useState(2048);

  // UUID
  const [bookUuid, setBookUuid] = useState('');

  // 出力パス
  const [outputPath, setOutputPath] = useState('');

  // 生成中フラグ
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null);

  // 左ペイン EPUBプレビュー用 store 連携
  const epubPages = useStore((s) => s.epubPages);
  const epubCurrentSpread = useStore((s) => s.epubCurrentSpread);
  const epubSelectedPageId = useStore((s) => s.epubSelectedPageId);
  const epubSelectedPageIds = useStore((s) => s.epubSelectedPageIds);
  const setEpubCurrentSpread = useStore((s) => s.setEpubCurrentSpread);
  const setEpubSelectedPageId = useStore((s) => s.setEpubSelectedPageId);
  const setEpubPageImageProfileOverride = useStore((s) => s.setEpubPageImageProfileOverride);
  const loadEpubFromDaidori = useStore((s) => s.loadEpubFromDaidori);

  // モーダル開閉と chapters 変化に同期して台割→EPUBページ変換を実行
  useEffect(() => {
    if (isOpen) {
      loadEpubFromDaidori();
    }
  }, [isOpen, chapters, loadEpubFromDaidori]);

  // 進捗イベントを購読
  useEffect(() => {
    if (!isGenerating) return;
    const unlisten = listen<{ phase: string; current: number; total: number }>(
      'epub-progress',
      (event) => {
        setProgress(event.payload);
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isGenerating]);

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
    if (format !== 'hybrid') {
      setAllowMissingColophon(false);
      setHybridCssProfile('current');
    }
  };

  const handleHybridCssProfileChange = (profile: HybridCssProfile) => {
    setHybridCssProfile(profile);
    if (profile === 'legacy') {
      setAllowMissingColophon(true);
    }
  };

  const handlePublisherChange = (publisherName: string) => {
    const option = PUBLISHER_OPTIONS.find((item) => item.name === publisherName);
    if (!option) return;
    setPublisher(option.name);
    setPublisherFileAs(option.fileAs);
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
      ch.type === 'colophon' || ch.pages.some((p) => p.pageType === 'colophon')
    );
    const allowsMissingColophon =
      outputFormat === 'hybrid' && (allowMissingColophon || hybridCssProfile === 'legacy');
    if (!hasColophon && !allowsMissingColophon) {
      return '奥付ページを設定してください';
    }

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
    setProgress({ phase: 'images', current: 0, total: 0 });

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
      language,
      pageDirection,
      viewportWidth,
      viewportHeight,
      spreadMode,
      orientation,
      bookUuid,
      outputFormat,
      allowMissingColophon: outputFormat === 'hybrid' ? (allowMissingColophon || hybridCssProfile === 'legacy') : undefined,
      hybridCssProfile: outputFormat === 'hybrid' ? hybridCssProfile : undefined,
      imageColorPolicy,
    };

    try {
      await onGenerate(metadata, outputPath);
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  // ページ数カウント
  const totalPages = chapters.reduce((sum, ch) => sum + ch.pages.length, 0);
  const selectedEpubPage = epubSelectedPageId
    ? epubPages.find((p) => p.id === epubSelectedPageId) ?? null
    : null;

  const { shouldRender, isClosing } = useModalAnimation(isOpen);
  if (!shouldRender) return null;

  const renderProgressDialog = () => {
    if (!isGenerating) return null;
    const isImagesPhase = progress?.phase === 'images' && progress.total > 0;
    const isPackagingPhase = progress?.phase === 'packaging';
    const isPsdToJpegPhase = progress?.phase === 'psd-to-jpeg';
    const isEpubCheckPhase = progress?.phase === 'epubcheck';
    const phaseLabel = isPsdToJpegPhase
      ? 'PSDをJPEGに変換しています…'
      : isEpubCheckPhase
      ? 'EPUBチェック機能を準備・検証しています…'
      : isImagesPhase
      ? '画像を変換しています…'
      : isPackagingPhase
      ? 'EPUBファイルを梱包しています…'
      : '準備中…';
    const percent = isImagesPhase
      ? Math.round((progress!.current / progress!.total) * 100)
      : isPackagingPhase
      ? 95
      : 0;
    return (
      <div className="modal-overlay epub-progress-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="epub-progress-dialog">
          <div className="epub-progress-title">
            <BookIcon size={20} />
            EPUB生成中
          </div>
          <div className="epub-progress-phase">{phaseLabel}</div>
          <div className="epub-progress-bar-track">
            <div
              className={`epub-progress-bar-fill ${isImagesPhase || isPackagingPhase ? '' : 'indeterminate'}`}
              style={
                isImagesPhase || isPackagingPhase
                  ? { width: `${percent}%` }
                  : undefined
              }
            />
          </div>
          <div className="epub-progress-meta">
            {isImagesPhase ? (
              <>
                <span>{progress!.current} / {progress!.total} ページ</span>
                <span>{percent}%</span>
              </>
            ) : (
              <span>{phaseLabel}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={isGenerating ? undefined : onClose}>
      <div
        className={`modal-content epub-modal ${isClosing ? 'closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>
            <BookIcon size={18} />
            EPUB生成
          </h2>
        </div>
        {renderProgressDialog()}

        <div className="epub-modal-split">
          {/* 左ペイン: EPUB見開きプレビュー + サムネイルバー */}
          <div className="epub-preview-pane">
            {epubPages.length === 0 ? (
              <div className="spread-viewer-empty">
                <NoPageIcon size={48} />
                <p>ページがありません</p>
              </div>
            ) : (
              <EpubSpreadPreview
                pages={epubPages}
                currentSpread={epubCurrentSpread}
                selectedPageId={epubSelectedPageId}
                selectedPageIds={epubSelectedPageIds}
                onSpreadChange={setEpubCurrentSpread}
                onSelectPage={(pageId) => setEpubSelectedPageId(pageId)}
                bindingDirection={pageDirection}
                isPageBarVisible={true}
              />
            )}
          </div>

          {/* 右ペイン: メタデータフォーム */}
          <div className="modal-body epub-modal-body">
          {/* 出力設定 */}
          <div className="form-section">
            <h3 className="section-heading">出力設定</h3>
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
            {outputFormat === 'hybrid' && (
              <>
                <div className="form-group">
                  <label>Hybrid CSS</label>
                  <select
                    value={hybridCssProfile}
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
                      checked={allowMissingColophon || hybridCssProfile === 'legacy'}
                      disabled={hybridCssProfile === 'legacy'}
                      onChange={(e) => setAllowMissingColophon(e.target.checked)}
                    />
                    奥付なしを許可
                  </label>
                </div>
              </>
            )}
            <div className="form-group">
              <label>画像カラープロファイル</label>
              <select
                value={imageColorPolicy}
                onChange={(e) => setImageColorPolicy(e.target.value as EpubImageColorPolicy)}
              >
                {(Object.keys(EPUB_IMAGE_COLOR_POLICY_LABELS) as EpubImageColorPolicy[]).map((policy) => (
                  <option key={policy} value={policy}>
                    {EPUB_IMAGE_COLOR_POLICY_LABELS[policy]}
                  </option>
                ))}
              </select>
              <div className="form-hint">
                Autoは本文のグレースケールを維持し、カラー画像はsRGB JPEGに正規化します。
              </div>
            </div>
            {selectedEpubPage && (
              <div className="form-group">
                <label>選択ページのICC指定</label>
                <select
                  value={selectedEpubPage.imageProfileOverride ?? 'auto'}
                  onChange={(e) =>
                    setEpubPageImageProfileOverride(
                      selectedEpubPage.id,
                      e.target.value as EpubPageImageProfileOverride,
                    )
                  }
                >
                  {(Object.keys(EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS) as EpubPageImageProfileOverride[]).map((override) => (
                    <option key={override} value={override}>
                      {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS[override]}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
            <h3 className="section-heading">書籍情報</h3>
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
                <select
                  className="publisher-select"
                  value={publisher}
                  onChange={(e) => handlePublisherChange(e.target.value)}
                >
                  {PUBLISHER_OPTIONS.map((option) => (
                    <option key={option.name} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>出版社読み仮名</label>
                <input
                  type="text"
                  value={publisherFileAs}
                  readOnly
                  placeholder="シュッパンシャメイ"
                />
              </div>
            </div>
          </div>

          {/* 著者情報 */}
          <div className="form-section">
            <h3 className="section-heading">著者情報</h3>
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
            <h3 className="section-heading">識別子</h3>
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

          <div className="form-section epub-license-info">
            <h3>使用ツール・ライセンス</h3>
            <p>
              EPUB生成後の検証には、W3C/DAISY Consortium が管理する EPUBCheck を使用します。
            </p>
            <details>
              <summary>EPUBCheck ライセンス</summary>
              <div className="epub-license-detail">
                <p>EPUBCheck is licensed under the BSD 3-Clause License.</p>
                <p>
                  Copyright © 2007 Adobe Systems Incorporated<br />
                  Copyright © 2008 IDPF<br />
                  Copyright © 2017 W3C (MIT, ERCIM, Keio, Beihang)
                </p>
                <p>
                  EPUBCheck は現状有姿で提供され、明示または黙示の保証はありません。
                  詳細なライセンス本文と第三者ライセンスは、初回チェック時に取得される
                  EPUBCheck 配布物内の LICENSE.txt / THIRD-PARTY.txt に含まれます。
                </p>
              </div>
            </details>
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
