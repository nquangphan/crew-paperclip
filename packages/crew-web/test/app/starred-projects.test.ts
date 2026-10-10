import { describe, expect, it } from 'vitest';
import { starredProjects } from '@/app/shell/starred-projects';

const p = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, archivedAt: null, ...extra });

describe('starredProjects', () => {
  it('lấy project đã gắn sao theo thứ tự đã lưu', () => {
    expect(starredProjects([p('a'), p('b'), p('c')], ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a']);
  });
  it('không có sao thì rỗng', () => {
    expect(starredProjects([p('a')], [])).toEqual([]);
  });
  it('bỏ sao trỏ tới project không còn hoặc đã lưu trữ', () => {
    const list = [p('a'), p('b', { archivedAt: '2026-10-01T00:00:00Z' })];
    expect(starredProjects(list, ['x', 'b', 'a']).map((x) => x.id)).toEqual(['a']);
  });
  it('id trùng chỉ hiện một lần', () => {
    expect(starredProjects([p('a')], ['a', 'a']).map((x) => x.id)).toEqual(['a']);
  });
});
