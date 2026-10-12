// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { DocsPage } from '@/features/docs/docs-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer, projectAccessRoute } from '../../app/fetch-mock';
import { COMPANY, data, project } from '../agents/helpers';

beforeAll(async () => {
  // jsdom thiếu API mà hộp chọn (Radix Select) cần.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const TREE = {
  repo: 'alpha',
  commit: '1234567890abcdef',
  auditState: 'ok',
  receivedAt: '2026-10-10T01:00:00Z',
  machineId: 'm1',
  dropped: [{ path: 'docs/secret-notes.md' }],
  pages: [
    { path: 'docs/flows/login.md', title: 'Luồng đăng nhập', parentPath: 'docs/index.md' },
    { path: 'docs/index.md', title: 'Chỉ mục', parentPath: null },
  ],
};
const BETA_TREE = {
  ...TREE,
  repo: 'beta',
  dropped: [],
  pages: [{ path: 'guide/start.md', title: 'Bắt đầu Beta', parentPath: null }],
};
const INDEX_PAGE = {
  path: 'docs/index.md',
  title: 'Chỉ mục',
  text: '# Chỉ mục\n\nXem [đăng nhập](./flows/login.md) và [trang ma](./ghost.md).\n\n## Cài đặt\n\nBước đầu.\n\n### Chạy thử\n\nChạy.\n\n## Cài đặt\n\nLặp lại.',
  links: [
    { occurrence: 0, originalHref: './flows/login.md', toPath: 'docs/flows/login.md', status: 'ok' },
    { occurrence: 1, originalHref: './ghost.md', toPath: null, status: 'missing' },
  ],
};
const LOGIN_PAGE = { path: 'docs/flows/login.md', title: 'Luồng đăng nhập', text: 'Nội dung đăng nhập', links: [] };
const BETA_PAGE = { path: 'guide/start.md', title: 'Bắt đầu Beta', text: 'Nội dung Beta', links: [] };

type Body = { params: Record<string, string> };
const paramsOf = (init: RequestInit | undefined) => (JSON.parse(String(init?.body)) as Body).params;

function server(extra: Record<string, object> = {}) {
  return mockServer({
    'GET /api/companies/c-tps/projects': {
      body: [project({ id: 'p1', name: 'Alpha' }), project({ id: 'p2', name: 'Beta', urlKey: 'beta' })],
    },
    ...data('crew.docs.projects', [
      { projectId: 'p1', repo: 'alpha' },
      { projectId: 'p2', repo: 'beta' },
    ]),
    'POST /api/plugins/crew.core/data/crew.docs.tree': (init: RequestInit | undefined) => ({
      body: { data: paramsOf(init).projectId === 'p2' ? BETA_TREE : TREE },
    }),
    'POST /api/plugins/crew.core/data/crew.docs.page': (init: RequestInit | undefined) => {
      const { path } = paramsOf(init);
      const page = { 'docs/flows/login.md': LOGIN_PAGE, 'docs/index.md': INDEX_PAGE, 'guide/start.md': BETA_PAGE }[
        path
      ];
      return { body: { data: page ?? null } };
    },
    ...data('crew.docs.search', [
      { path: 'docs/index.md', title: 'Chỉ mục' },
      { path: 'docs/flows/login.md', title: 'Luồng đăng nhập' },
    ]),
    ...extra,
  });
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function mount(at = '/TPS/docs') {
  const router = createMemoryRouter(
    [
      {
        path: '/:companyPrefix/docs',
        element: (
          <>
            <DocsPage />
            <Where />
          </>
        ),
      },
    ],
    { initialEntries: [at] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <RouterProvider router={router} />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

const where = () => decodeURIComponent(screen.getByTestId('where').textContent ?? '').replaceAll('+', ' ');
const pageCalls = (s: ReturnType<typeof server>) =>
  s.calls.filter((c) => c.url.endsWith('crew.docs.page')).map((c) => (c.body as Body).params.path);
const treeNav = () => screen.getByRole('navigation', { name: 'Các trang tài liệu' });
const article = (title: string) => screen.findByRole('article', { name: title });

describe('DocsPage', () => {
  it('S16.1: chưa chọn trang thì mở trang chủ docs (index.md nông nhất), không bắt chọn', async () => {
    const s = server();
    mount();
    const index = await article('Chỉ mục');
    expect(within(index).getByText(/Xem/)).toBeTruthy();
    expect(within(index).getByText('Commit 1234567, nhận lúc', { exact: false })).toBeTruthy();
    expect(within(index).getByText('docs/index.md')).toBeTruthy();
    expect(pageCalls(s)).toEqual(['docs/index.md']);
    const treeCall = s.calls.find((c) => c.url.endsWith('crew.docs.tree'));
    expect((treeCall?.body as Body | undefined)?.params.projectId).toBe('p1');
    // Trang mở mặc định không ghi vào URL.
    expect(where()).toBe('/TPS/docs');
  });

  it('hộp chọn project hiện tên project; cây có thư mục, trang đang xem được đánh dấu', async () => {
    server();
    mount();
    await article('Chỉ mục');
    expect(screen.getByRole('combobox', { name: 'Project' }).textContent).toContain('Alpha');
    const nav = treeNav();
    expect(within(nav).getByRole('button', { name: 'docs' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(nav).getByRole('button', { name: 'flows' })).toBeTruthy();
    const current = within(nav).getByRole('link', { name: 'Chỉ mục' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.getAttribute('href')).toBe('/TPS/docs?project=p1&path=docs%2Findex.md');
    expect(within(nav).getByRole('link', { name: 'Luồng đăng nhập' }).getAttribute('aria-current')).toBeNull();
  });

  it('bấm trang trong cây: URL có project và path, nút Lùi về trang trước', async () => {
    const s = server();
    const router = mount();
    await article('Chỉ mục');
    fireEvent.click(within(treeNav()).getByRole('link', { name: 'Luồng đăng nhập' }));
    expect(await screen.findByText('Nội dung đăng nhập')).toBeTruthy();
    expect(where()).toBe('/TPS/docs?project=p1&path=docs/flows/login.md');
    await act(() => router.navigate(-1));
    expect(await article('Chỉ mục')).toBeTruthy();
    expect(where()).toBe('/TPS/docs');
    expect(pageCalls(s).slice(0, 2)).toEqual(['docs/index.md', 'docs/flows/login.md']);
  });

  it('mở bằng link có ?project=&path= thì đúng project và đúng trang', async () => {
    const s = server();
    mount('/TPS/docs?project=p2&path=guide/start.md');
    expect(await screen.findByText('Nội dung Beta')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Project' }).textContent).toContain('Beta');
    expect(pageCalls(s)).toEqual(['guide/start.md']);
  });

  it('?project= không được xem thì về project đầu tiên', async () => {
    server(projectAccessRoute(COMPANY.id, ['p2']));
    mount('/TPS/docs?project=p1');
    expect(await screen.findByText('Nội dung Beta')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Project' }), { key: 'Enter' });
    expect(await screen.findByRole('option', { name: 'Beta' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Alpha' })).toBeNull();
  });

  it('đổi project bằng hộp chọn: tải cây project mới, bỏ path cũ, xóa ô tìm', async () => {
    const s = server();
    mount('/TPS/docs?project=p1&path=docs/flows/login.md');
    expect(await screen.findByText('Nội dung đăng nhập')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tìm trong tài liệu'), { target: { value: 'greet' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Project' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Beta' }));
    expect(await screen.findByText('Nội dung Beta')).toBeTruthy();
    expect(where()).toBe('/TPS/docs?project=p2');
    expect((screen.getByLabelText('Tìm trong tài liệu') as HTMLInputElement).value).toBe('');
    const trees = s.calls.filter((c) => c.url.endsWith('crew.docs.tree')).map((c) => (c.body as Body).params.projectId);
    expect(trees).toEqual(['p1', 'p2']);
  });

  it('thu gọn thư mục ẩn trang con; mở trang con bằng link trong bài thì thư mục tự mở lại', async () => {
    server();
    mount();
    await article('Chỉ mục');
    const flows = within(treeNav()).getByRole('button', { name: 'flows' });
    fireEvent.click(flows);
    expect(flows.getAttribute('aria-expanded')).toBe('false');
    expect(within(treeNav()).queryByRole('link', { name: 'Luồng đăng nhập' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'đăng nhập' }));
    expect(await screen.findByText('Nội dung đăng nhập')).toBeTruthy();
    expect(flows.getAttribute('aria-expanded')).toBe('true');
    expect(within(treeNav()).getByRole('link', { name: 'Luồng đăng nhập' }).getAttribute('aria-current')).toBe('page');
  });

  it('mục lục "Trên trang này" lấy từ heading h2/h3 có neo; tiêu đề trùng ở đầu bài bị bỏ', async () => {
    server();
    mount();
    const index = await article('Chỉ mục');
    await waitFor(() => expect(screen.getAllByRole('navigation', { name: 'Trên trang này' }).length).toBe(2));
    const toc = screen.getAllByRole('navigation', { name: 'Trên trang này' })[0] as HTMLElement;
    const links = within(toc).getAllByRole('link');
    expect(links.map((a) => [a.textContent, decodeURIComponent(a.getAttribute('href') ?? '')])).toEqual([
      ['Cài đặt', '#cài-đặt'],
      ['Chạy thử', '#chạy-thử'],
      ['Cài đặt', '#cài-đặt-1'],
    ]);
    expect(index.querySelector('#cài-đặt-1')?.textContent).toBe('Cài đặt');
    // jsdom không có bố cục (mọi heading ở top 0) nên chỉ kiểm có đúng một mục đang đọc.
    await waitFor(() => expect(links.filter((a) => a.getAttribute('aria-current') === 'location')).toHaveLength(1));
    // Tiêu đề chỉ còn một h1 (của bài), markdown không lặp lại "# Chỉ mục".
    expect(
      within(index)
        .getAllByRole('heading', { level: 1 })
        .map((h) => h.textContent),
    ).toEqual(['Chỉ mục']);
  });

  it('mục lục tô mục đang đọc theo vị trí cuộn', async () => {
    const tops: Record<string, number> = { 'cài-đặt': -40, 'chạy-thử': 300, 'cài-đặt-1': 900 };
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      return { ...original.call(this), top: tops[this.id] ?? 0 } as DOMRect;
    };
    try {
      server();
      mount();
      await article('Chỉ mục');
      const rail = () => screen.getAllByRole('navigation', { name: 'Trên trang này' })[1] as HTMLElement;
      const current = () =>
        within(rail())
          .getAllByRole('link')
          .filter((a) => a.getAttribute('aria-current') === 'location')
          .map((a) => a.getAttribute('href'));
      await waitFor(() => expect(current()).toEqual([`#${encodeURIComponent('cài-đặt')}`]));
      tops['chạy-thử'] = 10;
      fireEvent.scroll(document);
      await waitFor(() => expect(current()).toEqual([`#${encodeURIComponent('chạy-thử')}`]));
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it('đổi trang khi đầu bài đã cuộn khuất thì cuộn về đầu bài mới', async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.scrollIntoView = function scroll(this: Element) {
      scrolled.push(this.getAttribute('aria-label') ?? this.tagName);
    };
    Element.prototype.getBoundingClientRect = function r(this: Element) {
      return { ...rect.call(this), top: this.tagName === 'ARTICLE' ? -800 : 0 } as DOMRect;
    };
    try {
      server();
      mount();
      await article('Chỉ mục');
      expect(scrolled).toEqual([]);
      fireEvent.click(screen.getByRole('link', { name: 'đăng nhập' }));
      await article('Luồng đăng nhập');
      await waitFor(() => expect(scrolled).toEqual(['Luồng đăng nhập']));
    } finally {
      Element.prototype.scrollIntoView = original;
      Element.prototype.getBoundingClientRect = rect;
    }
  });

  it('link nội bộ trong trang mở đúng trang; link hỏng báo "thiếu trang" và không điều hướng', async () => {
    const s = server();
    mount();
    const ghost = await screen.findByRole('link', { name: 'trang ma' });
    expect(fireEvent.click(ghost)).toBe(false); // đã preventDefault
    expect(await screen.findByText('Liên kết hỏng: không có trang ./ghost.md')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByText('Liên kết hỏng: không có trang ./ghost.md')).toBeNull();
    const login = screen.getByRole('link', { name: 'đăng nhập' });
    expect(fireEvent.click(login)).toBe(false);
    expect(await screen.findByText('Nội dung đăng nhập')).toBeTruthy();
    expect(pageCalls(s)).toEqual(['docs/index.md', 'docs/flows/login.md']);
  });

  it('danh sách liên kết cuối trang: hợp lệ bấm mở được, hỏng ghi thiếu trang', async () => {
    server();
    mount();
    const list = await screen.findByRole('region', { name: 'Liên kết trong trang' });
    expect(within(list).getByText('Thiếu trang: ./ghost.md')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: './flows/login.md' }));
    expect(await screen.findByText('Nội dung đăng nhập')).toBeTruthy();
  });

  it('liệt kê file bị bỏ do quét bí mật', async () => {
    server();
    mount();
    const dropped = await screen.findByRole('region', { name: 'File bị bỏ do quét bí mật' });
    expect(within(dropped).getByText('docs/secret-notes.md')).toBeTruthy();
  });

  it('S16.2: ô tìm có nhãn và placeholder, số kết quả đúng số API trả, bấm kết quả mở trang', async () => {
    const s = server();
    mount();
    const box = await screen.findByLabelText('Tìm trong tài liệu');
    expect(box.getAttribute('placeholder')).toBe('Nhập từ khóa, ví dụ greet');
    fireEvent.change(box, { target: { value: 'g' } });
    expect(screen.queryByRole('region', { name: 'Kết quả tìm' })).toBeNull();
    fireEvent.change(box, { target: { value: 'greet' } });
    expect(await screen.findByText('2 kết quả')).toBeTruthy();
    const search = s.calls.find((c) => c.url.endsWith('crew.docs.search'));
    expect((search?.body as Body | undefined)?.params).toMatchObject({ projectId: 'p1', q: 'greet' });
    const results = screen.getByRole('region', { name: 'Kết quả tìm' });
    fireEvent.click(within(results).getByRole('link', { name: /Luồng đăng nhập/ }));
    expect(await screen.findByText('Nội dung đăng nhập')).toBeTruthy();
  });

  it('tìm không ra gì thì báo 0 kết quả', async () => {
    server({ 'POST /api/plugins/crew.core/data/crew.docs.search': { body: { data: [] } } });
    mount();
    fireEvent.change(await screen.findByLabelText('Tìm trong tài liệu'), { target: { value: 'zzz' } });
    expect(await screen.findByText('0 kết quả')).toBeTruthy();
  });

  it('chưa có project nào đồng bộ docs thì báo trống', async () => {
    mockServer({ 'GET /api/companies/c-tps/projects': { body: [] }, ...data('crew.docs.projects', []) });
    mount();
    expect(await screen.findByText('Chưa có project nào có docs')).toBeTruthy();
  });

  it('project chưa có bản docs: báo trống nhưng vẫn đổi được project', async () => {
    server({
      'POST /api/plugins/crew.core/data/crew.docs.tree': (init: RequestInit | undefined) => ({
        body: { data: paramsOf(init).projectId === 'p2' ? BETA_TREE : null },
      }),
    });
    mount();
    expect(await screen.findByText('Project này chưa có bản docs')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Project' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Beta' }));
    expect(await screen.findByText('Nội dung Beta')).toBeTruthy();
  });

  it('trang không còn trong bản docs mới nhất báo thiếu trang', async () => {
    server();
    mount('/TPS/docs?project=p1&path=docs/old.md');
    await waitFor(() => expect(screen.getByText('Thiếu trang: docs/old.md')).toBeTruthy());
  });

  it('lỗi tải cây docs hiện lỗi và nút thử lại', async () => {
    server({ 'POST /api/plugins/crew.core/data/crew.docs.tree': { status: 500, body: { error: 'hỏng' } } });
    mount();
    expect(await screen.findByText('Không tải được docs')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  });
});
