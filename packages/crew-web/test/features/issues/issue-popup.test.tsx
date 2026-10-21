// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext, MeContext } from '@/app/hooks';
import { IssueLink, IssuePopupHost } from '@/features/issues';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer, projectAccessRoute } from '../../app/fetch-mock';
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

function server(extra: Record<string, unknown> = {}) {
  const issueRoutes = (i: typeof ISSUE | typeof PARENT) => ({
    [`GET /api/issues/${i.identifier}`]: { body: i },
    [`GET /api/issues/${i.id}/comments`]: { body: [] },
    [`GET /api/issues/${i.id}/attachments`]: { body: [] },
    [`GET /api/issues/${i.id}/documents`]: { body: [] },
    [`GET /api/issues/${i.id}/runs`]: { body: [] },
    [`GET /api/issues/${i.id}/live-runs`]: { body: [] },
    [`GET /api/issues/${i.id}/interactions`]: { body: [] },
    [`GET /api/issues/${i.id}/activity`]: { body: [] },
    [`POST /api/issues/${i.id}/read`]: { body: { id: i.id } },
  });
  return mockServer({
    ...issueRoutes(ISSUE),
    ...issueRoutes(PARENT),
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/issues': { body: [] },
    ...extra,
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
/** Link mã cha trên thanh trên cùng (chuỗi tổ tiên); cột Thuộc tính cũng có link cùng tên. */
const parentLink = async (scope: HTMLElement) => {
  const bar = await waitFor(() => {
    const el = scope.querySelector('[data-slot="issue-top-bar"]');
    if (!el) throw new Error('chưa có thanh trên cùng');
    return el as HTMLElement;
  });
  return within(bar).findByRole('link', { name: 'TPS-1' });
};
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
    expect(await within(dialog).findByText('Sửa trang đăng nhập', { selector: 'h1' })).toBeTruthy();
    expect(screen.getByTestId('under')).toBeTruthy();
    // đủ ba khe Crew và cột Thuộc tính
    expect(within(dialog).getByTestId('properties-panel')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Gửi bình luận' })).toBeTruthy();
    // Ép Done cạnh nút cổng, Lịch sử dưới Thuộc tính, chạy được trong popup
    expect(within(dialog).getByRole('button', { name: 'Ép Done' })).toBeTruthy();
    expect(await within(dialog).findByRole('region', { name: 'Lịch sử' })).toBeTruthy();

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
    fireEvent.click(await parentLink(dialog));
    await waitFor(() => expect(issueParam(router)).toBe('TPS-1'));
    expect(await within(await popup()).findByText('Yêu cầu gốc', { selector: 'h1' })).toBeTruthy();
    fireEvent.click(within(await popup()).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('issue-popup')).toBeNull());
    expect(router.state.location.pathname).toBe('/TPS/inbox');
    expect(issueParam(router)).toBeNull();
  });

  it('mở yêu cầu khác trong popup đẩy history: Back và nút Quay lại về yêu cầu trước, Đóng về thẳng trang dưới', async () => {
    server();
    const router = mountAt('/TPS/inbox');
    fireEvent.click(screen.getByRole('link', { name: 'Mở TPS-2' }));
    let dialog = await popup();
    // yêu cầu đầu tiên của popup: chưa có gì để quay lại
    await within(dialog).findByText('Sửa trang đăng nhập', { selector: 'h1' });
    expect(within(dialog).queryByRole('button', { name: 'Quay lại' })).toBeNull();
    fireEvent.click(await parentLink(dialog));
    await waitFor(() => expect(issueParam(router)).toBe('TPS-1'));
    expect(router.state.historyAction).toBe('PUSH');
    dialog = await popup();
    await within(dialog).findByText('Yêu cầu gốc', { selector: 'h1' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quay lại' }));
    await waitFor(() => expect(issueParam(router)).toBe('TPS-2'));
    // Back của trình duyệt cũng quay về yêu cầu trước
    fireEvent.click(await parentLink(await popup()));
    await waitFor(() => expect(issueParam(router)).toBe('TPS-1'));
    await router.navigate(-1);
    await waitFor(() => expect(issueParam(router)).toBe('TPS-2'));
    // sang cha rồi Đóng: lùi hết các mục popup, về thẳng trang dưới
    fireEvent.click(await parentLink(await popup()));
    await waitFor(() => expect(issueParam(router)).toBe('TPS-1'));
    await within(await popup()).findByText('Yêu cầu gốc', { selector: 'h1' });
    fireEvent.click(within(await popup()).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('issue-popup')).toBeNull());
    expect(router.state.location.pathname).toBe('/TPS/inbox');
    expect(issueParam(router)).toBeNull();
    await router.navigate(-1);
    expect(router.state.location.pathname).not.toContain('TPS-1');
  });

  it('thanh trên cùng có chuỗi tổ tiên: bấm mã cha mở cha', async () => {
    server();
    const router = mountAt('/TPS/inbox');
    fireEvent.click(screen.getByRole('link', { name: 'Mở TPS-2' }));
    const dialog = await popup();
    await within(dialog).findByText('Sửa trang đăng nhập', { selector: 'h1' });
    fireEvent.click(await parentLink(dialog));
    await waitFor(() => expect(issueParam(router)).toBe('TPS-1'));
  });

  it('trang đầy đủ (link trực tiếp) không có nút Đóng, bấm yêu cầu cha sang trang đầy đủ của cha', async () => {
    server();
    const router = mountAt('/TPS/issues/TPS-2');
    expect(await screen.findByTestId('properties-panel')).toBeTruthy();
    expect(screen.queryByTestId('issue-popup')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.click(await parentLink(document.body));
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/issues/TPS-1'));
    expect(issueParam(router)).toBeNull();
  });

  it('a11y: tiêu đề yêu cầu là h1 duy nhất, ở trang đầy đủ và trong popup (popup đặt tên hộp bằng chính h1)', async () => {
    server();
    mountAt('/TPS/issues/TPS-2');
    expect(await screen.findByTestId('properties-panel')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Sửa trang đăng nhập']);
    cleanup();

    mountAt('/TPS/inbox?issue=TPS-2');
    const dialog = await popup();
    const h1 = await within(dialog).findByRole('heading', { level: 1, name: 'Sửa trang đăng nhập' });
    expect(within(dialog).getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1.getAttribute('data-slot')).toBe('dialog-title');
    expect(screen.getByRole('dialog', { name: 'Sửa trang đăng nhập' })).toBe(dialog);
  });

  /** Nháp: `backlog`, giao Trợ Lý, chưa vào stage nào. Đọc lại trước khi gửi qua uuid; PATCH đổi sang `todo`. */
  function draftServer() {
    const draft = { ...ISSUE, status: 'backlog', executionState: null };
    let current: unknown = draft;
    const s = server({
      'GET /api/issues/TPS-2': () => ({ body: current }),
      'GET /api/issues/i1': () => ({ body: current }),
      'PATCH /api/issues/i1': () => {
        current = { ...draft, status: 'todo' };
        return { body: current };
      },
    });
    return { ...s, patches: () => s.calls.filter((c) => c.method === 'PATCH') };
  }

  it('popup của yêu cầu nháp: rõ là nháp, Bắt đầu làm gửi {status:"todo"} và báo ngay trong popup', async () => {
    const s = draftServer();
    mountAt('/TPS/inbox?issue=TPS-2');
    const dialog = await popup();
    expect(await within(dialog).findByText('Yêu cầu nháp: agent chưa làm')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bắt đầu làm' }));
    await waitFor(() => expect(s.patches()).toHaveLength(1));
    expect(s.patches()[0].body).toEqual({ status: 'todo' });
    expect(await within(dialog).findByText('Đã bắt đầu TPS-2')).toBeTruthy();
    await waitFor(() => expect(within(dialog).queryByText('Yêu cầu nháp: agent chưa làm')).toBeNull());
    expect(within(dialog).queryByRole('button', { name: 'Bắt đầu làm' })).toBeNull();
  });

  it('trang đầy đủ của yêu cầu nháp: thông báo Bắt đầu làm nổi ở góc (host khi không có popup)', async () => {
    const s = draftServer();
    mountAt('/TPS/issues/TPS-2');
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu làm' }));
    await waitFor(() => expect(s.patches()).toHaveLength(1));
    const notice = await screen.findByTestId('start-work-notice');
    expect(notice.getAttribute('data-slot')).toBe('floating-notice');
    expect(within(notice).getByText('Đã bắt đầu TPS-2')).toBeTruthy();
    expect(screen.getAllByTestId('start-work-notice')).toHaveLength(1);
  });

  it('mở bằng URL yêu cầu của project không được cấp: báo không có quyền, không đánh dấu đã đọc', async () => {
    const { calls } = server(projectAccessRoute('c1', ['p-khac']));
    mountAt('/TPS/inbox?issue=TPS-2');
    const dialog = await popup();
    expect(await within(dialog).findByText('Bạn không có quyền xem yêu cầu này')).toBeTruthy();
    expect(within(dialog).queryByText('Sửa trang đăng nhập', { selector: 'h1' })).toBeNull();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/read'))).toBe(false);
  });
});
