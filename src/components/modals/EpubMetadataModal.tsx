import { useState, useEffect, useMemo, useCallback } from 'react';
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
  EpubPageImageProfileOverride,
  EpubSplitSettings,
  EPUB_IMAGE_COLOR_POLICY_OPTIONS,
  EPUB_FORMAT_LABELS,
  EPUB_FORMAT_VIEWPORTS,
  HYBRID_CSS_PROFILE_LABELS,
  EPUB_IMAGE_COLOR_POLICY_LABELS,
  EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_OPTIONS,
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
  onGenerate: (metadata: EpubMetadata, outputPath: string, splitSettings?: EpubSplitSettings) => void | Promise<void>;
  chapters: Chapter[];
  projectName: string;
  embedded?: boolean;
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
  embedded = false,
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

  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitRanges, setSplitRanges] = useState<{ startIndex: number; endIndex: number }[]>([]);
  const [splitSelectingStart, setSplitSelectingStart] = useState<number | null>(null);
  const [splitBaseName, setSplitBaseName] = useState('');
  const [splitTitles, setSplitTitles] = useState<string[]>([]);
  const [splitTitleFileAsList, setSplitTitleFileAsList] = useState<string[]>([]);
  const [splitSuffixStart, setSplitSuffixStart] = useState(1);
  const [splitSuffixDigits, setSplitSuffixDigits] = useState(3);
  const [splitSuffixSeparator, setSplitSuffixSeparator] = useState('_');
  const [splitContextMenu, setSplitContextMenu] = useState<{ x: number; y: number; pageId: string } | null>(null);

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
  const setEpubPageAsCover = useStore((s) => s.setEpubPageAsCover);
  const setEpubPageAsColophon = useStore((s) => s.setEpubPageAsColophon);
  const clearEpubPageCover = useStore((s) => s.clearEpubPageCover);
  const clearEpubPageColophon = useStore((s) => s.clearEpubPageColophon);
  const setEpubPageImageProfileOverride = useStore((s) => s.setEpubPageImageProfileOverride);
  const loadEpubFromDaidori = useStore((s) => s.loadEpubFromDaidori);

  // モーダル開閉と chapters 変化に同期して台割→EPUBページ変換を実行
  useEffect(() => {
    if (isOpen) {
      loadEpubFromDaidori();
    }
  }, [isOpen, chapters, loadEpubFromDaidori]);

  useEffect(() => {
    if (!isOpen) return;
    const preventNativeContextMenu = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.epub-modal')) {
        event.preventDefault();
      }
    };

    document.addEventListener('contextmenu', preventNativeContextMenu, { capture: true });
    return () => document.removeEventListener('contextmenu', preventNativeContextMenu, { capture: true });
  }, [isOpen]);

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
      if (!splitBaseName && projectName) {
        setSplitBaseName(projectName);
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

  useEffect(() => {
    if (!splitEnabled) return;
    const baseTitle = title.trim() || projectName || splitBaseName.trim() || 'output';
    setSplitTitles((current) =>
      splitRanges.map((_, index) => {
        if (current[index]?.trim()) return current[index];
        const suffixNumber = splitSuffixStart + index;
        const suffix = String(suffixNumber).padStart(splitSuffixDigits, '0');
        return `${baseTitle}${splitSuffixSeparator}${suffix}`;
      })
    );
    setSplitTitleFileAsList((current) =>
      splitRanges.map((_, index) => current[index] ?? '')
    );
  }, [
    splitEnabled,
    splitRanges,
    splitSuffixStart,
    splitSuffixDigits,
    splitSuffixSeparator,
    splitBaseName,
    title,
    projectName,
  ]);

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
    if (splitEnabled && splitRanges.length > 0 && splitRanges.some((_, index) => !splitTitles[index]?.trim())) {
      return '分割範囲ごとのプロジェクト名を入力してください';
    }
    if (!title.trim()) return 'タイトルを入力してください';
    if (!publisher.trim()) return '出版社を入力してください';
    if (authors.length === 0 || !authors[0].name.trim()) {
      return '著者を1人以上入力してください';
    }
    if (!outputPath) return '出力先を選択してください';
    if (splitEnabled) {
      if (splitRanges.length === 0) return '分割出力の範囲を1つ以上選択してください';
      if (!splitBaseName.trim()) return '分割出力のベース名を入力してください';
    }

    // 奥付ページの確認
    const hasColophon = epubPages.some((page) => page.isColophon);
    const canAutoAssignColophon = splitEnabled
      ? splitRanges.every((range) =>
          epubPages
            .slice(range.startIndex, range.endIndex + 1)
            .some((page) => !page.isBlank && !!page.sourcePath)
        )
      : epubPages.some((page) => !page.isBlank && !!page.sourcePath);
    const allowsMissingColophon =
      outputFormat === 'hybrid' && (allowMissingColophon || hybridCssProfile === 'legacy');
    if (!hasColophon && !canAutoAssignColophon && !allowsMissingColophon) {
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
      await onGenerate(
        metadata,
        outputPath,
        splitEnabled
          ? {
              enabled: true,
              ranges: splitRanges,
              baseName: splitBaseName.trim(),
              titles: splitRanges.map((_, index) => splitTitles[index]?.trim() || title.trim()),
              titleFileAsList: splitRanges.map((_, index) => splitTitleFileAsList[index]?.trim() || titleFileAs.trim()),
              suffixStart: splitSuffixStart,
              suffixDigits: splitSuffixDigits,
              suffixSeparator: splitSuffixSeparator,
            }
          : undefined,
      );
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

  const splitAssigned = useMemo(() => {
    const assigned = new Set<number>();
    splitRanges.forEach((range) => {
      for (let i = range.startIndex; i <= range.endIndex; i++) assigned.add(i);
    });
    return assigned;
  }, [splitRanges]);

  const splitPageRoles = useMemo(() => {
    const roles = new Map<number, { cover: boolean; colophon: boolean }>();
    splitRanges.forEach((range) => {
      roles.set(range.startIndex, {
        ...(roles.get(range.startIndex) ?? { cover: false, colophon: false }),
        cover: true,
      });
      roles.set(range.endIndex, {
        ...(roles.get(range.endIndex) ?? { cover: false, colophon: false }),
        colophon: true,
      });
    });
    if (splitSelectingStart !== null && !splitAssigned.has(splitSelectingStart)) {
      roles.set(splitSelectingStart, {
        ...(roles.get(splitSelectingStart) ?? { cover: false, colophon: false }),
        cover: true,
      });
    }
    return roles;
  }, [splitRanges, splitSelectingStart, splitAssigned]);

  const handleSplitPageClick = (index: number) => {
    const rangeIndex = getSplitRangeIndex(index);
    if (rangeIndex >= 0) {
      setSplitRanges((ranges) => ranges.filter((_, i) => i !== rangeIndex));
      setSplitTitles((titles) => titles.filter((_, i) => i !== rangeIndex));
      setSplitTitleFileAsList((titles) => titles.filter((_, i) => i !== rangeIndex));
      setSplitSelectingStart(null);
      return;
    }
    if (splitSelectingStart === null) {
      setSplitSelectingStart(index);
      return;
    }
    if (splitSelectingStart === index) {
      setSplitSelectingStart(null);
      return;
    }

    const startIndex = Math.min(splitSelectingStart, index);
    const endIndex = Math.max(splitSelectingStart, index);
    for (let i = startIndex; i <= endIndex; i++) {
      if (splitAssigned.has(i)) {
        alert(`ページ ${i + 1} は既に別の分割範囲に含まれています`);
        setSplitSelectingStart(null);
        return;
      }
    }

    setSplitRanges((ranges) => [...ranges, { startIndex, endIndex }]);
    setSplitSelectingStart(null);
  };

  const undoSplitRange = () => {
    setSplitRanges((ranges) => ranges.slice(0, -1));
    setSplitTitles((titles) => titles.slice(0, -1));
    setSplitTitleFileAsList((titles) => titles.slice(0, -1));
    setSplitSelectingStart(null);
  };

  const clearSplitRanges = () => {
    setSplitRanges([]);
    setSplitTitles([]);
    setSplitTitleFileAsList([]);
    setSplitSelectingStart(null);
  };

  const updateSplitTitle = (index: number, value: string) => {
    setSplitTitles((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  };

  const updateSplitTitleFileAs = (index: number, value: string) => {
    setSplitTitleFileAsList((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  };

  const getSplitRangeIndex = (pageIndex: number) =>
    splitRanges.findIndex((range) => pageIndex >= range.startIndex && pageIndex <= range.endIndex);

  const getSplitThumbnailSrc = (page: (typeof epubPages)[number]): string | null => {
    if (page.isBlank) return null;
    const imagePath = page.thumbnailPath || page.sourcePath;
    return imagePath.startsWith('data:') ? imagePath : convertFileSrc(imagePath);
  };

  const handleSplitThumbnailClick = (index: number) => {
    const page = epubPages[index];
    if (!page) return;
    setSplitContextMenu(null);
    setEpubSelectedPageId(page.id);
    handleSplitPageClick(index);
  };

  const handleSplitThumbnailContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const page = epubPages[index];
    if (!page) return;
    setEpubSelectedPageId(page.id);
    setSplitContextMenu({ x: e.clientX, y: e.clientY, pageId: page.id });
  };

  const handleSplitContextProfileOverride = (override: EpubPageImageProfileOverride) => {
    if (!splitContextMenu) return;
    setEpubPageImageProfileOverride(splitContextMenu.pageId, override);
    setSplitContextMenu(null);
  };

  const handleSplitContextSetCover = () => {
    if (!splitContextMenu) return;
    setEpubPageAsCover(splitContextMenu.pageId);
    setSplitContextMenu(null);
  };

  const handleSplitContextClearCover = () => {
    clearEpubPageCover();
    setSplitContextMenu(null);
  };

  const handleSplitContextSetColophon = () => {
    if (!splitContextMenu) return;
    setEpubPageAsColophon(splitContextMenu.pageId);
    setSplitContextMenu(null);
  };

  const handleSplitContextClearColophon = () => {
    if (!splitContextMenu) return;
    clearEpubPageColophon(splitContextMenu.pageId);
    setSplitContextMenu(null);
  };

  useEffect(() => {
    if (!splitContextMenu) return;
    const closeMenu = () => setSplitContextMenu(null);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, [splitContextMenu]);

  const handlePreviewSelectPage = useCallback((pageId: string) => {
    setEpubSelectedPageId(pageId);
    if (!splitEnabled) return;

    const pageIndex = epubPages.findIndex((page) => page.id === pageId);
    if (pageIndex >= 0) {
      handleSplitPageClick(pageIndex);
    }
  }, [epubPages, setEpubSelectedPageId, splitEnabled, splitAssigned, splitSelectingStart]);

  const splitSummary = splitRanges.length === 0
    ? `全${epubPages.length}ページ / 分割範囲を選択してください`
    : splitRanges.map((range, idx) => {
        const suffixNumber = splitSuffixStart + idx;
        const fileName = `${splitBaseName || projectName || 'output'}${splitSuffixSeparator}${String(suffixNumber).padStart(splitSuffixDigits, '0')}.epub`;
        const volumeTitle = splitTitles[idx]?.trim() || title.trim() || projectName || 'output';
        return `第${suffixNumber}話: ${volumeTitle} / ${range.endIndex - range.startIndex + 1}P (p${range.startIndex + 1}-${range.endIndex + 1}) / ${fileName}`;
      }).join('\n');

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

  const renderSplitPreviewContent = () => (
    <div className="epub-split-thumbnail-mode">
      <div className="epub-split-preview-guide">
        <span>未分割サムネイルをクリックして範囲作成、分割済みサムネイルをクリックして解除</span>
        <span>
          {splitSelectingStart !== null
            ? `開始: p${splitSelectingStart + 1} / 終了ページを選択`
            : '次の分割範囲の開始ページを選択'}
        </span>
      </div>
      <div className="epub-split-thumbnail-grid" aria-label="分割範囲サムネイル">
        {epubPages.map((page, index) => {
          const rangeIndex = getSplitRangeIndex(index);
          const isAssigned = rangeIndex >= 0;
          const isSelecting = splitSelectingStart === index;
          const splitRole = splitPageRoles.get(index);
          const isRangeCover = splitRole?.cover ?? false;
          const isRangeColophon = splitRole?.colophon ?? false;
          const thumbnailSrc = getSplitThumbnailSrc(page);
          return (
            <button
              key={page.id}
              type="button"
              className={`epub-split-thumbnail ${isAssigned ? 'assigned' : ''} ${isSelecting ? 'selecting' : ''} ${isRangeCover || page.isCover ? 'cover' : ''} ${isRangeColophon || page.isColophon ? 'colophon' : ''} ${epubSelectedPageId === page.id ? 'selected' : ''}`}
              onClick={() => handleSplitThumbnailClick(index)}
              onContextMenu={(e) => handleSplitThumbnailContextMenu(e, index)}
              title={`${index + 1}ページ`}
              style={isAssigned ? { ['--split-color' as string]: `var(--split-color-${rangeIndex % 8})` } : undefined}
            >
              {isAssigned && <span className="epub-split-remove-hint">クリックで解除</span>}
              <span className="epub-split-thumbnail-image">
                {thumbnailSrc ? (
                  <img src={thumbnailSrc} alt="" loading="lazy" />
                ) : (
                  <span className="epub-split-thumbnail-placeholder">{page.isBlank ? '白紙' : 'No Image'}</span>
                )}
              </span>
              <span className="epub-split-thumbnail-meta">
                <span>{index + 1}</span>
                <span className="epub-split-thumbnail-badges">
                  {(page.isCover || isRangeCover) && <span className="cover">表紙</span>}
                  {(page.isColophon || isRangeColophon) && <span className="colophon">奥付</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {splitContextMenu && (
        <div
          className="epub-context-menu"
          style={{ left: splitContextMenu.x, top: splitContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const menuPage = epubPages.find((page) => page.id === splitContextMenu.pageId);
            return (
              <>
                {!menuPage?.isCover ? (
                  <button type="button" onClick={handleSplitContextSetCover}>表紙に設定</button>
                ) : (
                  <button type="button" onClick={handleSplitContextClearCover}>表紙を解除</button>
                )}
                {!menuPage?.isColophon ? (
                  <button type="button" onClick={handleSplitContextSetColophon}>奥付に設定</button>
                ) : (
                  <button type="button" onClick={handleSplitContextClearColophon}>奥付を解除</button>
                )}
                <div className="epub-context-menu-separator" />
              </>
            );
          })()}
          {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_OPTIONS.map((override) => (
            <button
              key={override}
              type="button"
              onClick={() => handleSplitContextProfileOverride(override)}
              className={
                epubPages.find((page) => page.id === splitContextMenu.pageId)?.imageProfileOverride === override
                  ? 'selected'
                  : ''
              }
            >
              ICC: {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS[override]}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const modalContent = (
      <div
        className={`modal-content epub-modal ${embedded ? 'embedded' : ''} ${!embedded && isClosing ? 'closing' : ''}`}
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
          {!embedded && (
          <div className="epub-preview-pane">
            {epubPages.length === 0 ? (
              <div className="spread-viewer-empty">
                <NoPageIcon size={48} />
                <p>ページがありません</p>
              </div>
            ) : (
              splitEnabled ? (
                <div className="epub-split-thumbnail-mode">
                  <div className="epub-split-preview-guide">
                    <span>未分割サムネイルをクリックして範囲作成、分割済みサムネイルをクリックして解除</span>
                    <span>
                      {splitSelectingStart !== null
                        ? `開始: p${splitSelectingStart + 1} / 終了ページを選択`
                        : '次の分割範囲の開始ページを選択'}
                    </span>
                  </div>
                  <div className="epub-split-thumbnail-grid" aria-label="分割範囲サムネイル">
                    {epubPages.map((page, index) => {
                      const rangeIndex = getSplitRangeIndex(index);
                      const isAssigned = rangeIndex >= 0;
                      const isSelecting = splitSelectingStart === index;
                      const splitRole = splitPageRoles.get(index);
                      const isRangeCover = splitRole?.cover ?? false;
                      const isRangeColophon = splitRole?.colophon ?? false;
                      const thumbnailSrc = getSplitThumbnailSrc(page);
                      return (
                        <button
                          key={page.id}
                          type="button"
                          className={`epub-split-thumbnail ${isAssigned ? 'assigned' : ''} ${isSelecting ? 'selecting' : ''} ${isRangeCover || page.isCover ? 'cover' : ''} ${isRangeColophon || page.isColophon ? 'colophon' : ''} ${epubSelectedPageId === page.id ? 'selected' : ''}`}
                          onClick={() => handleSplitThumbnailClick(index)}
                          onContextMenu={(e) => handleSplitThumbnailContextMenu(e, index)}
                          title={`${index + 1}ページ`}
                          style={isAssigned ? { ['--split-color' as string]: `var(--split-color-${rangeIndex % 8})` } : undefined}
                        >
                          {isAssigned && <span className="epub-split-remove-hint">クリックで解除</span>}
                          <span className="epub-split-thumbnail-image">
                            {thumbnailSrc ? (
                              <img src={thumbnailSrc} alt="" loading="lazy" />
                            ) : (
                              <span className="epub-split-thumbnail-placeholder">{page.isBlank ? '白紙' : 'No Image'}</span>
                            )}
                          </span>
                          <span className="epub-split-thumbnail-meta">
                            <span>{index + 1}</span>
                            <span className="epub-split-thumbnail-badges">
                              {(page.isCover || isRangeCover) && <span className="cover">表紙</span>}
                              {(page.isColophon || isRangeColophon) && <span className="colophon">奥付</span>}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {splitContextMenu && (
                    <div
                      className="epub-context-menu"
                      style={{ left: splitContextMenu.x, top: splitContextMenu.y }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const menuPage = epubPages.find((page) => page.id === splitContextMenu.pageId);
                        return (
                          <>
                            {!menuPage?.isCover ? (
                              <button type="button" onClick={handleSplitContextSetCover}>表紙に設定</button>
                            ) : (
                              <button type="button" onClick={handleSplitContextClearCover}>表紙を解除</button>
                            )}
                            {!menuPage?.isColophon ? (
                              <button type="button" onClick={handleSplitContextSetColophon}>奥付に設定</button>
                            ) : (
                              <button type="button" onClick={handleSplitContextClearColophon}>奥付を解除</button>
                            )}
                            <div className="epub-context-menu-separator" />
                          </>
                        );
                      })()}
                      {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_OPTIONS.map((override) => (
                        <button
                          key={override}
                          type="button"
                          onClick={() => handleSplitContextProfileOverride(override)}
                          className={
                            epubPages.find((page) => page.id === splitContextMenu.pageId)?.imageProfileOverride === override
                              ? 'selected'
                              : ''
                          }
                        >
                          ICC: {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_LABELS[override]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <EpubSpreadPreview
                  pages={epubPages}
                  currentSpread={epubCurrentSpread}
                  selectedPageId={epubSelectedPageId}
                  selectedPageIds={epubSelectedPageIds}
                  onSpreadChange={setEpubCurrentSpread}
                  onSelectPage={handlePreviewSelectPage}
                  bindingDirection={pageDirection}
                  isPageBarVisible={true}
                />
              )
            )}
          </div>
          )}

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
                {EPUB_IMAGE_COLOR_POLICY_OPTIONS.map((policy) => (
                  <option key={policy} value={policy}>
                    {EPUB_IMAGE_COLOR_POLICY_LABELS[policy]}
                  </option>
                ))}
              </select>
              <div className="form-hint">
                Autoは本文のグレースケールを維持し、カラー画像はsRGB JPEGに正規化します。Adobe RGB運用時は全体設定またはページ個別指定で選択してください。
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
                  {EPUB_PAGE_IMAGE_PROFILE_OVERRIDE_OPTIONS.map((override) => (
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

          <div className="form-section epub-split-settings">
            <h3 className="section-heading">分割出力</h3>
            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={splitEnabled}
                  onChange={(e) => setSplitEnabled(e.target.checked)}
                />
                EPUB_maker方式で分割して出力
              </label>
            </div>
            {splitEnabled && (
              <>
                <div className="epub-split-actions">
                  <button className="btn-secondary btn-small" type="button" onClick={undoSplitRange} disabled={splitRanges.length === 0}>
                    最後の分割を取り消し
                  </button>
                  <button className="btn-secondary btn-small" type="button" onClick={clearSplitRanges} disabled={splitRanges.length === 0 && splitSelectingStart === null}>
                    すべてクリア
                  </button>
                </div>
                <div className="form-row">
                  <div className="form-group flex-grow">
                    <label>ベース名</label>
                    <input
                      type="text"
                      value={splitBaseName}
                      onChange={(e) => setSplitBaseName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>区切り</label>
                    <input
                      type="text"
                      value={splitSuffixSeparator}
                      onChange={(e) => setSplitSuffixSeparator(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>開始番号</label>
                    <input
                      type="number"
                      min={0}
                      max={9999}
                      value={splitSuffixStart}
                      onChange={(e) => setSplitSuffixStart(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div className="form-group">
                    <label>桁数</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={splitSuffixDigits}
                      onChange={(e) => setSplitSuffixDigits(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                    />
                  </div>
                </div>
                <div className="form-hint">
                  開始ページ、終了ページの順にクリックすると1つのEPUB範囲になります。各範囲の先頭ページを表紙として出力します。
                </div>
                {splitRanges.length > 0 && (
                  <div className="epub-split-title-list">
                    {splitRanges.map((range, index) => {
                      const suffixNumber = splitSuffixStart + index;
                      return (
                        <div key={`${range.startIndex}-${range.endIndex}`} className="epub-split-title-row">
                          <div className="epub-split-title-label">
                            <span>分割 {suffixNumber}</span>
                            <small>p{range.startIndex + 1}-p{range.endIndex + 1}</small>
                          </div>
                          <div className="form-group flex-grow">
                            <label>プロジェクト名 *</label>
                            <input
                              type="text"
                              value={splitTitles[index] ?? ''}
                              onChange={(e) => updateSplitTitle(index, e.target.value)}
                              placeholder="EPUB内の作品タイトル"
                            />
                          </div>
                          <div className="form-group flex-grow">
                            <label>プロジェクト名読み仮名</label>
                            <input
                              type="text"
                              value={splitTitleFileAsList[index] ?? ''}
                              onChange={(e) => updateSplitTitleFileAs(index, e.target.value)}
                              placeholder="未入力なら共通設定を使用"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <pre className="epub-split-summary">{splitSummary}</pre>
              </>
            )}
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
  );

  const embeddedSplitPreviewHost =
    embedded && splitEnabled && typeof document !== 'undefined'
      ? document.getElementById('epub-split-preview-host')
      : null;
  const embeddedSplitPreview = embeddedSplitPreviewHost
    ? createPortal(renderSplitPreviewContent(), embeddedSplitPreviewHost)
    : null;

  if (embedded) {
    return (
      <>
        <div className="epub-settings-panel">{modalContent}</div>
        {embeddedSplitPreview}
      </>
    );
  }

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={isGenerating ? undefined : onClose}>
      {modalContent}
    </div>
  );
}
