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

export interface BleedActionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

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
  actionCropRect: BleedActionRect | null;

  setMode: (mode: BleedScopeMode) => void;
  setCoverRegion: (region: BleedRegion | null) => void;
  setBodyRegion: (region: BleedRegion | null) => void;
  setChapterRegion: (chapterId: string, region: BleedRegion | null) => void;
  setMethod: (method: BleedMethod) => void;
  setActionSetPath: (path: string) => void;
  setActionName: (name: string) => void;
  setActionCropRect: (rect: BleedActionRect | null) => void;
  reset: () => void;

  // 出力時に消費する BleedSettings を構築（未設定なら undefined）
  getBleedSettings: () => BleedSettings | undefined;
  // 'action-ratio' 用の中央揃え比率 cropBounds（未設定なら undefined）
  getActionRatioCropBounds: () =>
    | { left: number; top: number; right: number; bottom: number; refWidth: number; refHeight: number; isProportional: true; centered: true }
    | undefined;
}

export const useBleedStore = create<BleedStoreState>((set, get) => ({
  mode: 'bulk',
  coverRegion: null,
  bodyRegion: null,
  perChapterRegions: {},
  method: 'region',
  actionSetPath: '',
  actionName: '',
  actionCropRect: null,

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
  setActionCropRect: (actionCropRect) => set({ actionCropRect }),
  reset: () =>
    set({
      mode: 'bulk',
      coverRegion: null,
      bodyRegion: null,
      perChapterRegions: {},
      method: 'region',
      actionSetPath: '',
      actionName: '',
      actionCropRect: null,
    }),

  getBleedSettings: () => {
    const { method, mode, coverRegion, bodyRegion, perChapterRegions } = get();
    // 範囲方式以外（none/action-ratio/action）は描いた領域を断ち切りに使わない
    if (method !== 'region') return undefined;
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

  getActionRatioCropBounds: () => {
    const { method, actionCropRect } = get();
    if (method !== 'action-ratio' || !actionCropRect) return undefined;
    if (!(actionCropRect.right > 0) || !(actionCropRect.bottom > 0)) return undefined;
    return {
      left: Math.max(0, Math.round(actionCropRect.left)),
      top: Math.max(0, Math.round(actionCropRect.top)),
      right: Math.round(actionCropRect.right),
      bottom: Math.round(actionCropRect.bottom),
      refWidth: Math.round(actionCropRect.right),
      refHeight: Math.round(actionCropRect.bottom),
      isProportional: true,
      centered: true,
    };
  },
}));
