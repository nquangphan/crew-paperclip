import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeStockUiBase, stockUiBase, stockUiUrl } from '@/app/stock-ui';

const BASE = 'https://stock.example.com';

afterEach(() => vi.unstubAllGlobals());

describe('stockUiBase', () => {
  it('rỗng hoặc không định nghĩa thì ẩn nút', () => {
    expect(stockUiBase()).toBe('');
    vi.stubGlobal('__CREW_STOCK_UI_URL__', '');
    expect(stockUiBase()).toBe('');
  });
  it('lấy từ biến build và bỏ dấu / cuối', () => {
    vi.stubGlobal('__CREW_STOCK_UI_URL__', `${BASE}/`);
    expect(stockUiBase()).toBe(BASE);
  });
  it('nhận đường dẫn cùng origin, từ chối //host', () => {
    expect(normalizeStockUiBase('/paperclip/')).toBe('/paperclip');
    expect(normalizeStockUiBase('//evil.com')).toBe('');
  });
  it('chỉ nhận giao thức web', () => {
    expect(normalizeStockUiBase('javascript:alert(1)')).toBe('');
    expect(normalizeStockUiBase('not a url')).toBe('');
    expect(normalizeStockUiBase(' http://127.0.0.1:3100 ')).toBe('http://127.0.0.1:3100');
  });
});

describe('stockUiUrl', () => {
  it('base rỗng thì null', () => {
    expect(stockUiUrl('', '/TPS/issues/TPS-1')).toBeNull();
  });
  it('map issue, project, agent sang đúng trang UI gốc', () => {
    expect(stockUiUrl(BASE, '/TPS/issues/TPS-12')).toBe(`${BASE}/TPS/issues/TPS-12`);
    expect(stockUiUrl(BASE, '/TPS/projects/web-app')).toBe(`${BASE}/TPS/projects/web-app`);
    expect(stockUiUrl(BASE, '/TPS/agents/dev-1')).toBe(`${BASE}/TPS/agents/dev-1`);
  });
  it('base tương đối cho link sâu cùng origin', () => {
    expect(stockUiUrl('/paperclip', '/TPS/issues/TPS-12')).toBe('/paperclip/TPS/issues/TPS-12');
    expect(stockUiUrl('/paperclip', '/TPS/inbox')).toBe('/paperclip/');
  });
  it('map run của agent', () => {
    expect(stockUiUrl(BASE, '/TPS/agents/dev-1/runs/r9')).toBe(`${BASE}/TPS/agents/dev-1/runs/r9`);
  });
  it('mã chứa ký tự đặc biệt được mã hóa', () => {
    expect(stockUiUrl(BASE, '/TPS/issues/a%20b')).toBe(`${BASE}/TPS/issues/a%20b`);
  });
  it('trang danh sách hoặc không map được thì về trang chủ UI gốc', () => {
    for (const p of [
      '/',
      '/TPS/issues',
      '/TPS/projects/new',
      '/TPS/agents/new',
      '/TPS/inbox',
      '/login',
      '/cli-auth/x',
      '/TPS/runs/r1',
    ])
      expect(stockUiUrl(BASE, p)).toBe(`${BASE}/`);
  });
});
