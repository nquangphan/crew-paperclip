// @vitest-environment jsdom
import type { DragEndEvent } from '@dnd-kit/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { boardLayout } from '@/features/issues/list/issues-board';
import { IssuesPage } from '@/features/issues/list/issues-page';
import { parseListState } from '@/features/issues/list/use-issues';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';

// Kéo thả thật cần đo vị trí phần tử, jsdom không có; giữ DndContext thật và lấy `onDragEnd` để giả cú thả.
const dnd = vi.hoisted(() => ({ onDragEnd: null as ((e: DragEndEvent) => void) | null, mounted: 0 }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      dnd.onDragEnd = props.onDragEnd ?? null;
      dnd.mounted += 1;
      return <actual.DndContext {...props} />;
    },
  };
});

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
afterEach(() => {
  cleanup();
  dnd.onDragEnd = null;
  dnd.mounted = 0;
});

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };

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

const ISSUES = [
  issue('1', { updatedAt: '2026-10-10T05:00:00.000Z', status: 'in_progress' }),
  issue('2', { parentId: '1', updatedAt: '2026-10-10T04:00:00.000Z', status: 'done' }),
  issue('3', { updatedAt: '2026-10-09T05:00:00.000Z', labels: [{ id: 'l1', name: 'research' }] }),
  issue('4', { updatedAt: '2026-10-08T05:00:00.000Z' }),
];
const ROOTS = [
  {
    id: '1',
    identifier: 'TPS-1',
    title: 'Yêu cầu 1',
    status: 'in_progress',
    updatedAt: '2026-10-10T05:00:00.000Z',
    doneChildren: 1,
    totalChildren: 2,
    kind: 'code',
    stage: { currentStageId: 's1', currentType: 'review', completed: [], position: 0 },
  },
];

function server(over: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c1/issues': { body: ISSUES },
    'POST /api/plugins/crew.core/data/crew.roots': { body: { data: ROOTS } },
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': { body: [{ id: 'a1', name: 'Trợ Lý Alpha' }] },
    ...over,
  } as Parameters<typeof mockServer>[0]);
}

function Where() {
  const loc = useLocation();
  return <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>;
}

function mount(path = '/TPS/issues?view=board') {
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

const loc = () => screen.getByTestId('loc').textContent;
const column = (status: string) =>
  screen.getAllByTestId('kanban-column').find((c) => c.getAttribute('data-status') === status) as HTMLElement;
const cardIds = (status: string) =>
  within(column(status))
    .queryAllByTestId('kanban-card')
    .map((c) => c.getAttribute('data-issue-id'));
const drop = (id: string, overId: string) =>
  act(() => dnd.onDragEnd?.({ active: { id }, over: { id: overId } } as unknown as DragEndEvent));

describe('IssuesPage chế độ Bảng', () => {
  it('nút Danh sách/Bảng ghi ?view=board vào URL; về Danh sách thì bỏ tham số', async () => {
    server();
    mount('/TPS/issues');
    await screen.findByText('Yêu cầu 1');
    expect(screen.getByRole('button', { name: 'Danh sách' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('kanban-board')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bảng' }));
    await waitFor(() => expect(loc()).toBe('/TPS/issues?view=board'));
    expect(screen.getByTestId('kanban-board')).toBeTruthy();
    expect(screen.queryAllByTestId('issue-row')).toHaveLength(0);
    // Như Paperclip: chế độ Bảng không có Sắp xếp/Nhóm.
    expect(screen.queryByRole('button', { name: 'Sắp xếp' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nhóm' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Danh sách' }));
    await waitFor(() => expect(loc()).toBe('/TPS/issues'));
    expect(screen.getAllByTestId('issue-row')).toHaveLength(ISSUES.length);
  });

  it('mỗi trạng thái một cột theo thứ tự của Paperclip, thẻ nằm đúng cột và có số đếm', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu 1');
    expect(screen.getAllByTestId('kanban-column').map((c) => c.getAttribute('data-status'))).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'blocked',
      'done',
      'cancelled',
    ]);
    expect(cardIds('in_progress')).toEqual(['1']);
    expect(cardIds('done')).toEqual(['2']);
    expect(cardIds('todo')).toEqual(['3', '4']);
    expect(cardIds('backlog')).toEqual([]);
    expect(column('todo').querySelector('[data-slot="kanban-count"]')?.textContent).toBe('2');
  });

  it('thẻ có mã, người làm và chip giai đoạn Crew, link tới trang yêu cầu', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu 1');
    const card = within(column('in_progress')).getByTestId('kanban-card');
    expect(within(card).getByText('TPS-1')).toBeTruthy();
    expect(within(card).getByText('Trợ Lý Alpha')).toBeTruthy();
    await waitFor(() => expect(within(card).getByText('Reviewer')).toBeTruthy());
    expect(within(card).getByText('1/2 con xong')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Yêu cầu 1' }).getAttribute('href')).toBe('/TPS/issues/TPS-1');
  });

  it('theo tìm kiếm và bộ lọc như danh sách', async () => {
    const { calls } = server();
    mount('/TPS/issues?view=board&q=tinh&kind=research');
    await screen.findByText('Yêu cầu 3');
    const url = calls.find((c) => c.url.startsWith('/api/companies/c1/issues'))?.url ?? '';
    expect(new URLSearchParams(url.split('?')[1]).get('q')).toBe('tinh');
    expect(screen.getAllByTestId('kanban-card').map((c) => c.getAttribute('data-issue-id'))).toEqual(['3']);
  });

  it('kéo thẻ sang cột khác gửi PATCH trạng thái mới và thẻ sang cột đó', async () => {
    const { calls } = server({
      'PATCH /api/issues/3': { body: { ...ISSUES[2], status: 'done' } },
    });
    mount();
    await screen.findByText('Yêu cầu 3');
    await waitFor(() => expect(dnd.onDragEnd).not.toBeNull());
    drop('3', 'done');
    expect(cardIds('done')).toEqual(['2', '3']);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.filter((c) => c.method === 'PATCH');
    expect(patch).toEqual([{ method: 'PATCH', url: '/api/issues/3', body: { status: 'done' } }]);
  });

  it('thả lên thẻ khác thì lấy cột của thẻ đó; thả cùng cột thì không gửi gì', async () => {
    const { calls } = server({ 'PATCH /api/issues/4': { body: { ...ISSUES[3], status: 'in_progress' } } });
    mount();
    await screen.findByText('Yêu cầu 4');
    await waitFor(() => expect(dnd.onDragEnd).not.toBeNull());
    drop('4', '3');
    drop('4', 'todo');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    drop('4', '1');
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'in_progress' });
  });

  it('server từ chối (422) thì thẻ về cột cũ, hiện nguyên văn câu lỗi và không thử lại', async () => {
    const message = 'Không chuyển được sang done: yêu cầu còn chờ Owner duyệt';
    const { calls } = server({ 'PATCH /api/issues/3': { status: 422, body: { error: message } } });
    mount();
    await screen.findByText('Yêu cầu 3');
    await waitFor(() => expect(dnd.onDragEnd).not.toBeNull());
    drop('3', 'done');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Không đổi được trạng thái của TPS-3')).toBeTruthy();
    expect(within(alert).getByText(message)).toBeTruthy();
    expect(cardIds('todo')).toEqual(['3', '4']);
    expect(cardIds('done')).toEqual(['2']);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('người chỉ đọc (viewer) xem được bảng nhưng không kéo được', async () => {
    server(accessRoute('c1', { userId: 'u1', membershipRole: 'viewer', contributor: false, canApprove: false }));
    mount();
    await screen.findByText('Yêu cầu 1');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByTestId('kanban-card')).toHaveLength(ISSUES.length);
    expect(dnd.mounted).toBe(0);
    expect(document.querySelector('[aria-roledescription="sortable"]')).toBeNull();
  });
});

describe('trạng thái xem của bảng', () => {
  it('đọc view, mật độ, cột lạnh, số thẻ mỗi cột từ URL; giá trị lạ về mặc định', () => {
    const s = parseListState(new URLSearchParams('view=board&density=compact&lanes=collapsed&per=25'));
    expect([s.view, s.density, s.lanes, s.pageSize]).toEqual(['board', 'compact', 'collapsed', 25]);
    const d = parseListState(new URLSearchParams('view=grid&density=x&lanes=y&per=7'));
    expect([d.view, d.density, d.lanes, d.pageSize]).toEqual(['list', 'auto', 'expanded', 10]);
  });

  it('quá 100 thẻ thì mật độ tự động chuyển thẻ gọn; thu cột lạnh thu Backlog, Xong, Đã hủy', () => {
    const auto = parseListState(new URLSearchParams('view=board'));
    expect(boardLayout(auto, 100).compact).toBe(false);
    expect(boardLayout(auto, 101).compact).toBe(true);
    expect(boardLayout({ ...auto, density: 'comfortable' }, 500).compact).toBe(false);
    expect(boardLayout(auto, 0).collapsedStatuses).toEqual([]);
    expect(boardLayout({ ...auto, lanes: 'collapsed' }, 0).collapsedStatuses).toEqual(['backlog', 'done', 'cancelled']);
    expect(boardLayout(auto, 0).customized).toBe(false);
    expect(boardLayout({ ...auto, pageSize: 25 }, 0).customized).toBe(true);
  });
});
