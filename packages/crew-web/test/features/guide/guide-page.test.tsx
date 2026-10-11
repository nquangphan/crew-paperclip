// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { GuidePage } from '@/features/guide/guide-page';
import { MISSING_FEATURES } from '@/features/guide/missing-features';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
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
  return <output data-testid="where">{loc.pathname + loc.search + loc.hash}</output>;
}

const asRole = (membershipRole: string, contributor = false) =>
  accessRoute(COMPANY.id, { userId: 'u1', membershipRole, contributor, canApprove: membershipRole === 'owner' });

/** Dựng trang ở `at`; `access` là câu trả lời GET /access (mặc định owner). */
function mount(at = '/TPS/guide', access: Parameters<typeof mockServer>[0] = {}) {
  mockServer(access);
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
    { initialEntries: [at] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <RouterProvider router={router} />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

const ready = () => screen.findByRole('navigation', { name: /Mục lục|Contents/ });
const sectionIds = () => [...document.querySelectorAll('[data-slot="doc-section"]')].map((el) => el.id);

describe('GuidePage', () => {
  it('owner: tiêu đề, mục lục theo nhóm có neo, đủ phần của owner và bảng tính năng không có', async () => {
    mount();
    const toc = await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Hướng dẫn sử dụng 2P Crew' })).toBeTruthy();
    const links = within(toc).getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(30);
    for (const a of links) {
      const id = (a.getAttribute('href') ?? '').slice(1);
      expect(document.getElementById(id), id).toBeTruthy();
    }
    expect(within(toc).getByText('Bắt đầu')).toBeTruthy();
    expect(within(toc).getByRole('link', { name: 'Gỡ máy và ghép lại' })).toBeTruthy();
    expect(sectionIds()).toEqual(expect.arrayContaining(['members', 'pair-machine', 'approve', 'add-project']));
    expect(document.querySelectorAll('[data-missing-id]')).toHaveLength(MISSING_FEATURES.length);
  });

  it('mỗi mục việc có ảnh thật, không có khung chờ ảnh', async () => {
    mount();
    await ready();
    expect(document.querySelectorAll('figure[data-shot-pending]')).toHaveLength(0);
    const imgs = [...document.querySelectorAll('figure[data-slot="doc-figure"] img')];
    expect(imgs.length).toBeGreaterThanOrEqual(30);
    for (const img of imgs) expect(img.getAttribute('alt')?.length).toBeGreaterThan(3);
    expect(screen.getByText('Sơ đồ, không phải ảnh chụp app')).toBeTruthy();
  });

  it('viewer: chỉ phần xem, không có phần chỉ owner hay phần tạo, không có ô chọn vai trò', async () => {
    mount('/TPS/guide', asRole('viewer'));
    await ready();
    expect(document.querySelector('[data-guide-role="viewer"]')).toBeTruthy();
    expect(screen.getByText('Hướng dẫn cho: Chỉ xem')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    const ids = sectionIds();
    expect(ids).toEqual(expect.arrayContaining(['dashboard', 'issue-list', 'issue-popup', 'docs']));
    for (const id of ['new-request', 'members', 'pair-machine', 'inbox', 'send-request']) expect(ids).not.toContain(id);
  });

  it('Phòng Marketing: gửi yêu cầu, bình luận, Góp ý của tôi; không có Yêu cầu mới của board', async () => {
    mount('/TPS/guide', asRole('viewer', true));
    await ready();
    expect(screen.getByText('Hướng dẫn cho: Phòng Marketing')).toBeTruthy();
    const ids = sectionIds();
    expect(ids).toEqual(expect.arrayContaining(['send-request', 'send-comment', 'my-contributions']));
    for (const id of ['new-request', 'review-contributions', 'members', 'machines']) expect(ids).not.toContain(id);
  });

  it('admin và operator: việc hằng ngày, không có phần chỉ owner', async () => {
    for (const role of ['admin', 'operator']) {
      mount('/TPS/guide', asRole(role));
      await ready();
      expect(screen.getByText('Hướng dẫn cho: Admin / Vận hành')).toBeTruthy();
      const ids = sectionIds();
      expect(ids).toEqual(expect.arrayContaining(['new-request', 'inbox', 'machines', 'agents']));
      for (const id of ['approve', 'members', 'pair-machine', 'unpair-machine', 'add-project']) {
        expect(ids).not.toContain(id);
      }
      cleanup();
    }
  });

  it('owner xem thử bản của vai trò khác qua ?role=, người khác không đổi được', async () => {
    mount('/TPS/guide?role=contributor');
    await ready();
    expect(document.querySelector('[data-guide-role="contributor"]')).toBeTruthy();
    expect(screen.getByRole('combobox')).toBeTruthy();
    cleanup();

    mount('/TPS/guide?role=owner', asRole('viewer'));
    await ready();
    expect(document.querySelector('[data-guide-role="viewer"]')).toBeTruthy();
  });

  it('đổi sang EN thì hiển thị guide.en.md', async () => {
    await setLanguage('en');
    mount();
    await screen.findByRole('navigation', { name: 'Contents' });
    expect(screen.getByRole('heading', { level: 1, name: 'Using 2P Crew' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Why there is no button/ })).toBeTruthy();
    expect(screen.queryByText('Hướng dẫn sử dụng 2P Crew')).toBeNull();
  });

  it('mở bằng link có #neo thì cuộn tới đúng mục', async () => {
    const seen: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scroll(this: Element) {
      seen.push(this.id);
    };
    try {
      mount('/TPS/guide#pair-machine');
      await ready();
      await waitFor(() => expect(seen).toContain('pair-machine'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('link nội bộ gắn tiền tố company và điều hướng trong SPA', async () => {
    mount();
    await ready();
    const link = document.querySelector('a[href="/TPS/projects/new"]') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    fireEvent.click(link as HTMLAnchorElement);
    expect(screen.getByTestId('where').textContent).toBe('/TPS/projects/new');
  });

  it('link ngoài vẫn mở tab mới', async () => {
    mount();
    await ready();
    for (const a of document.querySelectorAll('a[href^="http"]')) expect(a.getAttribute('target')).toBe('_blank');
  });
});
