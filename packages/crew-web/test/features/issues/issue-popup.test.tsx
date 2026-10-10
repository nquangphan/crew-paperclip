// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext, MeContext } from '@/app/hooks';
import { IssueLink, IssuePopupHost } from '@/features/issues';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { AGENTS, COMPANY, ISSUE, ME, PROJECTS } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // nạp sẵn nội dung popup (lazy) để ca đầu không chờ biên dịch
  await import('@/features/issues/popup/issue-popup');
});
afterEach(cleanup);

const PARENT = { ...ISSUE, id: 'i0', identifier: 'TPS-1', title: 'Yêu cầu gốc', parentId: null, ancestors: [] };

function server() {
  const issueRoutes = (i: typeof ISSUE | typeof PARENT) => ({
    [`GET /api/issues/${i.identifier}`]: { body: i },
    [`GET /api/issues/${i.id}/comments`]: { body: [] },
    [`GET /api/issues/${i.id}/attachments`]: { body: [] },
    [`GET /api/issues/${i.id}/documents`]: { body: [] },
    [`GET /api/issues/${i.id}/runs`]: { body: [] },
    [`GET /api/issues/${i.id}/live-runs`]: { body: [] },
    [`GET /api/issues/${i.id}/interactions`]: { body: [] },
    [`POST /api/issues/${i.id}/read`]: { body: { id: i.id } },
  });
  return mockServer({
    ...issueRoutes(ISSUE),
    ...issueRoutes(PARENT),
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/issues': { body: [] },
  } as Parameters<typeof mockServer>[0]);
}

/** Shell rút gọn: trang dưới là Outlet, popup gắn một lần như CompanyShell. */
function mountAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/:companyPrefix',
        element: (
          <QueryClientProvider client={qc}>
            <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
              <MeContext.Provider value={ME}>
                <Outlet />
                <IssuePopupHost />
              </MeContext.Provider>
            </CompanyContext.Provider>
          </QueryClientProvider>
        ),
        children: [
          {
            path: 'inbox',
            element: (
              <main data-testid="under">
                <IssueLink identifier="TPS-2">Mở TPS-2</IssueLink>
              </main>
            ),
          },
          { path: 'issues/:ref', element: <IssuePage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const popup = () => screen.findByTestId('issue-popup');
const issueParam = (router: ReturnType<typeof mountAt>) =>
  new URLSearchParams(router.state.location.search).get('issue');

describe('popup chi tiết yêu cầu `?issue=`', () => {
  it('bấm link mở popup trên trang đang xem, trang dưới vẫn còn; nút Đóng lùi history và bỏ tham số', async () => {
    server();
    const router = mountAt('/TPS/inbox');
    const link = screen.getByRole('link', { name: 'Mở TPS-2' });
    expect(link.getAttribute('href')).toBe('/TPS/issues/TPS-2');
    fireEvent.click(link);
    const dialog = await popup();
    expect(router.state.location.pathname).toBe('/TPS/inbox');
    expect(issueParam(router)).toBe('TPS-2');
    expect(await within(dialog).findByText('Sửa trang đăng nhập', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByTestId('under')).toBeTruthy();
    // đủ ba khe Crew và cột Thuộc tính
    expect(within(dialog).getByTestId('properties-panel')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Gửi bình luận' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('issue-popup')).toBeNull());
    expect(router.state.location.pathname).toBe('/TPS/inbox');
    expect(issueParam(router)).toBeNull();
    expect(router.state.historyAction).toBe('POP');
  });

  it('Back của trình duyệt đóng popup', async () => {
    server();
    const router = mountAt('/TPS/inbox');
    fireEvent.click(screen.getByRole('link', { name: 'Mở TPS-2' }));
    await popup();
    await router.navigate(-1);
    await waitFor(() => expect(screen.queryByTestId('issue-popup')).toBeNull());
    expect(router.state.location.pathname).toBe('/TPS/inbox');
  });

  it('Esc đóng popup', async () => {
    server();
    const router = mountAt('/TPS/inbox');
    fireEvent.click(screen.getByRole('link', { name: 'Mở TPS-2' }));
    const dialog = await popup();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('issue-popup')).toBeNull());
    expect(issueParam(router)).toBeNull();
  });

  it('Cmd/Ctrl+click để trình duyệt mở tab mới, không mở popup', async () => {
    server();
    const router = mountAt('/TPS/inbox');
    const link = screen.getByRole('link', { name: 'Mở TPS-2' });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('issue-popup')).toBeNull();
    expect(router.state.location.search).toBe('');
  });

  it('link trực tiếp có ?issue= mở popup; đóng thì thay URL bằng trang dưới (không lùi ra khỏi app)', async () => {
    server();
    const router = mountAt('/TPS/inbox?tab=all&issue=TPS-2');
    const dialog = await popup();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('issue-popup')).toBeNull());
    expect(router.state.location.pathname).toBe('/TPS/inbox');
    expect(router.state.location.search).toBe('?tab=all');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('Mở toàn trang sang trang đầy đủ, popup đóng', async () => {
    server();
    const router = mountAt('/TPS/inbox?issue=TPS-2');
    const dialog = await popup();
    const full = await within(dialog).findByRole('link', { name: 'Mở toàn trang' });
    expect(full.getAttribute('href')).toBe('/TPS/issues/TPS-2');
    fireEvent.click(full);
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/issues/TPS-2'));
    await waitFor(() => expect(screen.queryByTestId('issue-popup')).toBeNull());
    expect(await screen.findByTestId('properties-panel')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Mở toàn trang' })).toBeNull();
  });

  it('trong popup, bấm yêu cầu cha thay popup tại chỗ; đóng thì về thẳng trang dưới', async () => {
    server();
    const router = mountAt('/TPS/inbox');
    fireEvent.click(screen.getByRole('link', { name: 'Mở TPS-2' }));
    const dialog = await popup();
    fireEvent.click(await within(dialog).findByRole('link', { name: 'TPS-1' }));
    await waitFor(() => expect(issueParam(router)).toBe('TPS-1'));
    expect(await within(await popup()).findByText('Yêu cầu gốc', { selector: 'h2' })).toBeTruthy();
    fireEvent.click(within(await popup()).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('issue-popup')).toBeNull());
    expect(router.state.location.pathname).toBe('/TPS/inbox');
    expect(issueParam(router)).toBeNull();
  });

  it('trang đầy đủ (link trực tiếp) không có nút Đóng, bấm yêu cầu cha sang trang đầy đủ của cha', async () => {
    server();
    const router = mountAt('/TPS/issues/TPS-2');
    expect(await screen.findByTestId('properties-panel')).toBeTruthy();
    expect(screen.queryByTestId('issue-popup')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'TPS-1' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/issues/TPS-1'));
    expect(issueParam(router)).toBeNull();
  });
});
