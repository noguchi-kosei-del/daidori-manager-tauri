import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
  EpubColorEngine,
  EpubSplitSettings,
  EPUB_FORMAT_VIEWPORTS,
  EPUB_CUSTOM_CHAPTER_OPTIONS,
  EPUB_CUSTOM_CHAPTER_LABELS,
  HYBRID_CSS_PROFILE_LABELS,
  AUTHOR_ROLE_LABELS,
  Chapter,
  ChapterType,
  CHAPTER_TYPE_LABELS,
} from '../../types';
import { useStore } from '../../store';
import { splitVolumeKey } from '../../utils/epubState';
import { BookIcon, CheckIcon2, NoPageIcon } from '../../icons';
import { EpubFolderTree } from './EpubFolderTree';

// PSD→JPEG中間変換エンジンの切替UI（高速ネイティブ／高品質Photoshop）は当面UI非表示。
// 既定は高速(ネイティブ)。高品質(Photoshop)の機能・ロジックは保持（true で再表示）。
const SHOW_PSD_ENGINE_PICKER = false;

const PUBLISHER_OPTIONS = [
  { name: 'CLLENN', fileAs: 'シレン' },
  { name: 'DEEPER-ZERO', fileAs: 'ディーパーゼロ' },
];

const FORMAT_PRESETS: { value: EpubFormat; label: string; sub: string; recommended?: boolean }[] = [
  { value: 'kadokawa', label: '標準', sub: '主要な電子書店に対応・電書協準拠', recommended: true },
  { value: 'hybrid', label: '幅広い端末対応', sub: '古い端末も含めて広くカバー（Hybrid）' },
  { value: 'oebps', label: 'シンプル', sub: '最小構成（OEBPS）' },
];

const STEPS = ['本の情報', '表紙・奥付', '仕上がり', '分割', '確認して書き出し'];

// EPUBファイル名として使えるよう Windows 禁止文字・末尾の空白/ドットを除去する
function sanitizeEpubFileName(name: string): string {
  const cleaned = (name.trim() || 'output')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '');
  return cleaned || 'output';
}

interface EpubWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (metadata: EpubMetadata, outputPath: string, splitSettings?: EpubSplitSettings, outputJpeg?: boolean, workFolderName?: string) => void | Promise<void>;
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
  // 19.3 実験: PSD→JPEG中間変換のエンジン。既定は高速ネイティブ。
  const [colorEngine, setColorEngine] = useState<EpubColorEngine>('native');
  const [colorMode, setColorMode] = useState<'auto' | 'custom'>('auto');
  // 確認ステップ: EPUBと同時に JPEG（全ページ）も <作品名>/JPEG へ書き出すか
  const [outputJpeg, setOutputJpeg] = useState(false);
  // 作品フォルダ名はタイトルと同一にするため、独立した状態は持たない（effectiveWorkName で算出）。
  // カスタム: チャプター種別ごとのプロファイル指定（未指定は 'auto'）
  const [customChapterProfiles, setCustomChapterProfiles] = useState<Partial<Record<ChapterType, EpubPageImageProfileOverride>>>({});
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
  // 出力先は固定フォルダ（Script_Output/台割出力）。ファイル名（primaryBaseName）から自動導出する。
  const [outputPath, setOutputPath] = useState('');
  const [defaultEpubDir, setDefaultEpubDir] = useState('');

  // カスタムで表示する「登録済みチャプター種別」（台割に存在する種別のみ・規定順）
  const presentChapterTypes = useMemo<ChapterType[]>(() => {
    const order: ChapterType[] = ['cover', 'title', 'toc', 'chapter', 'intermission', 'colophon', 'ad', 'blank'];
    const present = new Set(chapters.map((c) => c.type));
    return order.filter((t) => present.has(t));
  }, [chapters]);

  // 分割
  const [splitEnabled, setSplitEnabled] = useState(false);
  // 「両方作成」: 分割版に加えて1冊にまとめた版も同時に作成する（splitEnabled=true のときのみ意味を持つ）
  const [splitAlsoWhole, setSplitAlsoWhole] = useState(false);
  const [splitRanges, setSplitRanges] = useState<{ startIndex: number; endIndex: number }[]>([]);
  const [splitSelectingStart, setSplitSelectingStart] = useState<number | null>(null);
  // ファイル名は「作品名 + sumafo_ep + 話数」で構成（"sumafo_ep" は固定）。
  // 作品名は1冊版/分冊版で独立。話数（ep）は両者で連動（共通の状態を使う）。
  const [epubWorkName, setEpubWorkName] = useState('');     // 1冊版の作品名
  const [splitWorkName, setSplitWorkName] = useState('');   // 分冊版の作品名
  const [episode, setEpisode] = useState('');               // 話数（ep）：1冊版・分冊版で共通
  // 分冊版の連番は「-1, -2, …」固定（区切り '-' / 開始 1 / 桁数 1）。
  const [splitSuffixStart] = useState(1);
  const [splitSuffixDigits] = useState(1);
  const [splitSuffixSeparator] = useState('-');

  // 合成ファイルベース名（"sumafo_ep" は固定リテラル、話数は共通）。作品名は1冊版/分冊版で独立。
  const singleBaseName = `${epubWorkName.trim()}sumafo_ep${episode.trim()}`;
  const splitBaseName = `${splitWorkName.trim()}sumafo_ep${episode.trim()}`;
  // 保存ファイル名（outputPath）の基準: 分冊版のみのときは分冊版名、それ以外は1冊版名。
  const primaryBaseName = splitEnabled && !splitAlsoWhole ? splitBaseName : singleBaseName;
  // 巻ごとのタイトル・読み仮名（rangesと同じindexで対応）
  const [splitTitles, setSplitTitles] = useState<string[]>([]);
  const [splitTitleFileAsList, setSplitTitleFileAsList] = useState<string[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null);

  // 作品フォルダ名: 未入力時は保存先 .epub のファイル名から導出（プレビュー/既定表示用）
  const epubBaseForUi =
    (outputPath.split(/[\\/]/).pop() || '').replace(/\.epub$/i, '') || projectName || '新規プロジェクト';
  // 作品フォルダ名はタイトルと同一にする（タイトル未入力時のみファイル名ベースにフォールバック）。
  const effectiveWorkName = title.trim() || epubBaseForUi;

  // ファイル名プレビュー（1冊版＝<名前>.epub / 分冊版＝<名前>-1.epub …）
  const fileBaseSanitized = sanitizeEpubFileName(splitBaseName.trim() || projectName || 'output');
  const splitSuffixPreview = `${splitSuffixSeparator}${String(splitSuffixStart).padStart(splitSuffixDigits, '0')}`;

  // EPUBファイル名の合成入力行（作品名 + 固定 sumafo_ep + 話数 [+ -分冊番号] + .epub）。
  // 作品名は行ごとに独立、話数（ep）は共通の state（episode）を編集＝1冊版/分冊版で連動。
  const renderFilenameRow = (
    workName: string,
    setWorkName: (v: string) => void,
    withVolumeSuffix: boolean,
    label?: string,
  ) => (
    <div className="epub-filename-compose">
      {label && <span className="epub-filename-rowlabel">{label}</span>}
      <input
        type="text"
        value={workName}
        onChange={(e) => setWorkName(e.target.value)}
        placeholder="作品名"
      />
      <span className="epub-filename-fixed">sumafo_ep</span>
      <input
        type="text"
        className="epub-filename-episode"
        value={episode}
        onChange={(e) => setEpisode(e.target.value)}
        placeholder="話数"
      />
      {withVolumeSuffix && <span className="epub-filename-fixed">-分冊番号</span>}
      <span className="input-suffix">.epub</span>
    </div>
  );

  // store（表紙/奥付・プレビューページ）
  const epubPages = useStore((s) => s.epubPages);
  const epubSelectedPageId = useStore((s) => s.epubSelectedPageId);
  const setEpubSelectedPageId = useStore((s) => s.setEpubSelectedPageId);
  const setEpubPageAsCover = useStore((s) => s.setEpubPageAsCover);
  const setEpubPageAsColophon = useStore((s) => s.setEpubPageAsColophon);
  const clearEpubPageCover = useStore((s) => s.clearEpubPageCover);
  const clearEpubPageColophon = useStore((s) => s.clearEpubPageColophon);
  const loadEpubFromDaidori = useStore((s) => s.loadEpubFromDaidori);
  const updateEpubState = useStore((s) => s.updateEpubState);

  // 保存済みEPUB設定をフォームへ反映済みかどうか（反映前に空フォームで上書き保存するのを防ぐ）
  const seededRef = useRef(false);

  const totalPages = chapters.reduce((sum, ch) => sum + ch.pages.length, 0);

  const resolveAvailableOutputPath = async (path: string): Promise<string> => {
    try {
      return await invoke<string>('get_available_epub_output_path', { outputPath: path });
    } catch {
      return path;
    }
  };

  // 開いたら台割→EPUBページへ同期＋初期値
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = false;
      return;
    }
    loadEpubFromDaidori();
    setStep(0);

    // 保存済みのEPUB設定があれば優先的にフォームへ反映（プロジェクト読込後の再生成で消えないように）
    const saved = useStore.getState().epubState;
    if (saved?.title !== undefined) setTitle(saved.title);
    if (saved?.titleFileAs !== undefined) setTitleFileAs(saved.titleFileAs);
    if (saved?.publisher) setPublisher(saved.publisher);
    if (saved?.publisherFileAs) setPublisherFileAs(saved.publisherFileAs);
    if (saved?.authors?.length) setAuthors(saved.authors);
    if (saved?.outputFormat) setOutputFormat(saved.outputFormat);
    if (saved?.imageColorPolicy) setImageColorPolicy(saved.imageColorPolicy);
    if (saved?.customChapterProfiles) {
      setCustomChapterProfiles(saved.customChapterProfiles);
      if (Object.values(saved.customChapterProfiles).some((v) => v && v !== 'auto')) {
        setColorMode('custom');
      }
    }
    // UI非表示中は保存値に関わらず既定(native)を維持。picker再表示時のみ復元する。
    if (SHOW_PSD_ENGINE_PICKER && saved?.colorEngine) setColorEngine(saved.colorEngine);
    if (saved?.hybridCssProfile) setHybridCssProfile(saved.hybridCssProfile);
    if (saved?.allowMissingColophon !== undefined) setAllowMissingColophon(saved.allowMissingColophon);
    if (saved?.pageDirection) setPageDirection(saved.pageDirection);
    if (saved?.viewportWidth) setViewportWidth(saved.viewportWidth);
    if (saved?.viewportHeight) setViewportHeight(saved.viewportHeight);
    if (saved?.singleBaseName) {
      // 保存された1冊版「作品名sumafo_ep話数」を作品名/話数へ分解（固定の "sumafo_ep" で分割）
      const m = saved.singleBaseName.match(/^(.*)sumafo_ep(.*)$/);
      if (m) { setEpubWorkName(m[1]); setEpisode(m[2]); }
      else { setEpubWorkName(saved.singleBaseName); }
    }
    if (saved?.split) {
      const sp = saved.split;
      setSplitEnabled(sp.enabled);
      setSplitAlsoWhole(sp.alsoWhole ?? false);
      setSplitRanges(sp.ranges ?? []);
      if (sp.baseName) {
        // 保存された分冊版「作品名sumafo_ep話数」を作品名/話数へ分解（固定の "sumafo_ep" で分割）
        const m = sp.baseName.match(/^(.*)sumafo_ep(.*)$/);
        if (m) { setSplitWorkName(m[1]); setEpisode(m[2]); }
        else { setSplitWorkName(sp.baseName); }
      }
      // 巻ごとのタイトル・読みを安定キーで復元
      if (sp.ranges?.length) {
        const volumeAt = (i: number) => {
          const key = splitVolumeKey(
            sp.baseName ?? '',
            sp.suffixSeparator ?? '_',
            sp.suffixStart ?? 1,
            sp.suffixDigits ?? 3,
            i,
          );
          return sp.volumes?.find((v) => v.key === key);
        };
        setSplitTitles(sp.ranges.map((_, i) => volumeAt(i)?.title ?? ''));
        setSplitTitleFileAsList(sp.ranges.map((_, i) => volumeAt(i)?.titleFileAs ?? ''));
      }
    }

    // 既定名「新規プロジェクト」はタイトルに流し込まず、プレースホルダ（作品タイトル）を表示する
    const meaningfulName = projectName && projectName !== '新規プロジェクト' ? projectName : '';
    if (saved?.title === undefined && !title && meaningfulName) setTitle(meaningfulName);
    if (!saved?.singleBaseName && meaningfulName) setEpubWorkName(meaningfulName);
    if (!saved?.split?.baseName && meaningfulName) setSplitWorkName(meaningfulName);
    // UUID: 保存値があれば固定で再利用（同じ本の更新版で識別子を維持）。なければ新規発行。
    if (saved?.bookUuid) {
      setBookUuid(saved.bookUuid);
    } else if (!bookUuid) {
      invoke<string>('generate_book_uuid').then(setBookUuid).catch(() => {});
    }
    if (!defaultEpubDir) {
      (async () => {
        try {
          // 既定の保存先フォルダ: <Desktop>\Script_Output\台割出力（JPG/TIFFと同じ「台割出力」配下）
          const desktop = await desktopDir();
          const epubDir = await join(desktop, 'Script_Output', '台割出力');
          await invoke('ensure_dir', { path: epubDir }).catch(() => {});
          setDefaultEpubDir(epubDir);
        } catch { /* ignore */ }
      })();
    }
    seededRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 出力先パスを基準ファイル名（primaryBaseName）＋既定フォルダから自動導出する。
  // 保存ダイアログは廃止し、Script_Output/台割出力 に「<ファイル名>.epub」で保存する。
  // 同名衝突時の (1) 付与は生成時（handleGenerate の resolveAvailableOutputPath）で処理する。
  useEffect(() => {
    if (!isOpen || !defaultEpubDir) return;
    let cancelled = false;
    (async () => {
      const name = sanitizeEpubFileName(primaryBaseName.trim() || projectName || 'output');
      const path = await join(defaultEpubDir, `${name}.epub`);
      if (!cancelled) setOutputPath(path);
    })();
    return () => { cancelled = true; };
  }, [isOpen, defaultEpubDir, primaryBaseName, projectName]);

  // フォームの変更をプロジェクト保存用の epubState に同期（入力した内容が保存・再生成で残るように）。
  // seededRef が立つまで（保存値の反映前）は書き込まない。volumes は handleEpubGenerate 管理なので維持する。
  useEffect(() => {
    if (!isOpen || !seededRef.current) return;
    const prevVolumes = useStore.getState().epubState?.split?.volumes ?? [];
    // 現在の範囲ぶんの巻情報（タイトル/読みは入力値、UUIDは保存値を温存）
    const currentVolumes = splitRanges.map((_, i) => {
      const key = splitVolumeKey(splitBaseName, splitSuffixSeparator, splitSuffixStart, splitSuffixDigits, i);
      return {
        key,
        title: splitTitles[i]?.trim() || undefined,
        titleFileAs: splitTitleFileAsList[i]?.trim() || undefined,
        bookUuid: prevVolumes.find((v) => v.key === key)?.bookUuid,
      };
    });
    // 範囲編集に備えて、今回使っていないキーの巻情報（過去のUUID）も温存する
    const retainedVolumes = prevVolumes.filter((v) => !currentVolumes.some((c) => c.key === v.key));
    updateEpubState({
      bookUuid: bookUuid || undefined,
      title,
      titleFileAs: titleFileAs || undefined,
      authors,
      publisher,
      publisherFileAs: publisherFileAs || undefined,
      language,
      outputFormat,
      pageDirection,
      spreadMode,
      viewportWidth,
      viewportHeight,
      hybridCssProfile,
      allowMissingColophon,
      imageColorPolicy: colorMode === 'auto' ? 'auto' : imageColorPolicy,
      customChapterProfiles: colorMode === 'custom' ? customChapterProfiles : undefined,
      colorEngine,
      singleBaseName,
      split: {
        enabled: splitEnabled,
        alsoWhole: splitAlsoWhole,
        baseName: splitBaseName,
        suffixStart: splitSuffixStart,
        suffixDigits: splitSuffixDigits,
        suffixSeparator: splitSuffixSeparator,
        ranges: splitRanges,
        volumes: [...currentVolumes, ...retainedVolumes],
      },
    });
  }, [
    isOpen,
    bookUuid,
    title,
    titleFileAs,
    authors,
    publisher,
    publisherFileAs,
    language,
    outputFormat,
    pageDirection,
    spreadMode,
    viewportWidth,
    viewportHeight,
    hybridCssProfile,
    allowMissingColophon,
    colorMode,
    imageColorPolicy,
    customChapterProfiles,
    colorEngine,
    splitEnabled,
    splitAlsoWhole,
    singleBaseName,
    splitBaseName,
    splitSuffixStart,
    splitSuffixDigits,
    splitSuffixSeparator,
    splitRanges,
    splitTitles,
    splitTitleFileAsList,
    updateEpubState,
  ]);

  // 生成進捗
  useEffect(() => {
    if (!isGenerating) return;
    const unlistenEpub = listen<{ phase: string; current: number; total: number }>('epub-progress', (e) => setProgress(e.payload));
    // PSD→JPEG / TIFF変換中はネイティブ変換が jpeg-convert-progress を発火する。
    // フェーズ表示は epub-progress を維持しつつ件数だけ更新し、「0/Nで止まって見える」のを防ぐ。
    const unlistenConv = listen<{ phase: string; current: number; total: number }>('jpeg-convert-progress', (e) =>
      setProgress((p) => (p ? { ...p, current: e.payload.current, total: e.payload.total } : p)),
    );
    return () => {
      unlistenEpub.then((fn) => fn());
      unlistenConv.then((fn) => fn());
    };
  }, [isGenerating]);

  // 分割範囲の増減に合わせて巻タイトル配列を整える（未入力の巻のみ既定名を補完）
  useEffect(() => {
    if (!splitEnabled) return;
    const baseTitle = title.trim() || splitBaseName.trim() || 'output';
    setSplitTitles((current) =>
      splitRanges.map((_, index) => {
        if (current[index]?.trim()) return current[index];
        const suffixNumber = splitSuffixStart + index;
        const suffix = String(suffixNumber).padStart(splitSuffixDigits, '0');
        return `${baseTitle}${splitSuffixSeparator}${suffix}`;
      })
    );
    setSplitTitleFileAsList((current) => splitRanges.map((_, index) => current[index] ?? ''));
  }, [splitEnabled, splitRanges, splitSuffixStart, splitSuffixDigits, splitSuffixSeparator, splitBaseName, title]);

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

  // UUID再生成（明示操作のみ。同期effectで epubState にも保存される）
  const regenerateUuid = async () => {
    try {
      setBookUuid(await invoke<string>('generate_book_uuid'));
    } catch { /* ignore */ }
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
    if (ri >= 0) {
      setSplitRanges((rs) => rs.filter((_, i) => i !== ri));
      setSplitTitles((ts) => ts.filter((_, i) => i !== ri));
      setSplitTitleFileAsList((ts) => ts.filter((_, i) => i !== ri));
      setSplitSelectingStart(null);
      return;
    }
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
      // 作品名は作る対象ごとに必須（1冊版/分冊版で独立）。話数（ep）は共通で必須。
      const needsSingle = !splitEnabled || splitAlsoWhole;
      const needsSplit = splitEnabled;
      if (needsSingle && !epubWorkName.trim()) return '1冊版の作品名を入力してください';
      if (needsSplit && !splitWorkName.trim()) return '分冊版の作品名を入力してください';
      if (!episode.trim()) return '話数を入力してください';
      if (!title.trim()) return 'タイトルを入力してください';
      if (authors.length === 0 || !authors[0].name.trim()) return '著者を1人以上入力してください';
    }
    if (s === 3 && splitEnabled && splitRanges.length === 0) return '分割範囲を1つ以上選択してください';
    if (s === 4 && !outputPath) return '保存先フォルダを準備中です。少し待ってから再度お試しください';
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
      customChapterProfiles: colorMode === 'custom' ? customChapterProfiles : undefined,
      colorEngine,
      // 断ち切りは「断ち切り」タブ(bleedStore)に一本化。App側で参照する。
    };
    try {
      const resolvedOutputPath = await resolveAvailableOutputPath(outputPath);
      if (resolvedOutputPath !== outputPath) setOutputPath(resolvedOutputPath);
      const splitConfig = splitEnabled ? {
        enabled: true,
        // 「両方作成」は1回の生成内で分割版＋1冊版を出力する（TIFF/Projectを重複生成しないため）
        alsoWhole: splitAlsoWhole,
        ranges: splitRanges,
        baseName: splitBaseName.trim() || projectName || 'output',
        titles: splitRanges.map((_, i) => splitTitles[i]?.trim() || title.trim()),
        titleFileAsList: splitRanges.map((_, i) => splitTitleFileAsList[i]?.trim() || titleFileAs.trim()),
        suffixStart: splitSuffixStart,
        suffixDigits: splitSuffixDigits,
        suffixSeparator: splitSuffixSeparator,
      } : undefined;
      await onGenerate(metadata, resolvedOutputPath, splitConfig, outputJpeg, effectiveWorkName);
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
                <p className="epub-wizard-lead">EPUBのファイル名・冊数を決めてから、ストアに表示される情報を入力します。</p>
                <div className="form-group">
                  <label>冊数</label>
                  <div className="epub-wizard-seg epub-wizard-seg-wide">
                    <button className={!splitEnabled ? 'active' : ''} onClick={() => { setSplitEnabled(false); setSplitAlsoWhole(false); }}>1冊版</button>
                    <button className={splitEnabled && !splitAlsoWhole ? 'active' : ''} onClick={() => { setSplitEnabled(true); setSplitAlsoWhole(false); }}>分冊版（話ごと）</button>
                    <button className={splitEnabled && splitAlsoWhole ? 'active' : ''} onClick={() => { setSplitEnabled(true); setSplitAlsoWhole(true); }}>両方作成</button>
                  </div>
                </div>
                <div className="form-group">
                  <label>EPUBファイル名 <span className="req">必須</span></label>
                  {splitEnabled && splitAlsoWhole ? (
                    <>
                      {renderFilenameRow(epubWorkName, setEpubWorkName, false, '1冊版')}
                      {renderFilenameRow(splitWorkName, setSplitWorkName, true, '分冊版')}
                    </>
                  ) : splitEnabled ? (
                    renderFilenameRow(splitWorkName, setSplitWorkName, true)
                  ) : (
                    renderFilenameRow(epubWorkName, setEpubWorkName, false)
                  )}
                </div>
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
                  <span className="form-hint">プレビューの並びは読む向きに合わせて自動で左右反転します（右開き＝右→左）。</span>
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
                  <div className={`epub-wizard-thumbgrid ${pageDirection === 'rtl' ? 'flipped' : ''}`}>
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
                <p className="epub-wizard-lead">どの形式で書き出すかを選びます。迷ったら「標準」のままでOKです。</p>
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
                    <button className={colorMode === 'custom' ? 'active' : ''} onClick={() => setColorMode('custom')}>カスタム</button>
                  </div>
                  <div className="form-hint">おまかせ＝本文はモノクロを維持し、カラーページは電子書籍向け（sRGB）に整えます。</div>
                </div>
                {colorMode === 'custom' && (
                  <div className="form-group">
                    <label>カスタム（チャプター種別ごとに指定）</label>
                    {presentChapterTypes.length === 0 ? (
                      <div className="form-hint">台割にチャプターがありません。</div>
                    ) : (
                      presentChapterTypes.map((ct) => (
                        <div key={ct} className="epub-wizard-custom-row">
                          <span className="epub-wizard-custom-label">{CHAPTER_TYPE_LABELS[ct]}</span>
                          <div className="epub-wizard-seg">
                            {EPUB_CUSTOM_CHAPTER_OPTIONS.map((opt) => {
                              const current = customChapterProfiles[ct] ?? 'auto';
                              return (
                                <button
                                  key={opt}
                                  className={current === opt ? 'active' : ''}
                                  onClick={() => setCustomChapterProfiles((cur) => ({ ...cur, [ct]: opt }))}
                                >
                                  {EPUB_CUSTOM_CHAPTER_LABELS[opt]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                    <div className="form-hint">自動＝本文モノクロ／カラーsRGBを判定／モノクロ＝Dot Gain付与／カラー＝sRGB／そのまま＝変換なし。</div>
                  </div>
                )}
                {SHOW_PSD_ENGINE_PICKER && (
                <div className="form-group">
                  <label>PSD変換の画質（19.3 実験）</label>
                  <div className="epub-wizard-seg">
                    <button className={colorEngine === 'native' ? 'active' : ''} onClick={() => setColorEngine('native')}>高速（ネイティブ）</button>
                    <button className={colorEngine === 'photoshop' ? 'active' : ''} onClick={() => setColorEngine('photoshop')}>高品質（Photoshop）</button>
                  </div>
                  <div className="form-hint">高速＝内蔵エンジンでPSDをJPEG化（ICC埋め込みのみ）。高品質＝Photoshopの「プロファイル変換」でsRGBへ厳密に色変換（相対的な色域を維持＋黒点補正）。Photoshop未インストール時は自動で高速に切替。</div>
                </div>
                )}
                {SHOW_PSD_ENGINE_PICKER && colorEngine === 'photoshop' && (
                  <div className="form-group">
                    <label>断ち切り</label>
                    <div className="form-hint">
                      断ち切りは「断ち切り」タブで設定します（方式: 範囲 / アクションの比率 / アクションそのまま）。EPUBは高品質（Photoshop）時にその設定で断ち切られます。
                    </div>
                  </div>
                )}
                {outputFormat === 'hybrid' && (
                  <details className="epub-advanced">
                    <summary>詳細設定</summary>
                    <div className="form-group">
                      <label>Hybrid CSS</label>
                      <select value={hybridCssProfile} onChange={(e) => { setHybridCssProfile(e.target.value as HybridCssProfile); if (e.target.value === 'legacy') setAllowMissingColophon(true); }}>
                        {(Object.keys(HYBRID_CSS_PROFILE_LABELS) as HybridCssProfile[]).map((p) => (
                          <option key={p} value={p}>{HYBRID_CSS_PROFILE_LABELS[p]}</option>
                        ))}
                      </select>
                    </div>
                  </details>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="epub-wizard-form">
                {!splitEnabled ? (
                  <div className="epub-wizard-split-guide">「本の情報」で「1冊版」が選択されています。分割範囲の指定は不要です（冊数は「本の情報」ステップで変更できます）。</div>
                ) : (
                  <>
                    <p className="epub-wizard-lead">分けたい範囲を指定します。各巻は「{fileBaseSanitized}{splitSuffixPreview}.epub」… と連番で保存されます。</p>
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
                      <div className="epub-split-title-list">
                        {splitRanges.map((r, i) => (
                          <div key={`${r.startIndex}-${r.endIndex}`} className="epub-split-title-row">
                            <div className="epub-split-title-label">
                              <span>{i + 1}巻</span>
                              <small>p{r.startIndex + 1}〜p{r.endIndex + 1}（{r.endIndex - r.startIndex + 1}ページ）</small>
                            </div>
                            <div className="form-group flex-grow">
                              <label>巻タイトル</label>
                              <input
                                type="text"
                                value={splitTitles[i] ?? ''}
                                onChange={(e) => setSplitTitles((cur) => { const next = [...cur]; next[i] = e.target.value; return next; })}
                                placeholder="EPUB内の作品タイトル"
                              />
                            </div>
                            <div className="form-group flex-grow">
                              <label>読み仮名</label>
                              <input
                                type="text"
                                value={splitTitleFileAsList[i] ?? ''}
                                onChange={(e) => setSplitTitleFileAsList((cur) => { const next = [...cur]; next[i] = e.target.value; return next; })}
                                placeholder="未入力なら共通設定を使用"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="epub-wizard-form epub-confirm-layout">
                <EpubFolderTree
                  outputPath={outputPath}
                  workFolderName={effectiveWorkName}
                  splitEnabled={splitEnabled}
                  splitCount={splitRanges.length}
                  splitAlsoWhole={splitAlsoWhole}
                  outputJpeg={outputJpeg}
                />
                <div className="epub-confirm-main">
                <p className="epub-wizard-lead">内容を確認して書き出します。</p>
                <dl className="epub-wizard-summary">
                  <dt>タイトル</dt><dd>{title || '—'}{titleFileAs && `（${titleFileAs}）`}</dd>
                  <dt>著者</dt><dd>{authors.filter((a) => a.name.trim()).map((a) => a.name).join('、') || '—'}</dd>
                  <dt>出版社</dt><dd>{publisher}</dd>
                  <dt>形式</dt><dd>{FORMAT_PRESETS.find((p) => p.value === outputFormat)?.label}</dd>
                  <dt>色</dt><dd>{colorMode === 'auto' ? 'おまかせ' : 'カスタム（種別ごと）'}</dd>
                  <dt>表紙 / 奥付</dt><dd>{coverPage ? `p${epubPages.indexOf(coverPage) + 1}` : '自動'} / {colophonPage ? `p${epubPages.indexOf(colophonPage) + 1}` : '自動'}</dd>
                  <dt>読む向き</dt><dd>{pageDirection === 'rtl' ? '右開き' : '左開き'}</dd>
                  <dt>冊数</dt><dd>{splitEnabled ? (splitAlsoWhole ? `両方作成（分冊${splitRanges.length}冊＋1冊版）` : `分冊版（${splitRanges.length}冊）`) : '1冊版'}</dd>
                  <dt>ページ数</dt><dd>{totalPages}ページ</dd>
                </dl>
                <div className="form-group">
                  <label>保存先（自動）</label>
                  <input type="text" value={outputPath} readOnly />
                </div>
                <div className="form-group">
                  <label>作品フォルダ名（タイトルと同一）</label>
                  <input type="text" value={effectiveWorkName} readOnly />
                </div>
                <label className="checkbox-label epub-jpeg-option">
                  <input type="checkbox" checked={outputJpeg} onChange={(e) => setOutputJpeg(e.target.checked)} />
                  <span className="epub-jpeg-option-text">
                    JPEGも生成する
                    <span className="option-note">EPUBと同時に全ページのJPEGを「作品フォルダ/JPEG」へ書き出します</span>
                  </span>
                </label>
                <details className="epub-advanced">
                  <summary>識別子（UUID・通常そのまま）</summary>
                  <div className="form-group">
                    <label>本の識別番号（UUID）</label>
                    <div className="input-with-button">
                      <input type="text" value={bookUuid} readOnly className="uuid-input" />
                      <button className="btn-secondary btn-small" onClick={regenerateUuid}>再生成</button>
                    </div>
                    <div className="form-hint">
                      プロジェクトに保存され、同じ本の更新版では同じUUIDが使われます。別の本として配信する場合のみ再生成してください。
                    </div>
                  </div>
                </details>
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
              {progress?.phase === 'psd-to-jpeg' ? `PSDをJPEGに変換中…${progress.total > 0 ? ` ${progress.current}/${progress.total}` : ''}`
                : progress?.phase === 'tiff' ? `TIFFを書き出し中…${progress.total > 0 ? ` ${progress.current}/${progress.total}` : ''}`
                : progress?.phase === 'epubcheck' ? 'EPUBを検証中…'
                : progress?.phase === 'packaging' ? 'EPUBを梱包中…'
                : progress?.phase === 'images' && progress.total > 0 ? `画像を変換中… ${progress.current}/${progress.total}`
                : '準備中…'}
            </div>
            <div className="epub-progress-bar-track">
              <div className={`epub-progress-bar-fill ${(progress?.phase === 'images' || progress?.phase === 'psd-to-jpeg' || progress?.phase === 'tiff') && progress.total > 0 ? '' : 'indeterminate'}`}
                style={(progress?.phase === 'images' || progress?.phase === 'psd-to-jpeg' || progress?.phase === 'tiff') && progress.total > 0 ? { width: `${Math.round((progress.current / progress.total) * 100)}%` } : undefined} />
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
