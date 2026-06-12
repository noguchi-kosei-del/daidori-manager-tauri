import { create } from 'zustand';
import type { BleedRegion, BleedSettings } from './components/modals/ExportModal';

// 断ち切り設定はセッション内のみ保持し、.daiw には永続化しない。
// 断ち切りタブで編集し、出力タブ（および PDF 生成）が getBleedSettings() で消費する。

export type BleedScopeMode = 'bulk' | 'per-chapter';

// 断ち切り方式（断ち切りタブに一本化）。
//  'none'        : 断ち切らない
//  'region'      : このタブで描いた範囲で断ち切る（従来の既定）
//  'action-ratio': Photoshopアクションの切り抜き座標から比率を割り出して中央で断ち切る
//  'action'      : Photoshopアクションをそのまま実行して断ち切る（EPUB高品質のみ）
export type BleedMethod = 'none' | 'region' | 'action-ratio' | 'action';

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
    // 'region' と 'action-ratio' は描いた/読み込んだ範囲を断ち切りに使う。
    // 'action-ratio' は .atn から範囲を初期化したうえで範囲方式と同じ編集・出力経路を通る。
    if (method !== 'region' && method !== 'action-ratio') return undefined;
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
