// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { RoadmapPage } from '@/features/roadmap/roadmap-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer, projectAccessRoute } from '../../app/fetch-mock';

beforeAll(async () => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixStub {
    m22 = 1;
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixStub);
  // Giảm chuyển động: camera đổi tức thì nên cú bấm đi sâu đổi tầng ngay.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P Solutions', issuePrefix: 'TPS' };

const issue = (id: string, n: number, over: Record<string, unknown> = {}) => ({
  id,
  identifier: `TPS-${n}`,
  title: `Việc ${id}`,
  status: 'todo',
  parentId: null,
  projectId: 'p1',
  createdByUserId: 'u1',
  createdByAgentId: null,
  assigneeAgentId: null,
  createdAt: `2026-10-0${n % 9 || 1}T00:00:00.000Z`,
  updatedAt: '2026-10-10T00:00:00.000Z',
  blockedBy: [],
  ...over,
});

const ISSUES = [
  issue('r1', 1, { title: 'Trang đăng nhập', status: 'in_progress' }),
  issue('c1', 2, { parentId: 'r1', title: 'Form đăng nhập', status: 'done', assigneeAgentId: 'a1' }),
  issue('c2', 3, { parentId: 'r1', title: 'Duyệt CLI', blockedBy: [{ id: 'c1' }] }),
  issue('agentRoot', 4, { title: 'Việc của agent', createdByUserId: null, createdByAgentId: 'a1' }),
  issue('rB', 5, { projectId: 'p2', title: 'Yêu cầu của B' }),
  issue('loose', 6, { projectId: null, title: 'Yêu cầu lẻ' }),
];

const PAGES = [
  { path: 'README.md', title: 'Giới thiệu', parentPath: null },
  { path: 'docs/index.md', title: 'Mục lục', parentPath: null },
];

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c1/projects': {
      body: [
        { id: 'p1', name: 'Alpha', color: '#2b59c3', archivedAt: null },
        { id: 'p2', name: 'Beta', color: null, archivedAt: null },
      ],
    },
    'GET /api/companies/c1/issues': { body: ISSUES },
    'GET /api/companies/c1/agents': { body: [{ id: 'a1', name: 'Dev Agent' }] },
    'POST /api/plugins/crew.core/data/crew.docs.projects': { body: { data: [{ projectId: 'p1', repo: 'crew' }] } },
    'POST /api/plugins/crew.core/data/crew.docs.tree': {
      body: {
        data: {
          repo: 'crew',
          commit: 'abcdef1234',
          auditState: 'ok',
          receivedAt: '2026-10-10T00:00:00.000Z',
          machineId: 'm',
          dropped: [],
          pages: PAGES,
        },
      },
    },
    'POST /api/plugins/crew.core/data/crew.docs.page': {
      body: {
        data: {
          path: 'README.md',
          title: 'Giới thiệu',
          text: '# Giới thiệu\n\nNội dung trang giới thiệu.',
          links: [],
        },
      },
    },
    ...extra,
  } as Parameters<typeof mockServer>[0]);
}

function Where() {
  const loc = useLocation();
  return <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>;
}

function mount(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/:companyPrefix/roadmap',
        element: (
          <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
            <RoadmapPage />
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
  return router;
}

const node = (id: string) => document.querySelector<HTMLButtonElement>(`button[data-roadmap-id="${id}"]`);
const nodeIds = () =>
  [...document.querySelectorAll<HTMLElement>('button[data-roadmap-id]')].map((b) => b.dataset.roadmapId);
const loc = () => screen.getByTestId('loc').textContent ?? '';

describe('RoadmapPage', () => {
  it('owner: công ty ở giữa, mọi project và "Chưa gắn project"; đếm chỉ yêu cầu do người tạo', async () => {
    server();
    mount('/TPS/roadmap');
    await waitFor(() => expect(node('p1')).toBeTruthy());
    expect(nodeIds()).toEqual(['company', 'p1', 'p2', 'none']);
    expect(node('p1')?.getAttribute('aria-label')).toBe('Project Alpha: 1 yêu cầu, 1 đang mở');
    expect(node('company')?.getAttribute('aria-label')).toContain('2 project');
    expect(screen.getByRole('heading', { name: 'Roadmap' })).toBeTruthy();
  });

  it('bấm project đổi URL sang tầng project; không thấy việc gốc do agent; có nút Docs', async () => {
    server();
    mount('/TPS/roadmap');
    await waitFor(() => expect(node('p1')).toBeTruthy());
    fireEvent.click(node('p1') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?project=p1'));
    await waitFor(() => expect(node('r1')).toBeTruthy());
    expect(node('agentRoot')).toBeNull();
    await waitFor(() => expect(node('docs:p1')?.textContent).toContain('2 trang'));
    expect(screen.getByRole('link', { name: '2P Solutions' }).getAttribute('href')).toBe('/TPS/roadmap');
  });

  it('tầng yêu cầu: việc con, cạnh chặn; bấm việc con mở popup ?issue=; Esc lùi về tầng project', async () => {
    server();
    mount('/TPS/roadmap?project=p1&request=TPS-1');
    await waitFor(() => expect(node('c2')).toBeTruthy());
    // Việc đang mở đứng trước việc đã xong.
    expect(nodeIds()).toEqual(['r1', 'c2', 'c1']);
    await waitFor(() =>
      expect(node('c1')?.getAttribute('aria-label')).toBe('TPS-2: Form đăng nhập, Hoàn thành, Dev Agent'),
    );
    fireEvent.click(node('c2') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toContain('issue=TPS-3'));
    // Popup đang mở (?issue=) thì Esc không lùi tầng.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(loc()).toContain('request=TPS-1');
  });

  it('Esc lùi một tầng khi không có popup', async () => {
    server();
    mount('/TPS/roadmap?project=p1&request=TPS-1');
    await waitFor(() => expect(node('c2')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?project=p1'));
  });

  it('dạng danh sách cho cùng nội dung tầng', async () => {
    server();
    mount('/TPS/roadmap?project=p1&request=TPS-1&view=list');
    const list = await screen.findByRole('region', { name: 'Bản đồ dạng danh sách' });
    await waitFor(() => expect(list.querySelector('[data-roadmap-id="c2"]')).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Chú giải' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bản đồ' }));
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?project=p1&request=TPS-1'));
  });

  it('yêu cầu không có hoặc của project khác: thông báo chung', async () => {
    server();
    mount('/TPS/roadmap?project=p1&request=TPS-5');
    expect(await screen.findByText('Không tìm thấy hoặc bạn không được xem')).toBeTruthy();
  });

  it('thành viên bị giới hạn: chỉ project được cấp, không có "Chưa gắn project", deep link project khác ra thông báo chung', async () => {
    server(projectAccessRoute('c1', ['p1']));
    mount('/TPS/roadmap');
    await waitFor(() => expect(node('p1')).toBeTruthy());
    expect(nodeIds()).toEqual(['company', 'p1']);
    cleanup();
    server(projectAccessRoute('c1', ['p1']));
    mount('/TPS/roadmap?project=p2');
    expect(await screen.findByText('Không tìm thấy hoặc bạn không được xem')).toBeTruthy();
    expect(node('rB')).toBeNull();
    cleanup();
    server(projectAccessRoute('c1', ['p1']));
    mount('/TPS/roadmap?project=none');
    expect(await screen.findByText('Không tìm thấy hoặc bạn không được xem')).toBeTruthy();
  });

  it('chưa được cấp project nào: EmptyState hướng dẫn', async () => {
    server(projectAccessRoute('c1', []));
    mount('/TPS/roadmap');
    expect(await screen.findByText('Bạn chưa được cấp project nào')).toBeTruthy();
  });

  it('nhánh Docs: thư mục và trang; bấm trang mở popup đọc có link sang trang Docs', async () => {
    server();
    mount('/TPS/roadmap?project=p1&docs=1');
    await waitFor(() => expect(node('page:README.md')).toBeTruthy());
    expect(nodeIds()).toEqual(['docs:p1', 'dir:docs', 'page:README.md']);
    fireEvent.click(node('dir:docs') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?project=p1&docs=1&folder=docs'));
    await waitFor(() => expect(node('page:docs/index.md')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/TPS/roadmap?project=p1&docs=1');
    cleanup();
    server();
    mount('/TPS/roadmap?project=p1&docs=1');
    await waitFor(() => expect(node('page:README.md')).toBeTruthy());
    fireEvent.click(node('page:README.md') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?project=p1&docs=1&doc=README.md'));
    const popup = await screen.findByTestId('roadmap-doc-popup');
    await waitFor(() => expect(popup.textContent).toContain('Nội dung trang giới thiệu.'));
    expect(screen.getByRole('link', { name: 'Mở trong trang Docs' }).getAttribute('href')).toBe(
      '/TPS/docs?project=p1&path=README.md',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?project=p1&docs=1'));
  });

  it('project chưa có docs: nút Docs mờ, không vào được; deep link docs ra thông báo chung', async () => {
    server({ 'POST /api/plugins/crew.core/data/crew.docs.projects': { body: { data: [] } } });
    mount('/TPS/roadmap?project=p1');
    await waitFor(() => expect(node('docs:p1')?.getAttribute('aria-disabled')).toBe('true'));
    fireEvent.click(node('docs:p1') as HTMLButtonElement);
    expect(loc()).toBe('/TPS/roadmap?project=p1');
    cleanup();
    server({ 'POST /api/plugins/crew.core/data/crew.docs.projects': { body: { data: [] } } });
    mount('/TPS/roadmap?project=p1&docs=1');
    expect(await screen.findByText('Không tìm thấy hoặc bạn không được xem')).toBeTruthy();
  });
});
