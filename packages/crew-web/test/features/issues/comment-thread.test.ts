import { describe, expect, it } from 'vitest';
import { newestFirstThread } from '@/features/issues/detail/comment-thread';

const c = (id: string, createdAt: string) => ({ id, createdAt });

describe('newestFirstThread', () => {
  it('bình luận mới nhất đứng đầu, chờ duyệt xen theo giờ gửi', () => {
    const thread = newestFirstThread(
      [c('c1', '2026-10-10T01:00:00Z'), c('c2', '2026-10-10T03:00:00Z')],
      [c('p1', '2026-10-10T02:00:00Z'), c('p2', '2026-10-10T04:00:00Z')],
    );
    expect(thread.map((e) => `${e.type}:${e.item.id}`)).toEqual([
      'pending:p2',
      'comment:c2',
      'pending:p1',
      'comment:c1',
    ]);
  });

  it('trùng giờ: bình luận thật trên chờ duyệt; hai bình luận thật thì cái server trả sau đứng trên', () => {
    const t = '2026-10-10T01:00:00Z';
    const thread = newestFirstThread([c('c1', t), c('c2', t)], [c('p1', t)]);
    expect(thread.map((e) => e.item.id)).toEqual(['c2', 'c1', 'p1']);
  });

  it('bình luận vừa gửi (giờ mới nhất) lên đầu dù server trả cuối danh sách', () => {
    const thread = newestFirstThread([c('old', '2026-10-10T01:00:00Z'), c('new', '2026-10-10T05:00:00Z')], []);
    expect(thread[0].item.id).toBe('new');
  });

  it('giờ hỏng xuống cuối, không làm hỏng thứ tự còn lại', () => {
    const thread = newestFirstThread(
      [c('bad', 'không phải giờ'), c('a', '2026-10-10T01:00:00Z'), c('b', '2026-10-10T02:00:00Z')],
      [],
    );
    expect(thread.map((e) => e.item.id)).toEqual(['b', 'a', 'bad']);
  });

  it('không có gì thì rỗng', () => {
    expect(newestFirstThread([], [])).toEqual([]);
  });
});
