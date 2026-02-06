import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { PARALLEL_LIMIT } from '../constants/dnd';
import { ThumbnailResult } from '../types';

// サムネイル生成キュー（並列処理版）
const thumbnailQueue: { pageId: string; filePath: string; modifiedTime: number }[] = [];
let isProcessingQueue = false;
let processingPromise: Promise<void> | null = null;

async function processThumbnailQueue() {
  if (isProcessingQueue || thumbnailQueue.length === 0) return;
  isProcessingQueue = true;

  try {
    while (thumbnailQueue.length > 0) {
      // 最大PARALLEL_LIMIT個のアイテムを同時に処理
      const batch = thumbnailQueue.splice(0, PARALLEL_LIMIT);

      await Promise.all(
        batch.map(async (item) => {
          try {
            // ThumbnailResult: { cache_key, cache_path, status }
            const result = await invoke<ThumbnailResult>('generate_thumbnail', {
              filePath: item.filePath,
              modifiedTime: item.modifiedTime,
            });
            useStore.getState().updatePageThumbnail(item.pageId, result.cache_key, result.cache_path);
          } catch (error) {
            console.error('Thumbnail generation failed:', error);
            useStore.getState().setPageThumbnailError(item.pageId);
          }
        })
      );
    }
  } finally {
    isProcessingQueue = false;
  }
}

export function queueThumbnail(pageId: string, filePath: string, modifiedTime: number) {
  // 重複チェック: 同じpageIdが既にキューにある場合はスキップ
  const exists = thumbnailQueue.find(item => item.pageId === pageId);
  if (exists) return;

  thumbnailQueue.push({ pageId, filePath, modifiedTime });

  // 競合状態防止: Promiseチェーンで順次処理を保証
  if (!processingPromise) {
    processingPromise = processThumbnailQueue().finally(() => {
      processingPromise = null;
    });
  }
}
