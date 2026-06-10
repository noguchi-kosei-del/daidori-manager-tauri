/**
 * セグメント切替（工程タブ／リスト見開き／出力行き先）の画面遷移スライド方向を計算する。
 *
 * 順序配列 `order` 上で `next` が `current` より後ろ（右へ移動）なら正方向 `distance`、
 * 前（左へ移動）なら負方向 `-distance` を返す。CSS カスタムプロパティ
 * （`--screen-slide-from` 等）にそのまま渡してスライドフェードの向きを切り替える用途。
 */
export function computeSlideDirection<T>(
  next: T,
  current: T,
  order: T[],
  distance = '16px',
): string {
  return order.indexOf(next) > order.indexOf(current) ? distance : `-${distance}`;
}
