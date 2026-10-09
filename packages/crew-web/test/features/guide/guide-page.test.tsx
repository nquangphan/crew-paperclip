// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { GuidePage } from '@/features/guide/guide-page';
import { MISSING_FEATURES } from '@/features/guide/missing-features';
import { GUIDE_SHOTS } from '@/features/guide/shots';
import { initI18n, setLanguage } from '@/i18n';
import { COMPANY } from '../agents/helpers';

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function mount() {
  const router = createMemoryRouter(
    [
      {
        path: '/TPS/guide',
        element: (
          <>
            <GuidePage />
            <Where />
          </>
        ),
      },
      { path: '/TPS/*', element: <Where /> },
    ],
    { initialEntries: ['/TPS/guide'] },
  );
  render(
    <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
      <RouterProvider router={router} />
    </CompanyContext.Provider>,
  );
}

describe('GuidePage', () => {
  it('tiếng Việt: tiêu đề, mục lục và mục "Vì sao không có nút"', async () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Hướng dẫn sử dụng 2P Crew' })).toBeTruthy();
    const toc = screen.getByRole('navigation', { name: 'Mục lục' });
    expect(within(toc).getAllByRole('link').length).toBeGreaterThanOrEqual(10);
    expect(screen.getByRole('heading', { name: /Vì sao không có nút/ })).toBeTruthy();
  });

  it('hiện mọi tính năng không có, mỗi dòng đúng số lượng', () => {
    mount();
    const rows = document.querySelectorAll('[data-missing-id]');
    expect(rows).toHaveLength(MISSING_FEATURES.length);
    expect(screen.getByText('Routines (lịch chạy định kỳ, trigger, webhook công khai)')).toBeTruthy();
  });

  it('đổi sang EN thì hiển thị guide.en.md và danh sách tiếng Anh', async () => {
    await setLanguage('en');
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Using 2P Crew' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Contents' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Why there is no button/ })).toBeTruthy();
    expect(screen.queryByText('Hướng dẫn sử dụng 2P Crew')).toBeNull();
  });

  it('ảnh chưa chụp hiện khung chỗ có chú thích, không có thẻ img hỏng', () => {
    mount();
    const pending = document.querySelectorAll('figure[data-shot-pending]');
    expect(pending.length).toBe(GUIDE_SHOTS.length);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(within(pending[0] as HTMLElement).getByText(/Ảnh minh họa sẽ được chụp sau/)).toBeTruthy();
  });

  it('link nội bộ gắn tiền tố company và điều hướng trong SPA', () => {
    mount();
    const link = document.querySelector('a[href="/TPS/projects/new"]') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    fireEvent.click(link as HTMLAnchorElement);
    expect(screen.getByTestId('where').textContent).toBe('/TPS/projects/new');
  });

  it('link ngoài vẫn mở tab mới', () => {
    mount();
    for (const a of document.querySelectorAll('a[href^="http"]')) expect(a.getAttribute('target')).toBe('_blank');
  });
});
