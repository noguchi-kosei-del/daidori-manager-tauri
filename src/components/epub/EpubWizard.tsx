import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
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
  EpubSplitSettings,
  EPUB_FORMAT_VIEWPORTS,
  EPUB_IMAGE_COLOR_POLICY_OPTIONS,
  EPUB_IMAGE_COLOR_POLICY_LABELS,
  HYBRID_CSS_PROFILE_LABELS,
  AUTHOR_ROLE_LABELS,
  Chapter,
} from '../../types';
import { useStore } from '../../store';
import { BookIcon, CheckIcon2, NoPageIcon } from '../../icons';

const PUBLISHER_OPTIONS = [
  { name: 'CLLENN', fileAs: 'シレン' },
  { name: 'DEEPER-ZERO', fileAs: 'ディーパーゼロ' },
];

const FORMAT_PRESETS: { value: EpubFormat; label: string; sub: string; recommended?: boolean }[] = [
  { value: 'kadokawa', label: '電子書店向け（標準）', sub: '主要な電子書店に対応・電書協準拠', recommended: true },
  { value: 'hybrid', label: '幅広い端末対応', sub: '古い端末も含めて広くカバー（Hybrid）' },
  { value: 'oebps', label: 'シンプル', sub: '最小構成（OEBPS）' },
];

const STEPS = ['本の情報', '表紙・奥付', '仕上がり', '分割', '確認して書き出し'];

interface EpubWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (metadata: EpubMetadata, outputPath: string, splitSettings?: EpubSplitSettings) => void | Promise<void>;
  chapters: Chapter[];
  projectName: string;
}

export function EpubWizard({ isOpen, onClose, onGenerate, chapters, projectName }: EpubWizardProps) {
  const [step, setStep] = useState(0);

  // 書籍情報
  const [title, setTitle] = useState('');
  const [titleFileAs, setTitleFileAs] = useState('');
  const [publisher, setPublisher] = useState('CLLENN');
  const [publisherFileAs, setPublisherFileAs] = useState('シレン');
  const [authors, setAuthors] = useState<AuthorInfo[]>([{ name: '', role: 'aut' }]);

  // 仕上がり
  const [outputFormat, setOutputFormat] = useState<EpubFormat>('kadokawa');
  const [imageColorPolicy, setImageColorPolicy] = useState<EpubImageColorPolicy>('auto');
  const [colorMode, setColorMode] = useState<'auto' | 'custom'>('auto');
  const [hybridCssProfile, setHybridCssProfile] = useState<HybridCssProfile>('current');
  const [allowMissingColophon, setAllowMissingColophon] = useState(false);

  // レイアウト
  const [pageDirection, setPageDirection] = useState<PageDirection>('rtl');
  const [spreadMode] = useState<SpreadMode>('landscape');
  const [orientation] = useState<Orientation>('auto');
  const [viewportWidth, setViewportWidth] = useState(1442);
  const [viewportHeight, setViewportHeight] = useState(2048);
  const [language] = useState('ja');

  // 識別子・出力
  const [bookUuid, setBookUuid] = useState('');
  const [outputPath, setOutputPath] = useState('');

  // 分割
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitRanges, setSplitRanges] = useState<{ startIndex: number; endIndex: number }[]>([]);
  const [splitSelectingStart, setSplitSelectingStart] = useState<number | null>(null);
  const [splitBaseName, setSplitBaseName] = useState('');
  const [splitSuffixStart, setSplitSuffixStart] = useState(1);
  const [splitSuffixDigits, setSplitSuffixDigits] = useState(3);
  const [splitSuffixSeparator, setSplitSuffixSeparator] = useState('_');

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null);

  // store（表紙/奥付・プレビューページ）
  const epubPages = useStore((s) => s.epubPages);
  const epubSelectedPageId = useStore((s) => s.epubSelectedPageId);
  const setEpubSelectedPageId = useStore((s) => s.setEpubSelectedPageId);
  const setEpubPageAsCover = useStore((s) => s.setEpubPageAsCover);
  const setEpubPageAsColophon = useStore((s) => s.setEpubPageAsColophon);
  const clearEpubPageCover = useStore((s) => s.clearEpubPageCover);
  const clearEpubPageColophon = useStore((s) => s.clearEpubPageColophon);
  const loadEpubFromDaidori = useStore((s) => s.loadEpubFromDaidori);

  const totalPages = chapters.reduce((sum, ch) => sum + ch.pages.length, 0);

  // 開いたら台割→EPUBページへ同期＋初期値
  useEffect(() => {
    if (!isOpen) return;
    loadEpubFromDaidori();
    setStep(0);
    // 既定名「新規プロジェクト」はタイトルに流し込まず、プレースホルダ（作品タイトル）を表示する
    const meaningfulName = projectName && projectName !== '新規プロジェクト' ? projectName : '';
    if (!title && meaningfulName) setTitle(meaningfulName);
    if (!splitBaseName && meaningfulName) setSplitBaseName(meaningfulName);
    if (!bookUuid) invoke<string>('generate_book_uuid').then(setBookUuid).catch(() => {});
    if (!outputPath) {
      (async () => {
        try {
          const desktop = await desktopDir();
          setOutputPath(await join(desktop, `${projectName || 'output'}.epub`));
        } catch { /* ignore */ }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 生成進捗
  useEffect(() => {
    if (!isGenerating) return;
    const unlisten = listen<{ phase: string; current: number; total: number }>('epub-progress', (e) => setProgress(e.payload));
    return () => { unlisten.then((fn) => fn()); };
  }, [isGenerating]);

  const handleFormatChange = (format: EpubFormat) => {
    setOutputFormat(format);
    const vp = EPUB_FORMAT_VIEWPORTS[format];
    setViewportWidth(vp.width);
    setViewportHeight(vp.height);
    if (format !== 'hybrid') {
      setAllowMissingColophon(false);
      setHybridCssProfile('current');
    }
  };

  const updateAuthor = (i: number, field: keyof AuthorInfo, value: string) => {
    setAuthors((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  };
  const addAuthor = () => setAuthors((prev) => [...prev, { name: '', role: 'aut' }]);
  const removeAuthor = (i: number) => setAuthors((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const handlePublisherChange = (name: string) => {
    const opt = PUBLISHER_OPTIONS.find((o) => o.name === name);
    if (!opt) return;
    setPublisher(opt.name);
    setPublisherFileAs(opt.fileAs);
  };

  const handleSelectOutput = async () => {
    const selected = await save({
      title: 'EPUBの保存先を選択',
      defaultPath: outputPath || `${projectName || 'output'}.epub`,
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
    });
    if (selected) setOutputPath(selected);
  };

  const thumbSrc = (page: (typeof epubPages)[number]): string | null => {
    if (page.isBlank) return null;
    const p = page.thumbnailPath || page.sourcePath;
    return p.startsWith('data:') ? p : convertFileSrc(p);
  };

  const coverPage = epubPages.find((p) => p.isCover) ?? null;
  const colophonPage = epubPages.find((p) => p.isColophon) ?? null;

  // 分割範囲の操作
  const splitAssigned = useMemo(() => {
    const s = new Set<number>();
    splitRanges.forEach((r) => { for (let i = r.startIndex; i <= r.endIndex; i++) s.add(i); });
    return s;
  }, [splitRanges]);
  const getSplitRangeIndex = (i: number) => splitRanges.findIndex((r) => i >= r.startIndex && i <= r.endIndex);
  const handleSplitPageClick = (index: number) => {
    const ri = getSplitRangeIndex(index);
    if (ri >= 0) { setSplitRanges((rs) => rs.filter((_, i) => i !== ri)); setSplitSelectingStart(null); return; }
    if (splitSelectingStart === null) { setSplitSelectingStart(index); return; }
    if (splitSelectingStart === index) { setSplitSelectingStart(null); return; }
    const start = Math.min(splitSelectingStart, index);
    const end = Math.max(splitSelectingStart, index);
    for (let i = start; i <= end; i++) {
      if (splitAssigned.has(i)) { alert(`ページ ${i + 1} は既に別の範囲に含まれています`); setSplitSelectingStart(null); return; }
    }
    setSplitRanges((rs) => [...rs, { startIndex: start, endIndex: end }]);
    setSplitSelectingStart(null);
  };

  // 各ステップの未入力チェック
  const stepError = (s: number): string | null => {
    if (s === 0) {
      if (!title.trim()) return 'タイトルを入力してください';
      if (authors.length === 0 || !authors[0].name.trim()) return '著者を1人以上入力してください';
    }
    if (s === 3 && splitEnabled && splitRanges.length === 0) return '分割範囲を1つ以上選択してください';
    if (s === 4 && !outputPath) return '出力先を選んでください';
    return null;
  };
  const currentError = stepError(step);
  const canGenerate = !isGenerating && totalPages > 0 && [0, 1, 2, 3, 4].every((s) => !stepError(s));

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    setProgress({ phase: 'images', current: 0, total: 0 });
    const metadata: EpubMetadata = {
      title: title.trim(),
      titleFileAs: titleFileAs.trim() || undefined,
      authors: authors.filter((a) => a.name.trim()).map((a) => ({
        name: a.name.trim(), fileAs: a.fileAs?.trim() || undefined, role: a.role,
      })),
      publisher: publisher.trim(),
      publisherFileAs: publisherFileAs.trim() || undefined,
      language, pageDirection, viewportWidth, viewportHeight, spreadMode, orientation,
      bookUuid, outputFormat,
      allowMissingColophon: outputFormat === 'hybrid' ? (allowMissingColophon || hybridCssProfile === 'legacy') : undefined,
      hybridCssProfile: outputFormat === 'hybrid' ? hybridCssProfile : undefined,
      imageColorPolicy: colorMode === 'auto' ? 'auto' : imageColorPolicy,
    };
    try {
      await onGenerate(metadata, outputPath, splitEnabled ? {
        enabled: true,
        ranges: splitRanges,
        baseName: splitBaseName.trim() || projectName || 'output',
        titles: splitRanges.map(() => title.trim()),
        titleFileAsList: splitRanges.map(() => titleFileAs.trim()),
        suffixStart: splitSuffixStart,
        suffixDigits: splitSuffixDigits,
        suffixSeparator: splitSuffixSeparator,
      } : undefined);
      onClose();
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  if (!isOpen) return null;

  const goNext = () => { if (!currentError) setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  return createPortal(
    <div className="modal-overlay epub-wizard-overlay">
      <div className="epub-wizard">
        {/* 進行レール */}
        <aside className="epub-wizard-rail">
          <div className="epub-wizard-rail-head">
            <BookIcon size={18} />
            <span>EPUBを作成</span>
          </div>
          <ol className="epub-wizard-steps">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={`epub-wizard-step ${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`}
                onClick={() => { if (i < step || !stepError(step)) setStep(i); }}
              >
                <span className="epub-wizard-step-no">{i < step ? <CheckIcon2 /> : i + 1}</span>
                <span className="epub-wizard-step-label">{label}</span>
              </li>
            ))}
          </ol>
          <div className="epub-wizard-rail-foot">{chapters.length}チャプター / {totalPages}ページ</div>
        </aside>

        {/* 本体 */}
        <div className="epub-wizard-main">
          <header className="epub-wizard-header">
            <div>
              <div className="epub-wizard-step-counter">ステップ {step + 1} / {STEPS.length}</div>
              <h2 className="epub-wizard-title">{STEPS[step]}</h2>
            </div>
          </header>

          <div className="epub-wizard-body" key={step}>
            {step === 0 && (
              <div className="epub-wizard-form">
                <p className="epub-wizard-lead">電子書籍の表紙やストアに表示される情報です。</p>
                <div className="form-group">
                  <label>タイトル <span className="req">必須</span></label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="作品タイトル" />
                </div>
                <div className="form-group">
                  <label>タイトルのヨミ <span className="opt">任意</span></label>
                  <input type="text" value={titleFileAs} onChange={(e) => setTitleFileAs(e.target.value)} placeholder="サクヒンタイトル" />
                  <div className="form-hint">ストアでの並び替えに使われます（カタカナ）。</div>
                </div>
                <div className="form-group">
                  <label>出版社</label>
                  <select value={publisher} onChange={(e) => handlePublisherChange(e.target.value)}>
                    {PUBLISHER_OPTIONS.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                  </select>
                </div>
                <div className="epub-wizard-authors">
                  <label>著者 <span className="req">必須</span></label>
                  {authors.map((a, i) => (
                    <div key={i} className="epub-wizard-author-row">
                      <select value={a.role} onChange={(e) => updateAuthor(i, 'role', e.target.value)}>
                        {(Object.keys(AUTHOR_ROLE_LABELS) as AuthorRole[]).map((r) => (
                          <option key={r} value={r}>{AUTHOR_ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                      <input type="text" value={a.name} onChange={(e) => updateAuthor(i, 'name', e.target.value)} placeholder="著者名" />
                      <input type="text" value={a.fileAs || ''} onChange={(e) => updateAuthor(i, 'fileAs', e.target.value)} placeholder="ヨミ（任意）" />
                      {authors.length > 1 && (
                        <button className="btn-icon btn-delete" onClick={() => removeAuthor(i)} title="削除">×</button>
                      )}
                    </div>
                  ))}
                  <button className="btn-secondary btn-small" onClick={addAuthor}>＋ 著者を追加</button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="epub-wizard-form">
                <p className="epub-wizard-lead">表紙（最初のページ）と奥付（最後の権利表示ページ）を選びます。未指定なら自動で先頭/末尾を使います。</p>
                <div className="epub-wizard-binding">
                  <label>読む向き</label>
                  <div className="epub-wizard-seg">
                    <button className={pageDirection === 'rtl' ? 'active' : ''} onClick={() => setPageDirection('rtl')}>右開き（日本の漫画）</button>
                    <button className={pageDirection === 'ltr' ? 'active' : ''} onClick={() => setPageDirection('ltr')}>左開き（横書き・洋書）</button>
                  </div>
                </div>
                <div className="epub-wizard-coverbar">
                  <span>選択中のページを:</span>
                  <button className="btn-secondary btn-small" disabled={!epubSelectedPageId} onClick={() => epubSelectedPageId && setEpubPageAsCover(epubSelectedPageId)}>表紙にする</button>
                  <button className="btn-secondary btn-small" disabled={!epubSelectedPageId} onClick={() => epubSelectedPageId && setEpubPageAsColophon(epubSelectedPageId)}>奥付にする</button>
                  <span className="epub-wizard-coverbar-status">
                    表紙: {coverPage ? `p${epubPages.indexOf(coverPage) + 1}` : '自動'} / 奥付: {colophonPage ? `p${epubPages.indexOf(colophonPage) + 1}` : '自動'}
                  </span>
                </div>
                {epubPages.length === 0 ? (
                  <div className="spread-viewer-empty"><NoPageIcon size={40} /><p>ページがありません</p></div>
                ) : (
                  <div className="epub-wizard-thumbgrid">
                    {epubPages.map((page, i) => {
                      const src = thumbSrc(page);
                      return (
                        <button
                          key={page.id}
                          className={`epub-wizard-thumb ${epubSelectedPageId === page.id ? 'selected' : ''} ${page.isCover ? 'cover' : ''} ${page.isColophon ? 'colophon' : ''}`}
                          onClick={() => setEpubSelectedPageId(page.id)}
                        >
                          <span className="epub-wizard-thumb-img">
                            {src ? <img src={src} alt="" loading="lazy" /> : <span className="ph">{page.isBlank ? '白紙' : 'No Image'}</span>}
                          </span>
                          <span className="epub-wizard-thumb-no">{i + 1}</span>
                          {page.isCover && <span className="epub-wizard-thumb-badge cover">表紙</span>}
                          {page.isColophon && <span className="epub-wizard-thumb-badge colophon">奥付</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {(coverPage || colophonPage) && (
                  <div className="epub-wizard-coverclear">
                    {coverPage && <button className="btn-secondary btn-small" onClick={() => clearEpubPageCover()}>表紙を自動に戻す</button>}
                    {colophonPage && <button className="btn-secondary btn-small" onClick={() => clearEpubPageColophon(colophonPage.id)}>奥付を自動に戻す</button>}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="epub-wizard-form">
                <p className="epub-wizard-lead">どの形式で書き出すかを選びます。迷ったら「電子書店向け（標準）」のままでOKです。</p>
                <div className="epub-wizard-cards">
                  {FORMAT_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      className={`epub-wizard-card ${outputFormat === p.value ? 'selected' : ''}`}
                      onClick={() => handleFormatChange(p.value)}
                    >
                      <span className="epub-wizard-card-title">
                        {p.label}{p.recommended && <span className="epub-wizard-reco">おすすめ</span>}
                      </span>
                      <span className="epub-wizard-card-sub">{p.sub}</span>
                    </button>
                  ))}
                </div>
                <div className="form-group">
                  <label>色の扱い</label>
                  <div className="epub-wizard-seg">
                    <button className={colorMode === 'auto' ? 'active' : ''} onClick={() => setColorMode('auto')}>おまかせ（推奨）</button>
                    <button className={colorMode === 'custom' ? 'active' : ''} onClick={() => setColorMode('custom')}>自分で指定</button>
                  </div>
                  <div className="form-hint">おまかせ＝本文はモノクロを維持し、カラーページは電子書籍向け（sRGB）に整えます。</div>
                </div>
                {(colorMode === 'custom' || outputFormat === 'hybrid') && (
                  <details className="epub-advanced" open={colorMode === 'custom'}>
                    <summary>詳細設定</summary>
                    {colorMode === 'custom' && (
                      <div className="form-group">
                        <label>カラープロファイル（ICC）</label>
                        <select value={imageColorPolicy} onChange={(e) => setImageColorPolicy(e.target.value as EpubImageColorPolicy)}>
                          {EPUB_IMAGE_COLOR_POLICY_OPTIONS.map((p) => (
                            <option key={p} value={p}>{EPUB_IMAGE_COLOR_POLICY_LABELS[p]}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {outputFormat === 'hybrid' && (
                      <div className="form-group">
                        <label>Hybrid CSS</label>
                        <select value={hybridCssProfile} onChange={(e) => { setHybridCssProfile(e.target.value as HybridCssProfile); if (e.target.value === 'legacy') setAllowMissingColophon(true); }}>
                          {(Object.keys(HYBRID_CSS_PROFILE_LABELS) as HybridCssProfile[]).map((p) => (
                            <option key={p} value={p}>{HYBRID_CSS_PROFILE_LABELS[p]}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </details>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="epub-wizard-form">
                <p className="epub-wizard-lead">1冊にまとめるか、話ごとに分けて複数のEPUBにするかを選びます。</p>
                <div className="epub-wizard-seg epub-wizard-seg-wide">
                  <button className={!splitEnabled ? 'active' : ''} onClick={() => setSplitEnabled(false)}>1冊にまとめる</button>
                  <button className={splitEnabled ? 'active' : ''} onClick={() => setSplitEnabled(true)}>話ごとに分ける</button>
                </div>
                {splitEnabled && (
                  <>
                    <div className="epub-wizard-split-guide">
                      {splitSelectingStart !== null
                        ? `開始: p${splitSelectingStart + 1} → 終了ページをクリック`
                        : 'まとめたい範囲の「開始ページ」→「終了ページ」の順にクリック。分割済みをクリックで解除。'}
                    </div>
                    <div className="epub-wizard-thumbgrid">
                      {epubPages.map((page, i) => {
                        const ri = getSplitRangeIndex(i);
                        const assigned = ri >= 0;
                        const selecting = splitSelectingStart === i;
                        const src = thumbSrc(page);
                        return (
                          <button
                            key={page.id}
                            className={`epub-wizard-thumb ${assigned ? 'assigned' : ''} ${selecting ? 'selecting' : ''}`}
                            onClick={() => handleSplitPageClick(i)}
                            style={assigned ? { ['--split-color' as string]: `var(--split-color-${ri % 8})` } : undefined}
                          >
                            <span className="epub-wizard-thumb-img">
                              {src ? <img src={src} alt="" loading="lazy" /> : <span className="ph">{page.isBlank ? '白紙' : 'No Image'}</span>}
                            </span>
                            <span className="epub-wizard-thumb-no">{i + 1}</span>
                            {assigned && <span className="epub-wizard-thumb-badge cover">{ri + 1}巻</span>}
                          </button>
                        );
                      })}
                    </div>
                    {splitRanges.length > 0 && (
                      <div className="epub-wizard-split-list">
                        {splitRanges.map((r, i) => (
                          <div key={`${r.startIndex}-${r.endIndex}`}>{i + 1}巻: p{r.startIndex + 1}〜p{r.endIndex + 1}（{r.endIndex - r.startIndex + 1}ページ）</div>
                        ))}
                      </div>
                    )}
                    <details className="epub-advanced">
                      <summary>ファイル名の設定</summary>
                      <div className="form-row">
                        <div className="form-group flex-grow">
                          <label>ベース名</label>
                          <input type="text" value={splitBaseName} onChange={(e) => setSplitBaseName(e.target.value)} />
                        </div>
                        <div className="form-group">
                          <label>区切り</label>
                          <input type="text" value={splitSuffixSeparator} onChange={(e) => setSplitSuffixSeparator(e.target.value)} />
                        </div>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>開始番号</label>
                          <input type="number" min={0} value={splitSuffixStart} onChange={(e) => setSplitSuffixStart(Number(e.target.value) || 0)} />
                        </div>
                        <div className="form-group">
                          <label>桁数</label>
                          <input type="number" min={1} max={5} value={splitSuffixDigits} onChange={(e) => setSplitSuffixDigits(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} />
                        </div>
                      </div>
                    </details>
                  </>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="epub-wizard-form">
                <p className="epub-wizard-lead">内容を確認して書き出します。</p>
                <dl className="epub-wizard-summary">
                  <dt>タイトル</dt><dd>{title || '—'}{titleFileAs && `（${titleFileAs}）`}</dd>
                  <dt>著者</dt><dd>{authors.filter((a) => a.name.trim()).map((a) => a.name).join('、') || '—'}</dd>
                  <dt>出版社</dt><dd>{publisher}</dd>
                  <dt>形式</dt><dd>{FORMAT_PRESETS.find((p) => p.value === outputFormat)?.label}</dd>
                  <dt>色</dt><dd>{colorMode === 'auto' ? 'おまかせ' : EPUB_IMAGE_COLOR_POLICY_LABELS[imageColorPolicy]}</dd>
                  <dt>表紙 / 奥付</dt><dd>{coverPage ? `p${epubPages.indexOf(coverPage) + 1}` : '自動'} / {colophonPage ? `p${epubPages.indexOf(colophonPage) + 1}` : '自動'}</dd>
                  <dt>読む向き</dt><dd>{pageDirection === 'rtl' ? '右開き' : '左開き'}</dd>
                  <dt>分割</dt><dd>{splitEnabled ? `話ごと（${splitRanges.length}冊）` : '1冊にまとめる'}</dd>
                  <dt>ページ数</dt><dd>{totalPages}ページ</dd>
                </dl>
                <div className="form-group">
                  <label>保存先 <span className="req">必須</span></label>
                  <div className="input-with-button">
                    <input type="text" value={outputPath} readOnly placeholder="保存先を選択..." />
                    <button className="btn-secondary btn-small" onClick={handleSelectOutput}>参照</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <footer className="epub-wizard-footer">
            <div className="epub-wizard-footer-msg">{currentError}</div>
            <div className="epub-wizard-footer-actions">
              <button className="btn-danger" onClick={onClose} disabled={isGenerating}>キャンセル</button>
              {step > 0 && <button className="btn-secondary" onClick={goBack} disabled={isGenerating}>戻る</button>}
              {step < STEPS.length - 1 ? (
                <button className="btn-primary" onClick={goNext} disabled={!!currentError}>次へ</button>
              ) : (
                <button className="btn-primary epub-wizard-generate" onClick={handleGenerate} disabled={!canGenerate}>
                  {isGenerating ? 'EPUB生成中…' : 'EPUBを生成'}
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>

      {isGenerating && (
        <div className="epub-wizard-progress">
          <div className="epub-progress-dialog">
            <div className="epub-progress-title">EPUB生成中</div>
            <div className="epub-progress-phase">
              {progress?.phase === 'psd-to-jpeg' ? 'PSDをJPEGに変換中…'
                : progress?.phase === 'epubcheck' ? 'EPUBを検証中…'
                : progress?.phase === 'packaging' ? 'EPUBを梱包中…'
                : progress?.phase === 'images' && progress.total > 0 ? `画像を変換中… ${progress.current}/${progress.total}`
                : '準備中…'}
            </div>
            <div className="epub-progress-bar-track">
              <div className={`epub-progress-bar-fill ${progress?.phase === 'images' && progress.total > 0 ? '' : 'indeterminate'}`}
                style={progress?.phase === 'images' && progress.total > 0 ? { width: `${Math.round((progress.current / progress.total) * 100)}%` } : undefined} />
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
