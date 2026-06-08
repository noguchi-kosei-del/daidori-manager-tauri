import { create } from 'zustand';
import type { BleedRegion, BleedSettings } from './components/modals/ExportModal';

// 断ち切り設定はセッション内のみ保持し、.daiw には永続化しない。
// 断ち切りタブで編集し、出力タブ（および PDF 生成）が getBleedSettings() で消費する。

export type BleedScopeMode = 'bulk' | 'per-chapter';

const ZERO_REGION: BleedRegion = {
  left: 0, top: 0, right: 0, bottom: 0,
  refWidth: 0, refHeight: 0,
  tachikiriType: 'none',
  strokeColor: 'black',
  fillColor: 'white',
  fillOpacity: 50,
};

interface BleedStoreState {
  mode: BleedScopeMode;
  coverRegion: BleedRegion | null;
  bodyRegion: BleedRegion | null;
  perChapterRegions: Record<string, BleedRegion>;

  setMode: (mode: BleedScopeMode) => void;
  setCoverRegion: (region: BleedRegion | null) => void;
  setBodyRegion: (region: BleedRegion | null) => void;
  setChapterRegion: (chapterId: string, region: BleedRegion | null) => void;
  reset: () => void;

  // 出力時に消費する BleedSettings を構築（未設定なら undefined）
  getBleedSettings: () => BleedSettings | undefined;
}

export const useBleedStore = create<BleedStoreState>((set, get) => ({
  mode: 'bulk',
  coverRegion: null,
  bodyRegion: null,
  perChapterRegions: {},

  setMode: (mode) => set({ mode }),
  setCoverRegion: (region) => set({ coverRegion: region }),
  setBodyRegion: (region) => set({ bodyRegion: region }),
  setChapterRegion: (chapterId, region) =>
    set((state) => {
      const next = { ...state.perChapterRegions };
      if (region === null) {
        delete next[chapterId];
      } else {
        next[chapterId] = region;
      }
      return { perChapterRegions: next };
    }),
  reset: () => set({ mode: 'bulk', coverRegion: null, bodyRegion: null, perChapterRegions: {} }),

  getBleedSettings: () => {
    const { mode, coverRegion, bodyRegion, perChapterRegions } = get();
    const hasAny =
      coverRegion || bodyRegion || Object.keys(perChapterRegions).length > 0;
    if (!hasAny) return undefined;
    return {
      enabled: true,
      mode,
      cover: coverRegion ?? ZERO_REGION,
      body: bodyRegion ?? ZERO_REGION,
      perChapter: mode === 'per-chapter' ? perChapterRegions : undefined,
    };
  },
}));
