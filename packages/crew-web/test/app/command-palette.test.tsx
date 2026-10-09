// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { CommandPalette } from '@/app/shell/command-palette';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from './fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function mount(segments: string[]) {
  mockServer({});
  const router = createMemoryRouter(
    [
      {
        path: '/:p/*',
        element: (
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <CompanyContext.Provider value={{ company: COMPANY } as never}>
              <CommandPalette open onOpenChange={() => {}} segments={new Set(segments)} />
              <Where />
            </CompanyContext.Provider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: ['/TPS/dashboard'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('CommandPalette: lối vào trang Tìm kiếm', () => {
  it('gõ chữ rồi Enter mở trang tìm kiếm với từ khóa', async () => {
    mount(['search', 'issues']);
    const input = screen.getByPlaceholderText('Mã yêu cầu hoặc từ khóa');
    fireEvent.change(input, { target: { value: 'đăng nhập' } });
    expect(await screen.findByText('Tìm “đăng nhập” trong trang Tìm kiếm')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/TPS/search?q=%C4%91%C4%83ng+nh%E1%BA%ADp'),
    );
  });
  it('không có route search thì không hiện lối vào', async () => {
    mount(['issues']);
    fireEvent.change(screen.getByPlaceholderText('Mã yêu cầu hoặc từ khóa'), { target: { value: 'abc' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/trong trang Tìm kiếm/)).toBeNull();
  });
});
