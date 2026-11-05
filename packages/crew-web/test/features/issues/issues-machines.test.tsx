// @vitest-environment jsdom
// Nhãn máy trên danh sách và thẻ Bảng, lọc theo máy (TPS-753, mockup TPS-751 docs/design/mockups/tps-750-machine-label).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IssueMachineSummary } from '@/api';
import { CompanyContext } from '@/app/hooks';
import { IssuesPage } from '@/features/issues/list/issues-page';
import {
  machineCounts,
  machineDisplayNames,
  machineShortName,
  machineStateOf,
  matchesMachine,
} from '@/features/issues/list/machines';
import { parseListState, patchParams } from '@/features/issues/list/use-issues';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

vi.mock('@/features/readiness', () => ({
  useProjectReadiness: () => ({
    isLoading: false,
    data: [{ projectId: 'p1', state: 'ready', failed: [], agents: [] }],
  }),
}));

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const BATCH = 'POST /api/crew/companies/c1/issue-machines';

const issue = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  identifier: `TPS-${id}`,
  title: `Yêu cầu ${id}`,
  status: 'todo',
  parentId: null,
  projectId: 'p1',
  assigneeAgentId: 'a1',
  updatedAt: '2026-10-10T01:00:00.000Z',
  createdAt: '2026-10-09T01:00:00.000Z',
  labels: [],
  ...over,
});

// 1 gốc ghim máy online, 2 con của 1 (kế thừa), 3 gốc ghim máy offline, 4 gốc ghim máy đã gỡ ghép, 5 chưa ghim.
const ISSUES = [
  issue('1', { updatedAt: '2026-10-10T05:00:00.000Z', status: 'in_progress' }),
  issue('2', { parentId: '1', updatedAt: '2026-10-10T04:00:00.000Z' }),
  issue('3', { updatedAt: '2026-10-09T05:00:00.000Z', status: 'blocked' }),
  issue('4', { updatedAt: '2026-10-08T05:00:00.000Z' }),
  issue('5', { updatedAt: '2026-10-07T05:00:00.000Z', status: 'backlog' }),
];
const MINI = { rootIssueId: '1', machineId: 'm-mini', hostname: 'phans-mac-mini.local', online: true, paired: true };
const ITEMS: Record<string, IssueMachineSummary | null> = {
  '1': MINI,
  '2': MINI,
  '3': { rootIssueId: '3', machineId: 'm-book', hostname: 'phans-macbook-pro', online: false, paired: true },
  '4': { rootIssueId: '4', machineId: 'm-gone', hostname: null, online: false, paired: false },
  '5': null,
};

function server(over: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c1/issues': { body: ISSUES },
    'POST /api/plugins/crew.core/data/crew.roots': { body: { data: [] } },
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': { body: [{ id: 'a1', name: 'Trợ Lý Alpha' }] },
    [BATCH]: { body: { items: ITEMS } },
    ...over,
  } as Parameters<typeof mockServer>[0]);
}

function Where() {
  const loc = useLocation();
  return <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>;
}

function mount(path = '/TPS/issues') {
  const router = createMemoryRouter(
    [
      {
        path: '/:companyPrefix/issues',
        element: (
          <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
            <IssuesPage />
            <Where />
          </CompanyContext.Provider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const rows = () => screen.getAllByTestId('issue-row');
const row = (id: string) => rows().find((r) => r.getAttribute('data-issue-id') === id) as HTMLElement;
const idOf = (r: HTMLElement) => r.getAttribute('data-issue-id');
const loc = () => screen.getByTestId('loc').textContent;
/** Nhãn ở cột Máy (desktop) của dòng. */
const cell = (id: string) =>
  row(id).querySelector('[data-slot="task-row-trailing"] [data-slot="machine-label"]') as HTMLElement | null;
/** Nhãn ở dòng phụ dưới tiêu đề (màn hẹp). */
const subline = (id: string) => row(id).querySelector('[data-slot="task-row-subline"]') as HTMLElement | null;
const batchCalls = (calls: { method: string; url: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith('/issue-machines'));

describe('nhãn máy trên danh sách yêu cầu', () => {
  it('gốc ghim, con kế thừa, offline, đã gỡ ghép, chưa ghim; không hiện id thô', async () => {
    server();
    mount();
    await waitFor(() => expect(cell('1')).not.toBeNull());

    // Gốc và con cùng nhãn máy của gốc; tên bỏ hậu tố miền.
    for (const id of ['1', '2']) {
      expect(cell(id)?.getAttribute('data-state')).toBe('online');
      expect(cell(id)?.textContent).toBe('phans-mac-mini');
      expect(cell(id)?.getAttribute('aria-label')).toBe('Máy phans-mac-mini, đang kết nối');
    }
    // Offline: icon riêng, cột desktop không có chữ trạng thái (có tooltip), aria nêu trạng thái.
    expect(cell('3')?.getAttribute('data-state')).toBe('offline');
    expect(cell('3')?.textContent).toBe('phans-macbook-pro');
    expect(cell('3')?.getAttribute('aria-label')).toBe('Máy phans-macbook-pro, mất liên lạc');
    expect(cell('3')?.querySelector('[data-slot="machine-label-indicator"] svg')).not.toBeNull();
    // Đã gỡ ghép: server không trả tên máy, nhãn ghi trạng thái thay vì id.
    expect(cell('4')?.getAttribute('data-state')).toBe('unpaired');
    expect(cell('4')?.textContent).toBe('Đã gỡ ghép');
    // Chưa ghim: chữ xám "Chưa ghim" ở cột desktop, không chỉ báo.
    expect(cell('5')?.getAttribute('data-state')).toBe('unpinned');
    expect(cell('5')?.textContent).toBe('Chưa ghim');
    expect(cell('5')?.querySelector('[data-slot="machine-label-indicator"]')).toBeNull();

    const text = document.body.textContent ?? '';
    for (const raw of ['m-mini', 'm-book', 'm-gone']) expect(text).not.toContain(raw);
  });

  it('màn hẹp: dòng phụ dưới tiêu đề có chữ trạng thái; chưa ghim thì không có dòng phụ', async () => {
    server();
    mount();
    await waitFor(() => expect(subline('3')).not.toBeNull());
    expect(subline('1')?.textContent).toBe('phans-mac-mini');
    expect(subline('3')?.textContent).toBe('phans-macbook-pro · mất liên lạc');
    expect(subline('4')?.textContent).toBe('Đã gỡ ghép');
    expect(subline('5')).toBeNull();
  });

  it('chỉ một request lô cho cả danh sách, gửi id mọi dòng', async () => {
    const { calls } = server();
    mount();
    await waitFor(() => expect(cell('1')).not.toBeNull());
    expect(batchCalls(calls)).toHaveLength(1);
    expect((batchCalls(calls)[0]?.body as { issueIds: string[] } | undefined)?.issueIds).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(calls.filter((c) => /\/issues\/[^/]+\/machine$/.test(c.url))).toEqual([]);
  });

  it('lỗi tải máy: dòng lỗi có Thử lại, ô Máy hiện "—", danh sách vẫn hiện', async () => {
    let fail = true;
    const { calls } = server({
      [BATCH]: () => (fail ? { status: 500, body: { error: 'hỏng' } } : { body: { items: ITEMS } }),
    });
    mount();
    expect(await screen.findByText('Không tải được máy của các yêu cầu.')).toBeTruthy();
    expect(rows()).toHaveLength(5);
    expect(row('1').querySelector('[data-slot="machine-label-missing"]')?.textContent).toBe('—');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(cell('1')?.getAttribute('data-state')).toBe('online'));
    expect(batchCalls(calls)).toHaveLength(2);
  });

  it('cột Máy tắt được trong menu Cột và ghi vào URL', async () => {
    server();
    mount('/TPS/issues?hide=machine');
    await screen.findByText('Yêu cầu 1');
    await waitFor(() => expect(subline('1')).not.toBeNull());
    expect(cell('1')).toBeNull();
  });
});

describe('lọc theo máy', () => {
  it('URL ?machine=<id> chỉ còn cây chạy trên máy đó, gồm con kế thừa', async () => {
    server();
    mount('/TPS/issues?machine=m-mini');
    await screen.findByText('Yêu cầu 1');
    await waitFor(() => expect(rows().map(idOf)).toEqual(['1', '2']));
    expect(screen.getByRole('button', { name: 'Lọc: 1' })).toBeTruthy();
  });

  it('URL ?machine=unpinned chỉ còn cây chưa ghim', async () => {
    server();
    mount('/TPS/issues?machine=unpinned');
    await waitFor(() => expect(rows().map(idOf)).toEqual(['5']));
  });

  it('mục Máy trong popover Lọc: tên, số yêu cầu, Chưa ghim; chọn thì ghi URL, Xóa thì bỏ', async () => {
    const { calls } = server();
    mount();
    await waitFor(() => expect(cell('1')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Lọc' }));
    const group = (await screen.findByText('Máy', { selector: 'legend' })).closest('fieldset') as HTMLElement;
    const options = within(group)
      .getAllByRole('checkbox')
      .map((c) => c.getAttribute('aria-label'));
    expect(options).toEqual(['phans-mac-mini', 'phans-macbook-pro', 'Đã gỡ ghép', 'Chưa ghim']);
    expect(
      within(group)
        .getAllByTestId('filter-option-count')
        .map((n) => n.textContent),
    ).toEqual(['2', '1', '1', '1']);
    expect(within(group).getByText('mất liên lạc')).toBeTruthy();

    fireEvent.click(within(group).getByRole('checkbox', { name: 'phans-macbook-pro' }));
    await waitFor(() => expect(loc()).toBe('/TPS/issues?machine=m-book'));
    await waitFor(() => expect(rows().map(idOf)).toEqual(['3']));

    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(loc()).toBe('/TPS/issues'));
    // Lọc ở máy khách: đổi bộ lọc máy không gọi lại route lô.
    expect(batchCalls(calls)).toHaveLength(1);
  });
});

describe('nhãn máy trên thẻ Bảng', () => {
  it('dòng máy cuối thẻ có chữ trạng thái khi không online; chưa ghim thì không có dòng', async () => {
    const { calls } = server();
    mount('/TPS/issues?view=board');
    await screen.findByText('Yêu cầu 1');
    const card = (id: string) =>
      screen.getAllByTestId('kanban-card').find((c) => c.getAttribute('data-issue-id') === id) as HTMLElement;
    const line = (id: string) => card(id).querySelector('[data-slot="kanban-card-machine"]');
    await waitFor(() => expect(line('1')).not.toBeNull());
    expect(line('1')?.textContent).toBe('phans-mac-mini');
    expect(line('2')?.textContent).toBe('phans-mac-mini');
    expect(line('3')?.textContent).toBe('phans-macbook-pro · mất liên lạc');
    expect(line('4')?.textContent).toBe('Đã gỡ ghép');
    expect(line('5')).toBeNull();
    expect(batchCalls(calls)).toHaveLength(1);
  });
});

describe('luật nhãn máy', () => {
  it('tên gọn bỏ hậu tố miền', () => {
    expect(machineShortName('phans-macbook-pro.local')).toBe('phans-macbook-pro');
    expect(machineShortName('mini.tail1234.ts.net')).toBe('mini');
    expect(machineShortName('Phans-Mac-mini')).toBe('Phans-Mac-mini');
  });

  it('hai máy trùng tên gọn: máy sau thêm "#2", không dùng id', () => {
    const a = { rootIssueId: 'r1', machineId: 'm-a', hostname: 'mini.local', online: true, paired: true };
    const b = { rootIssueId: 'r2', machineId: 'm-b', hostname: 'mini', online: true, paired: true };
    const names = machineDisplayNames([b, a, a]);
    expect(names.get('m-a')).toBe('mini');
    expect(names.get('m-b')).toBe('mini #2');
  });

  it('trạng thái: chưa ghim, đã gỡ ghép, offline, online', () => {
    expect(machineStateOf(null)).toBe('unpinned');
    expect(machineStateOf(ITEMS['4'])).toBe('unpaired');
    expect(machineStateOf(ITEMS['3'])).toBe('offline');
    expect(machineStateOf(ITEMS['1'])).toBe('online');
  });

  it('matchesMachine: rỗng là không lọc, unpinned là chưa ghim, chưa có dữ liệu thì không khớp', () => {
    const i1 = issue('1') as never;
    const i5 = issue('5') as never;
    expect(matchesMachine(i1, '', undefined)).toBe(true);
    expect(matchesMachine(i1, 'm-mini', undefined)).toBe(false);
    expect(matchesMachine(i1, 'm-mini', ITEMS)).toBe(true);
    expect(matchesMachine(i5, 'm-mini', ITEMS)).toBe(false);
    expect(matchesMachine(i5, 'unpinned', ITEMS)).toBe(true);
    expect(matchesMachine(i1, 'unpinned', ITEMS)).toBe(false);
  });

  it('đếm số yêu cầu theo máy và chưa ghim', () => {
    const counts = machineCounts(ISSUES as never, ITEMS);
    expect(Object.fromEntries(counts)).toEqual({ 'm-mini': 2, 'm-book': 1, 'm-gone': 1, unpinned: 1 });
  });

  it('URL state: ?machine= đọc vào ListState và ghi lại', () => {
    expect(parseListState(new URLSearchParams('machine=m-book')).machine).toBe('m-book');
    expect(parseListState(new URLSearchParams('')).machine).toBe('');
    expect(patchParams(new URLSearchParams(''), { machine: 'unpinned' }).toString()).toBe('machine=unpinned');
    expect(patchParams(new URLSearchParams('machine=m-a'), { machine: null }).toString()).toBe('');
  });
});
