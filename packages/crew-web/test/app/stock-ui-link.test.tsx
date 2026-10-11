// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StockUiSidebarItem, useStockUiHref } from '@/app/shell/stock-ui-link';
import { initI18n, setLanguage } from '@/i18n';

const access = vi.hoisted(() => ({ isOwner: true }));
vi.mock('@/features/access/use-company-access', () => ({ useCompanyAccess: () => access }));

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  access.isOwner = true;
});

function Probe() {
  return <p data-testid="href">{useStockUiHref() ?? 'none'}</p>;
}

const at = (path: string, ui: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe('liên kết UI Paperclip gốc', () => {
  it('ẩn khi chưa có biến build', () => {
    at('/TPS/issues/TPS-1', <StockUiSidebarItem />);
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('hiện, mở tab mới an toàn, trỏ đúng trang đối tượng đang xem', () => {
    vi.stubGlobal('__CREW_STOCK_UI_URL__', 'https://stock.example.com');
    at('/TPS/issues/TPS-1', <StockUiSidebarItem />);
    const a = screen.getByRole('link', { name: /Mở giao diện Paperclip gốc/ });
    expect(a.getAttribute('href')).toBe('https://stock.example.com/TPS/issues/TPS-1');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });
  it('ẩn với người không phải owner', () => {
    vi.stubGlobal('__CREW_STOCK_UI_URL__', 'https://stock.example.com');
    access.isOwner = false;
    at('/TPS/issues/TPS-1', <StockUiSidebarItem />);
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('useStockUiHref theo vị trí hiện tại', () => {
    vi.stubGlobal('__CREW_STOCK_UI_URL__', 'https://stock.example.com');
    at('/TPS/dashboard', <Probe />);
    expect(screen.getByTestId('href').textContent).toBe('https://stock.example.com/');
  });
});
