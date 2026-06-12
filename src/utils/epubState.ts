import {
  SavedEpubPageOverride,
  SavedEpubState,
  EpubPageImageProfileOverride,
} from '../types';

// 分割EPUBの巻ごとの安定キー（baseName + separator + ゼロ埋めsuffix）。
// 範囲indexではなく出力ファイル名と同じ規則にすることで、範囲の追加・削除に強くする。
export function splitVolumeKey(
  baseName: string,
  suffixSeparator: string,
  suffixStart: number,
  suffixDigits: number,
  index: number,
): string {
  const suffixNumber = suffixStart + index;
  const suffix = String(suffixNumber).padStart(suffixDigits, '0');
  return `${baseName}${suffixSeparator}${suffix}`;
}

// originalPageId をキーに、ページ単位の手動指定を1件マージする。
// patch のフィールドが undefined の場合はそのフィールドを「変更なし」として扱う。
export function upsertPageOverride(
  overrides: SavedEpubPageOverride[] | undefined,
  originalPageId: string,
  patch: Partial<Omit<SavedEpubPageOverride, 'originalPageId'>>,
): SavedEpubPageOverride[] {
  const list = [...(overrides ?? [])];
  const idx = list.findIndex((o) => o.originalPageId === originalPageId);
  const base: SavedEpubPageOverride = idx >= 0 ? list[idx] : { originalPageId };
  const merged: SavedEpubPageOverride = { ...base, ...patch, originalPageId };
  if (idx >= 0) list[idx] = merged;
  else list.push(merged);
  return prunePageOverrides(list);
}

// 表紙(isCover)は常に1ページのみ。既存の cover フラグを全て落とす。
export function clearCoverFlags(
  overrides: SavedEpubPageOverride[] | undefined,
): SavedEpubPageOverride[] {
  return (overrides ?? []).map((o) =>
    o.isCover ? { ...o, isCover: undefined } : o,
  );
}

// 中身が originalPageId だけ（実質的な指定なし）になった override を除去する。
export function prunePageOverrides(
  overrides: SavedEpubPageOverride[],
): SavedEpubPageOverride[] {
  return overrides.filter(
    (o) =>
      o.isCover === true ||
      o.isColophon === true ||
      (o.imageProfileOverride !== undefined && o.imageProfileOverride !== 'auto'),
  );
}

// pageOverrides を originalPageId → 指定 のマップへ。loadEpubFromDaidori で参照する。
export function buildPageOverrideMap(
  state: SavedEpubState | null | undefined,
): Map<string, SavedEpubPageOverride> {
  const map = new Map<string, SavedEpubPageOverride>();
  for (const o of state?.pageOverrides ?? []) {
    map.set(o.originalPageId, o);
  }
  return map;
}

export function profileOverrideOrAuto(
  value: EpubPageImageProfileOverride | undefined,
): EpubPageImageProfileOverride {
  return value ?? 'auto';
}
