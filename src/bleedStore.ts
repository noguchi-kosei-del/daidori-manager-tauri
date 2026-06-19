import { create } from 'zustand';
import type { BleedRegion, BleedSettings } from './components/modals/ExportModal';

// 断ち切り設定はセッション内のみ保持し、.daiw には永続化しない。
// 断ち切りタブで編集し、出力タブ（および PDF 生成）が getBleedSettings() で消費する。

export type BleedScopeMode = 'bulk' | 'per-chapter';

// 断ち切り方式（断ち切りタブに一本化）。アクション/JSONは「数値（断ち切り範囲＋ぼかし半径）を
// 引いてくるだけ」で、適用はアプリのネイティブ処理（比率断ち切り＋ガウスぼかし）が行う。
//  'none'        : 断ち切らない
//  'region'      : このタブで描いた範囲で断ち切る（従来の既定）
//  'action-ratio': Photoshopアクション(.atn)から切り抜き比率＋ぼかし半径を取り出して中央で断ち切る
//  'json'        : CLLENNの共有JSON（縮尺）から断ち切り範囲＋ぼかし半径を取り出して断ち切る
export type BleedMethod = 'none' | 'region' | 'action-ratio' | 'json';

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

  // 断ち切り方式（タブに一本化）。アクション系で使う .atn 情報も保持
  method: BleedMethod;
  actionSetPath: string;
  actionName: string;

  setMode: (mode: BleedScopeMode) => void;
  setCoverRegion: (region: BleedRegion | null) => void;
  setBodyRegion: (region: BleedRegion | null) => void;
  setChapterRegion: (chapterId: string, region: BleedRegion | null) => void;
  setMethod: (method: BleedMethod) => void;
  setActionSetPath: (path: string) => void;
  setActionName: (name: string) => void;
  reset: () => void;

  // 出力時に消費する BleedSettings を構築（未設定なら undefined）
  getBleedSettings: () => BleedSettings | undefined;
}

export const useBleedStore = create<BleedStoreState>((set, get) => ({
  mode: 'bulk',
  coverRegion: null,
  bodyRegion: null,
  perChapterRegions: {},
  // 既定は「方式なし」（断ち切りなし）。表紙含め初期状態は断ち切りしない。
  // 断ち切りたい場合は方式を 手動/アクション/JSON に切り替える。
  method: 'none',
  actionSetPath: '',
  actionName: '',

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
  setMethod: (method) => set({ method }),
  setActionSetPath: (actionSetPath) => set({ actionSetPath }),
  setActionName: (actionName) => set({ actionName }),
  reset: () =>
    set({
      mode: 'bulk',
      coverRegion: null,
      bodyRegion: null,
      perChapterRegions: {},
      method: 'none',
      actionSetPath: '',
      actionName: '',
    }),

  getBleedSettings: () => {
    const { mode, coverRegion, bodyRegion, perChapterRegions } = get();
    // 方式は区分ごとに異なる（本文=手動／表紙=なし 等）ため、出力は「実際に断ち切る
    // 範囲（tachikiriType !== 'none'）が1つでもあるか」で判定する。
    // 各 BleedRegion は手動/アクション/JSON いずれの方式でも最終的な範囲＋ぼかし半径を持つ。
    const all = [coverRegion, bodyRegion, ...Object.values(perChapterRegions)];
    const hasBleed = all.some((r) => r != null && r.tachikiriType !== 'none');
    if (!hasBleed) return undefined;
    return {
      enabled: true,
      mode,
      cover: coverRegion ?? ZERO_REGION,
      body: bodyRegion ?? ZERO_REGION,
      perChapter: mode === 'per-chapter' ? perChapterRegions : undefined,
    };
  },
}));
