// crew: tự dựng
// Thứ tự luồng trao đổi: bình luận thật và bình luận chờ duyệt xếp chung, mới nhất ở trên cùng.

type ThreadEntry<C, P> = { type: 'comment'; item: C } | { type: 'pending'; item: P };

interface Timestamped {
  createdAt: string | Date;
}

const timeOf = (item: Timestamped): number => {
  const ms = new Date(item.createdAt).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * Xếp bình luận (`comments` theo thứ tự server trả, cũ trước) và bình luận chờ duyệt thành một luồng mới nhất trước.
 * Trùng giờ: bình luận thật đứng trên bình luận chờ duyệt; hai bình luận thật trùng giờ thì cái server trả sau đứng
 * trên. Giờ hỏng coi như cũ nhất (xuống cuối) thay vì làm hỏng cả thứ tự.
 */
function newestFirstThread<C extends Timestamped, P extends Timestamped>(
  comments: readonly C[],
  pending: readonly P[],
): ThreadEntry<C, P>[] {
  const entries = [
    ...comments.map((item, index) => ({ entry: { type: 'comment' as const, item }, index, rank: 0 })),
    ...pending.map((item, index) => ({ entry: { type: 'pending' as const, item }, index, rank: 1 })),
  ];
  entries.sort((a, b) => timeOf(b.entry.item) - timeOf(a.entry.item) || a.rank - b.rank || b.index - a.index);
  return entries.map((e) => e.entry);
}

export type { ThreadEntry };
export { newestFirstThread };
