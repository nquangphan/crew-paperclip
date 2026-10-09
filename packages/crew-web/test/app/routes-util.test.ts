import { describe, expect, it } from 'vitest';
import { safeNext } from '@/app/routes-util';

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
