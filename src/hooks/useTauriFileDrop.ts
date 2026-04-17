import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

// ファイルドロップ関連のグローバル状態（windowオブジェクトで管理してHMR対策）
declare global {
  interface Window {
    __dropListenersSetup?: boolean;
    __lastDropTime?: number;
    __isProcessingDrop?: boolean;
    __dropHandler?: ((paths: string[], targetPageId: string | null, mode: string | null, targetChapterId: string | null, insertPosition: 'before' | 'after' | null) => Promise<void>) | null;
    __setIsDraggingFiles?: ((value: boolean) => void) | null;
    __setFileDropTargetPageId?: ((value: string | null) => void) | null;
    __setFileDropMode?: ((value: 'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null) => void) | null;
    __setFileDropTargetChapterId?: ((value: string | null) => void) | null;
    __setInsertPosition?: ((value: 'before' | 'after' | null) => void) | null;
    __getDropInfoFromPosition?: ((x: number, y: number) => { pageId: string | null; chapterId: string | null; mode: 'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null; insertPosition: 'before' | 'after' | null }) | null;
    __autoScrollPreview?: ((x: number, y: number) => void) | null;
    __fileDropTargetPageId?: string | null;
    __fileDropMode?: 'insert' | 'append-chapter' | 'new-chapter' | 'new-chapter-start' | null;
    __fileDropTargetChapterId?: string | null;
    __insertPosition?: 'before' | 'after' | null;
  }
}

// 初期化
if (typeof window !== 'undefined') {
  window.__lastDropTime = window.__lastDropTime || 0;
  window.__isProcessingDrop = window.__isProcessingDrop || false;
  window.__fileDropTargetPageId = window.__fileDropTargetPageId || null;
  window.__fileDropMode = window.__fileDropMode || null;
  window.__fileDropTargetChapterId = window.__fileDropTargetChapterId || null;
  window.__insertPosition = window.__insertPosition || null;
}

/**
 * Tauri ファイルドロップイベントリスナーを設定するカスタムフック
 * windowオブジェクトで一度だけ登録し、HMRでも永続化される
 */
export function useTauriFileDrop() {
  useEffect(() => {
    // windowオブジェクトでチェック（HMRでも永続化される）
    if (window.__dropListenersSetup) {
      console.log('Window listeners already setup, skipping...');
      return;
    }
    window.__dropListenersSetup = true;

    const setupListeners = async () => {
      // ドロップイベント (Tauri v2)
      await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', (event) => {
        console.log('Drop event received:', event.payload);

        // ドロップ時の位置から直接ドロップ情報を取得（より正確）
        const { x, y } = event.payload.position;
        const dropInfo = window.__getDropInfoFromPosition?.(x, y) || { pageId: null, chapterId: null, mode: null, insertPosition: null };

        console.log('Drop info at position:', x, y, dropInfo);

        const targetPageId = dropInfo.pageId;
        const mode = dropInfo.mode;
        const targetChapterId = dropInfo.chapterId;
        const insertPos = dropInfo.insertPosition;

        // UIをリセット
        window.__setIsDraggingFiles?.(false);
        window.__setFileDropTargetPageId?.(null);
        window.__setFileDropMode?.(null);
        window.__setFileDropTargetChapterId?.(null);
        window.__setInsertPosition?.(null);
        window.__fileDropTargetPageId = null;
        window.__fileDropMode = null;
        window.__fileDropTargetChapterId = null;
        window.__insertPosition = null;

        window.__dropHandler?.(event.payload.paths, targetPageId, mode, targetChapterId, insertPos);
      });

      // ドラッグ開始イベント
      await listen('tauri://drag-enter', () => {
        window.__setIsDraggingFiles?.(true);
      });

      // ドラッグ終了イベント
      await listen('tauri://drag-leave', () => {
        window.__setIsDraggingFiles?.(false);
        window.__setFileDropTargetPageId?.(null);
        window.__setFileDropMode?.(null);
        window.__setFileDropTargetChapterId?.(null);
        window.__setInsertPosition?.(null);
        window.__fileDropTargetPageId = null;
        window.__fileDropMode = null;
        window.__fileDropTargetChapterId = null;
        window.__insertPosition = null;
      });

      // ドラッグオーバーイベント（位置追跡用 + 自動スクロール）
      await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-over', (event) => {
        const { x, y } = event.payload.position;

        // 自動スクロール（エッジ付近でスクロール）
        window.__autoScrollPreview?.(x, y);

        const dropInfo = window.__getDropInfoFromPosition?.(x, y) || { pageId: null, chapterId: null, mode: null, insertPosition: null };

        window.__fileDropTargetPageId = dropInfo.pageId;
        window.__fileDropMode = dropInfo.mode;
        window.__fileDropTargetChapterId = dropInfo.chapterId;
        window.__insertPosition = dropInfo.insertPosition;

        window.__setFileDropTargetPageId?.(dropInfo.pageId);
        window.__setFileDropMode?.(dropInfo.mode);
        window.__setFileDropTargetChapterId?.(dropInfo.chapterId);
        window.__setInsertPosition?.(dropInfo.insertPosition);
      });

      console.log('Window drop listeners setup complete');
    };

    setupListeners();

    // クリーンアップは不要（アプリ全体で一度だけ登録）
  }, []);
}
