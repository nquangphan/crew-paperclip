import { describe, expect, it } from 'vitest';
import { groupNavItems, NAV_ITEMS, safeNext } from '@/app/routes-util';

describe('safeNext', () => {
  it('nhận đường nội bộ, giữ query và hash', () => {
    expect(safeNext('/TPS/issues?status=todo#a')).toBe('/TPS/issues?status=todo#a');
  });
  it('rỗng hoặc không bắt đầu bằng / thì về /', () => {
    for (const v of [null, undefined, '', 'TPS/issues', 'https://evil.com', 'javascript:alert(1)']) {
      expect(safeNext(v)).toBe('/');
    }
  });
  it('chặn đường ra origin khác: //, /\\, ký tự điều khiển', () => {
    for (const v of [
      '//evil.com',
      '/\\evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      '/\r//evil.com',
      '/\x00/x',
      '/a\\b',
    ]) {
      expect(safeNext(v), JSON.stringify(v)).toBe('/');
    }
  });
});

describe('groupNavItems', () => {
  const segs = (...s: string[]) => NAV_ITEMS.filter((i) => s.includes(i.segment));

  it('chia theo Paperclip: nhóm đầu không tên, rồi Công việc, Tổ chức, Hệ thống', () => {
    const groups = groupNavItems(NAV_ITEMS);
    expect(groups.map((g) => g.id)).toEqual(['main', 'work', 'org', 'system']);
    const ids = (g: string) => groups.find((x) => x.id === g)?.items.map((i) => i.id);
    expect(ids('main')).toEqual(['newIssue', 'search', 'dashboard', 'inbox']);
    expect(ids('work')).toEqual(['issues', 'contributions', 'projects', 'docs']);
    expect(ids('org')).toEqual(['agents', 'skills', 'machines']);
    expect(ids('system')).toEqual(['members', 'settings', 'guide']);
  });
  it('mọi mục thuộc đúng một nhóm', () => {
    const all = groupNavItems(NAV_ITEMS).flatMap((g) => g.items.map((i) => i.id));
    expect([...all].sort()).toEqual(NAV_ITEMS.map((i) => i.id).sort());
  });
  it('bỏ nhóm không còn mục nào (route chưa có)', () => {
    const groups = groupNavItems(segs('dashboard', 'settings'));
    expect(groups.map((g) => g.id)).toEqual(['main', 'system']);
  });
});
