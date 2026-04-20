import type { FileValidationStatus, ValidationContext, ValidationGroupContext, ChapterType } from '../types';

const COLOR_MODE_LABELS: Record<string, string> = {
  RGB: 'RGB',
  Grayscale: 'グレースケール',
  CMYK: 'CMYK',
  Bitmap: 'ビットマップ',
  Indexed: 'インデックスカラー',
  Multichannel: 'マルチチャンネル',
  Duotone: 'ダブルトーン',
  Lab: 'Lab',
};

function colorModeLabel(mode: string | undefined): string {
  if (!mode) return '不明';
  return COLOR_MODE_LABELS[mode] ?? mode;
}

function pickGroup(context: ValidationContext, chapterType: ChapterType | undefined): ValidationGroupContext {
  return chapterType === 'cover' ? context.cover : context.body;
}

// PageでもEpubPageInfoでも受け取れる最小インターフェース
interface ValidatablePage {
  fileValidationStatus?: FileValidationStatus;
  imageWidth?: number;
  imageHeight?: number;
  imageColorMode?: string;
  imageDpi?: number;
}

/**
 * ページの検証ステータスに応じたtooltipメッセージを生成
 * - missing/modified/meta_error はベース文言
 * - mismatch 系は「このページ: X / 多数派: Y」を併記
 */
export function getValidationMessage(
  page: ValidatablePage,
  context: ValidationContext,
  chapterType?: ChapterType
): string {
  const status: FileValidationStatus = page.fileValidationStatus ?? 'ok';
  switch (status) {
    case 'missing':
      return 'ファイルが見つかりません（移動またはリネームされた可能性があります）';
    case 'modified':
      return 'ファイルが変更されています（更新日時が異なります）';
    case 'meta_error':
      return '画像メタデータの取得に失敗しました（ファイルが破損している可能性があります）';
    case 'size_mismatch': {
      const group = pickGroup(context, chapterType);
      const own = page.imageWidth && page.imageHeight ? `${page.imageWidth}×${page.imageHeight}` : '不明';
      const majority = group.majoritySize ? group.majoritySize.replace('x', '×') : '不明';
      return `他のページと寸法が異なります（このページ: ${own} / 多数派: ${majority}）`;
    }
    case 'color_mismatch': {
      const group = pickGroup(context, chapterType);
      const own = colorModeLabel(page.imageColorMode);
      const majority = colorModeLabel(group.majorityColorMode);
      return `他のページとカラーモードが異なります（このページ: ${own} / 多数派: ${majority}）`;
    }
    case 'dpi_mismatch': {
      const group = pickGroup(context, chapterType);
      const own = page.imageDpi !== undefined ? `${page.imageDpi}dpi` : '不明';
      const majority = group.majorityDpi !== undefined ? `${group.majorityDpi}dpi` : '不明';
      return `他のページと解像度が異なります（このページ: ${own} / 多数派: ${majority}）`;
    }
    case 'ok':
    default:
      return '';
  }
}
