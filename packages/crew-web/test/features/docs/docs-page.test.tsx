// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DocsPage } from '@/features/docs/docs-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, project, renderPage } from '../agents/helpers';

beforeAll(async () => {
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
    { path: 'docs/index.md', title: 'Chỉ mục', parentPath: null },
    { path: 'docs/flows/login.md', title: 'Luồng đăng nhập', parentPath: 'docs/index.md' },
  ],
};
const INDEX_PAGE = {
  path: 'docs/index.md',
  title: 'Chỉ mục',
  text: 'Xem [đăng nhập](./flows/login.md) và [trang ma](./ghost.md).',
  links: [
    { occurrence: 0, originalHref: './flows/login.md', toPath: 'docs/flows/login.md', status: 'ok' },
    { occurrence: 1, originalHref: './ghost.md', toPath: null, status: 'missing' },
  ],
};
const LOGIN_PAGE = { path: 'docs/flows/login.md', title: 'Luồng đăng nhập', text: 'Nội dung đăng nhập', links: [] };

function server(extra: Record<string, object> = {}) {
  return mockServer({
    'GET /api/companies/c-tps/projects': { body: [project({ id: 'p1', name: 'Alpha' })] },
    ...data('crew.docs.projects', [{ projectId: 'p1', repo: 'alpha' }]),
    ...data('crew.docs.tree', TREE),
    'POST /api/plugins/crew.core/data/crew.docs.page': (init: RequestInit | undefined) => {
      const params = (JSON.parse(String(init?.body)) as { params: { path: string } }).params;
      return { body: { data: params.path === 'docs/flows/login.md' ? LOGIN_PAGE : INDEX_PAGE } };
    },
    ...data('crew.docs.search', [
      { path: 'docs/index.md', title: 'Chỉ mục' },
      { path: 'docs/flows/login.md', title: 'Luồng đăng nhập' },
    ]),
    ...extra,
  });
}
const paramsOf = (call: { body: unknown } | undefined): Record<string, string> =>
  ((call?.body ?? {}) as { params?: Record<string, string> }).params ?? {};
const mount = () => renderPage(<DocsPage />, { route: 'docs', at: '/TPS/docs' });
const pageCalls = (s: ReturnType<typeof server>) =>
  s.calls
    .filter((c) => c.url.endsWith('crew.docs.page'))
    .map((c) => (c.body as { params: { path: string } }).params.path);

describe('DocsPage', () => {
  it('S16.1: chọn project đầu tiên, hiện cây tài liệu và mở một trang', async () => {
    const s = server();
    mount();
    expect(await screen.findByRole('button', { name: 'Alpha' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Chỉ mục/ }));
    expect(await screen.findByText(/Xem/)).toBeTruthy();
    expect(pageCalls(s)).toEqual(['docs/index.md']);
    const treeCall = s.calls.find((c) => c.url.endsWith('crew.docs.tree'));
    expect(paramsOf(treeCall).projectId).toBe('p1');
  });

  it('link nội bộ trong trang mở đúng trang; link hỏng báo "thiếu trang" và không điều hướng', async () => {
    const s = server();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Chỉ mục/ }));
    const ghost = await screen.findByRole('link', { name: 'trang ma' });
    expect(fireEvent.click(ghost)).toBe(false); // đã preventDefault
    expect(await screen.findByText('Liên kết hỏng: không có trang ./ghost.md')).toBeTruthy();
    const login = screen.getByRole('link', { name: 'đăng nhập' });
    expect(fireEvent.click(login)).toBe(false);
    expect(await screen.findByText('Nội dung đăng nhập')).toBeTruthy();
    expect(pageCalls(s)).toEqual(['docs/index.md', 'docs/flows/login.md']);
  });

  it('danh sách liên kết dưới trang: hợp lệ bấm mở được, hỏng ghi thiếu trang', async () => {
    server();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Chỉ mục/ }));
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

  it('S16.2: ô tìm có nhãn và placeholder, số kết quả đúng số API trả', async () => {
    const s = server();
    mount();
    const box = await screen.findByLabelText('Tìm trong tài liệu');
    expect(box.getAttribute('placeholder')).toBe('Nhập từ khóa, ví dụ greet');
    fireEvent.change(box, { target: { value: 'greet' } });
    expect(await screen.findByText('2 kết quả')).toBeTruthy();
    const search = s.calls.find((c) => c.url.endsWith('crew.docs.search'));
    expect(paramsOf(search)).toMatchObject({ projectId: 'p1', q: 'greet' });
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

  it('trang không còn trong bản docs mới nhất báo thiếu trang', async () => {
    server({ 'POST /api/plugins/crew.core/data/crew.docs.page': { body: { data: null } } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Chỉ mục/ }));
    await waitFor(() => expect(screen.getByText('Thiếu trang: docs/index.md')).toBeTruthy());
  });
});
