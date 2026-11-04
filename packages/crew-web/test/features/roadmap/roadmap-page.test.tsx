// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { RoadmapPage } from '@/features/roadmap/roadmap-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer, projectAccessRoute } from '../../app/fetch-mock';

// Khung bản đồ 1200×800 (xyflow đọc offsetWidth/offsetHeight); ResizeObserver gọi lại ngay để nút được đo.
let reduce = true;
beforeAll(async () => {
  class ResizeObserverStub {
    constructor(
      private readonly cb: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void,
    ) {}
    observe(el: Element) {
      queueMicrotask(() => this.cb([{ target: el, contentRect: { width: 1200, height: 800 } }]));
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixStub {
    m22 = 1;
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixStub);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 800 });
  // Giảm chuyển động (mặc định trong file này): camera nhảy tức thì nên kiểm được vị trí ngay.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  await initI18n();
  await setLanguage('vi');
});
afterEach(() => {
  cleanup();
  reduce = true;
});

const COMPANY = { id: 'c1', name: '2P Solutions', issuePrefix: 'TPS' };

interface Row {
  id: string;
  n: number;
  title?: string;
  status?: string;
  parentId?: string | null;
  projectId?: string | null;
  createdByUserId?: string | null;
  assignee?: string;
}
const ROWS: Row[] = [
  { id: 'r1', n: 1, title: 'Trang đăng nhập', status: 'in_progress' },
  { id: 'c1', n: 2, parentId: 'r1', title: 'Form đăng nhập', status: 'done', assignee: 'Dev Agent' },
  { id: 'c2', n: 3, parentId: 'r1', title: 'Duyệt CLI', status: 'in_progress' },
  { id: 'c3', n: 4, parentId: 'c2', title: 'Việc cấp 2' },
  { id: 'rB', n: 5, projectId: 'p2', title: 'Yêu cầu của B' },
  { id: 'loose', n: 6, projectId: null, title: 'Yêu cầu lẻ' },
];

/** Đúng điều worker `crew.roadmap` trả: cây của yêu cầu gốc do người tạo, cạnh do worker cung cấp. */
function roadmapOf(rows: Row[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = (r: Row): Row => (r.parentId ? rootOf(byId.get(r.parentId) as Row) : r);
  return {
    requests: rows.filter((r) => !r.parentId).map((r) => r.id),
    nodes: rows.map((r) => ({
      id: r.id,
      identifier: `TPS-${r.n}`,
      title: r.title ?? `Việc ${r.id}`,
      status: r.status ?? 'todo',
      parentId: r.parentId ?? null,
      rootId: rootOf(r).id,
      projectId: r.projectId === undefined ? 'p1' : r.projectId,
      createdByUserId: 'u1',
      createdAt: `2026-10-0${r.n}T00:00:00.000Z`,
      updatedAt: '2026-10-10T00:00:00.000Z',
      assignee: r.assignee ? { id: 'a1', name: r.assignee } : null,
      stage: null,
      reviewRounds: 0,
      maxReviewRounds: 3,
      kind: 'code',
      bundle: null,
    })),
    edges: [
      ...rows.filter((r) => r.parentId).map((r) => ({ kind: 'parent', from: r.parentId, to: r.id })),
      { kind: 'dependency', from: 'c1', to: 'c2' },
    ],
    diagnostics: [],
    truncated: false,
  };
}

const PAGES = [
  { path: 'README.md', title: 'Giới thiệu', parentPath: null },
  { path: 'docs/index.md', title: 'Mục lục', parentPath: 'docs' },
];

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c1/projects': {
      body: [
        { id: 'p1', name: 'Alpha', color: '#2b59c3', archivedAt: null },
        { id: 'p2', name: 'Beta', color: null, archivedAt: null },
      ],
    },
    'POST /api/plugins/crew.core/data/crew.roadmap': { body: { data: roadmapOf(ROWS) } },
    'POST /api/plugins/crew.core/data/crew.runs': { body: { data: { byIssue: {}, tree: null } } },
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
        data: { path: 'README.md', title: 'Giới thiệu', text: '# Giới thiệu\n\nNội dung trang giới thiệu.', links: [] },
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

const canvas = () => document.querySelector<HTMLElement>('[data-slot="roadmap-canvas"]');
const node = (id: string) => canvas()?.querySelector<HTMLButtonElement>(`button[data-roadmap-id="${id}"]`) ?? null;
const loc = () => screen.getByTestId('loc').textContent ?? '';
const zoom = () => {
  const m = /scale\(([\d.e-]+)\)/.exec(
    document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? '',
  );
  return m ? Number(m[1]) : Number.NaN;
};
const lod = () => canvas()?.dataset.lod;
/** Camera đã đặt lần đầu (toàn cảnh hoặc chỗ trên URL). */
const placed = () => waitFor(() => expect(canvas()?.dataset.camera).toBe('placed'));

describe('RoadmapPage một trang', () => {
  it('mở ra là toàn cảnh: công ty, mọi project và "Chưa gắn project", mọi việc là ô màu trên cùng một bản đồ', async () => {
    server();
    mount('/TPS/roadmap');
    await placed();
    await waitFor(() => expect(node('p1')).toBeTruthy());
    expect(node('company')).toBeTruthy();
    expect(node('p2')).toBeTruthy();
    expect(node('none')).toBeTruthy();
    expect(node('p1')?.getAttribute('aria-label')).toBe('Project Alpha: 1 yêu cầu, 1 đang mở');
    // Mức xa (ô màu/nhãn): mỗi việc (6 issue) và mỗi nút docs (Docs, thư mục, 2 trang) là một ô, gộp theo màu;
    // chưa có thẻ DOM nào của việc.
    expect(Number(lod())).toBeLessThan(2);
    expect(node('c1')).toBeNull();
    const rects = [...(canvas()?.querySelectorAll('path[data-block-tone]') ?? [])].reduce(
      (n, p) => n + (p.getAttribute('d')?.match(/M/g)?.length ?? 0),
      0,
    );
    expect(rects).toBe(ROWS.length + 4);
    expect(screen.getByRole('heading', { name: 'Roadmap' })).toBeTruthy();
    expect(document.querySelector('[data-slot="roadmap-live"]')?.textContent).toBe('Toàn cảnh công ty 2P Solutions');
  });

  it('bấm project hay yêu cầu: camera zoom tới, URL ?focus= đổi, vẫn cùng một bản đồ (không đổi trang/tầng)', async () => {
    server();
    mount('/TPS/roadmap');
    await placed();
    await waitFor(() => expect(node('p1')).toBeTruthy());
    const map = canvas();
    const overview = zoom();
    fireEvent.click(node('p1') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=project%3Ap1'));
    await waitFor(() => expect(zoom()).toBeGreaterThan(overview));
    expect(lod()).toBe('1');
    expect(canvas()).toBe(map);
    // Nhãn nổi của đảo: bấm để zoom tới yêu cầu.
    const plate = await waitFor(() => {
      const el = canvas()?.querySelector<HTMLButtonElement>('button[data-plate="r1"]');
      expect(el).toBeTruthy();
      return el as HTMLButtonElement;
    });
    fireEvent.click(plate);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=TPS-1'));
    await waitFor(() => expect(lod()).toBe('2'));
    await waitFor(() => expect(node('c2')).toBeTruthy());
    expect(canvas()).toBe(map);
    expect(node('r1')?.getAttribute('aria-current')).toBe('true');
    // Đường nối của đảo vẽ bằng cùng bộ dây với bản đồ Crew (cha-con, chặn).
    expect(canvas()?.querySelector('path[data-edge-kind="blocks"]')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Đường dẫn trang' }).textContent).toContain('TPS-1 Trang đăng nhập');
  });

  it('bấm việc con: zoom tới việc (105%), bấm lại mở popup ?issue=; Esc khi có popup không ra ngoài', async () => {
    server();
    mount('/TPS/roadmap?focus=TPS-1');
    await waitFor(() => expect(node('c3')).toBeTruthy());
    fireEvent.click(node('c3') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=TPS-4'));
    await waitFor(() => expect(zoom()).toBeCloseTo(1.05));
    await waitFor(() => expect(node('c3')?.getAttribute('aria-current')).toBe('true'));
    expect(screen.getByRole('button', { name: /Mở chi tiết/ })).toBeTruthy();
    fireEvent.click(node('c3') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toContain('issue=TPS-4'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(loc()).toContain('focus=TPS-4');
  });

  it('Esc / Ra ngoài ra một mức (việc → yêu cầu → project → toàn cảnh); Back trình duyệt lùi vị trí trước', async () => {
    server();
    const router = mount('/TPS/roadmap');
    await waitFor(() => expect(node('p1')).toBeTruthy());
    await router.navigate('/TPS/roadmap?focus=TPS-4');
    await waitFor(() => expect(node('c3')?.getAttribute('aria-current')).toBe('true'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=TPS-1'));
    fireEvent.click(screen.getByRole('button', { name: /Ra ngoài/ }));
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=project%3Ap1'));
    // Back: về yêu cầu, rồi việc con; camera bay theo.
    await router.navigate(-1);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=TPS-1'));
    await router.navigate(-1);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=TPS-4'));
    await waitFor(() => expect(zoom()).toBeCloseTo(1.05));
    // Toàn cảnh: nút và phím 0.
    fireEvent.click(screen.getAllByRole('button', { name: 'Toàn cảnh' })[0]);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap'));
    expect(screen.getByRole('button', { name: /Ra ngoài/ }).hasAttribute('disabled')).toBe(true);
  });

  it('link cũ ?project= và ?request= mở đúng chỗ (đổi sang ?focus=, không thêm mục lịch sử)', async () => {
    server();
    const router = mount('/TPS/roadmap?project=p1&request=TPS-1');
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=TPS-1'));
    await waitFor(() => expect(node('r1')?.getAttribute('aria-current')).toBe('true'));
    expect(router.state.historyAction).toBe('REPLACE');
    cleanup();
    server();
    mount('/TPS/roadmap?project=p2');
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=project%3Ap2'));
    await waitFor(() => expect(lod()).toBe('1'));
    cleanup();
    server();
    mount('/TPS/roadmap?project=p1&docs=1&doc=README.md');
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=docs%3Ap1&doc=README.md'));
    const popup = await screen.findByTestId('roadmap-doc-popup');
    await waitFor(() => expect(popup.textContent).toContain('Nội dung trang giới thiệu.'));
  });

  it('một lần tải crew.roadmap cho mọi chỗ lấy nét; run chỉ tải cho yêu cầu đang xem', async () => {
    const { calls } = server();
    const router = mount('/TPS/roadmap');
    await waitFor(() => expect(node('p1')).toBeTruthy());
    await router.navigate('/TPS/roadmap?focus=TPS-3');
    await waitFor(() => expect(node('c2')?.getAttribute('aria-current')).toBe('true'));
    await router.navigate('/TPS/roadmap?focus=project%3Ap2');
    await waitFor(() => expect(loc()).toContain('p2'));
    expect(calls.filter((c) => c.url.endsWith('/data/crew.roadmap'))).toHaveLength(1);
    const runs = calls.filter((c) => c.url.endsWith('/data/crew.runs'));
    expect(runs.map((c) => (c.body as { params: { issueId: string } }).params.issueId)).toEqual(['r1']);
    expect(calls.filter((c) => c.url.includes('/issues') || c.url.includes('/agents'))).toEqual([]);
  });

  it('dạng danh sách: đủ mọi mục lồng nhau, tô mục đang xem; bấm việc mở popup', async () => {
    server();
    mount('/TPS/roadmap?focus=TPS-3&view=list');
    const list = await screen.findByRole('region', { name: 'Bản đồ dạng danh sách' });
    await waitFor(() => expect(list.querySelector('[data-roadmap-id="c3"]')).toBeTruthy());
    for (const id of ['p1', 'p2', 'none', 'docs:p1', 'r1', 'c1', 'c2', 'c3', 'rB', 'loose']) {
      expect(list.querySelector(`[data-roadmap-id="${id}"]`)).toBeTruthy();
    }
    fireEvent.click(list.querySelector('[data-roadmap-id="c1"]') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toContain('issue=TPS-2'));
    fireEvent.click(screen.getByRole('button', { name: 'Bản đồ' }));
    await waitFor(() => expect(loc()).not.toContain('view=list'));
  });

  it('mục không có hoặc không được xem: toàn cảnh kèm thông báo chung', async () => {
    server();
    mount('/TPS/roadmap?focus=TPS-99');
    expect(await screen.findByText('Không tìm thấy hoặc bạn không được xem')).toBeTruthy();
    await waitFor(() => expect(node('p1')).toBeTruthy());
    expect(Number(lod())).toBeLessThan(2);
    expect(canvas()?.querySelector('[aria-current="true"]')).toBeNull();
  });

  it('thành viên bị giới hạn: chỉ project được cấp; deep link project khác hay "Chưa gắn project" ra thông báo chung', async () => {
    server(projectAccessRoute('c1', ['p1']));
    mount('/TPS/roadmap');
    await placed();
    await waitFor(() => expect(node('p1')).toBeTruthy());
    expect(node('p2')).toBeNull();
    expect(node('none')).toBeNull();
    cleanup();
    server(projectAccessRoute('c1', ['p1']));
    mount('/TPS/roadmap?focus=TPS-5');
    expect(await screen.findByText('Không tìm thấy hoặc bạn không được xem')).toBeTruthy();
    cleanup();
    server(projectAccessRoute('c1', ['p1']));
    mount('/TPS/roadmap?focus=project:none');
    expect(await screen.findByText('Không tìm thấy hoặc bạn không được xem')).toBeTruthy();
  });

  it('chưa được cấp project nào: EmptyState hướng dẫn', async () => {
    server(projectAccessRoute('c1', []));
    mount('/TPS/roadmap');
    expect(await screen.findByText('Bạn chưa được cấp project nào')).toBeTruthy();
  });

  it('đảo Docs: bấm trang mở popup đọc, đóng popup giữ chỗ lấy nét', async () => {
    server();
    mount('/TPS/roadmap?focus=docs:p1');
    await waitFor(() => expect(node('page:p1:README.md')).toBeTruthy());
    fireEvent.click(node('page:p1:README.md') as HTMLButtonElement);
    await waitFor(() => expect(loc()).toBe('/TPS/roadmap?focus=docs%3Ap1&doc=README.md'));
    const popup = await screen.findByTestId('roadmap-doc-popup');
    await waitFor(() => expect(popup.textContent).toContain('Nội dung trang giới thiệu.'));
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(decodeURIComponent(loc())).toBe('/TPS/roadmap?focus=docs:p1'));
  });

  it('không giảm chuyển động: dây đang chạy có lớp chạy; giảm chuyển động: không có lớp chạy, camera tới ngay', async () => {
    reduce = false;
    server();
    mount('/TPS/roadmap?focus=TPS-1');
    await waitFor(() => expect(canvas()?.querySelector('[data-edge-flow]')).toBeTruthy(), { timeout: 3000 });
    cleanup();
    reduce = true;
    server();
    const router = mount('/TPS/roadmap');
    await waitFor(() => expect(node('p1')).toBeTruthy());
    await router.navigate('/TPS/roadmap?focus=TPS-1');
    await waitFor(() => expect(node('c2')).toBeTruthy());
    expect(canvas()?.querySelector('[data-edge-flow]')).toBeNull();
    expect(canvas()?.querySelector('path[data-running]')).toBeTruthy();
  });
});
