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
  method: 'region',
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
      method: 'region',
      actionSetPath: '',
      actionName: '',
    }),

  getBleedSettings: () => {
    const { method, mode, coverRegion, bodyRegion, perChapterRegions } = get();
    // 'region' / 'action-ratio' / 'json' はいずれも「範囲＋ぼかし半径」を持つ BleedRegion を
    // 断ち切りに使う（action-ratio は .atn、json は CLLENN JSON から範囲を初期化）。
    if (method !== 'region' && method !== 'action-ratio' && method !== 'json') return undefined;
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
