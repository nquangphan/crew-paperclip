// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NewRequestDialog } from '@/features/issues/new/new-request-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

// Trạng thái sẵn sàng đã có test riêng ở test/features/readiness; ở đây chỉ cần danh sách kết quả.
vi.mock('@/features/readiness', () => ({
  useProjectReadiness: () => ({
    isLoading: false,
    data: [
      { projectId: 'p1', state: 'ready', failed: [], agents: [] },
      { projectId: 'p2', state: 'not_ready', failed: [{ id: 'P1', detail: 'x' }], agents: [] },
      { projectId: 'p3', state: 'untracked', failed: [], agents: [] },
    ],
  }),
}));

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  // Radix Select dùng các API mà jsdom thiếu.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const PROJECTS = [
  { id: 'p1', name: 'Alpha', archivedAt: null },
  { id: 'p2', name: 'Beta chưa xong', archivedAt: null },
  { id: 'p3', name: 'Gamma file', archivedAt: null },
];
const ROLES = {
  assistantAgentId: 'a-assist',
  executorAgentIds: ['a-exec'],
  reviewerAgentId: 'a-rev',
  integratorAgentId: 'a-int',
};
const AGENTS = [{ id: 'a-assist', name: 'Trợ Lý Alpha' }];
const RESEARCH = { id: 'l-research', name: 'research' };

function routes(over: Record<string, unknown> = {}) {
  return {
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: ROLES } },
    'GET /api/companies/c1/issues': { body: [{ id: 'old', labels: [RESEARCH] }] },
    'POST /api/companies/c1/issues': { status: 201, body: { id: 'i-new', identifier: 'TPS-5' } },
    ...over,
  } as Parameters<typeof mockServer>[0];
}

function mount(onOpenChange = vi.fn(), onCreated = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NewRequestDialog open onOpenChange={onOpenChange} companyId="c1" onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onCreated };
}

/** Mở một Select Radix bằng bàn phím rồi chọn mục theo tên. */
function pick(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}

const projectTrigger = () => screen.getByRole('combobox', { name: 'Project' });
const kindTrigger = () => screen.getByRole('combobox', { name: 'Loại' });

async function fillReady(title = 'Làm tính năng X') {
  await screen.findByRole('combobox', { name: 'Project' });
  pick(projectTrigger(), 'Alpha');
  fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: title } });
}

const posts = (calls: { method: string; url: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith('/issues'));

describe('NewRequestDialog', () => {
  it('chỉ liệt kê project sẵn sàng (S5.1)', async () => {
    mockServer(routes());
    mount();
    await screen.findByRole('combobox', { name: 'Project' });
    fireEvent.keyDown(projectTrigger(), { key: 'Enter' });
    const names = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['Alpha']);
  });

  it('người nhận hiển thị cố định là Trợ Lý của project, không chọn được (S5.4)', async () => {
    mockServer(routes());
    mount();
    await fillReady();
    expect(await screen.findByText('Trợ Lý Alpha')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Người nhận' })).toBeNull();
  });

  it('Nút Tạo gửi đúng body, không có policy hay reviewer (S5.5)', async () => {
    const { calls } = mockServer(routes());
    const { onCreated } = mount();
    await fillReady();
    fireEvent.change(screen.getByLabelText('Mô tả'), { target: { value: 'chi tiết' } });
    await screen.findByText('Trợ Lý Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({
      title: 'Làm tính năng X',
      description: 'chi tiết',
      projectId: 'p1',
      assigneeAgentId: 'a-assist',
      status: 'todo',
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0][0].identifier).toBe('TPS-5');
  });

  it('loại Nghiên cứu gửi labelIds nhãn research (S5.2)', async () => {
    const { calls } = mockServer(routes());
    mount();
    await fillReady();
    await screen.findByText('Trợ Lý Alpha');
    await waitFor(() => {
      fireEvent.keyDown(kindTrigger(), { key: 'Enter' });
      expect(screen.getByRole('option', { name: 'Nghiên cứu' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('option', { name: 'Nghiên cứu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toMatchObject({ labelIds: ['l-research'] });
  });

  it('không có nhãn research thì ẩn loại Nghiên cứu và hiện gợi ý (S5.2)', async () => {
    mockServer(routes({ 'GET /api/companies/c1/issues': { body: [] } }));
    mount();
    await fillReady();
    await screen.findByText(/chưa có nhãn “research”/);
    fireEvent.keyDown(kindTrigger(), { key: 'Enter' });
    expect(screen.queryByRole('option', { name: 'Nghiên cứu' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Code' })).toBeTruthy();
  });

  it('Lưu nháp gửi status backlog (S5.6)', async () => {
    const { calls } = mockServer(routes());
    mount();
    await fillReady();
    await screen.findByText('Trợ Lý Alpha');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu nháp/ }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toMatchObject({ status: 'backlog' });
  });

  it('Hủy đóng dialog và không gọi API ghi (S5.7)', async () => {
    const { calls } = mockServer(routes());
    const { onOpenChange } = mount();
    await fillReady();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(calls.filter((c) => c.method !== 'GET' && !c.url.includes('/data/'))).toEqual([]);
  });

  it('chưa nhập tiêu đề hoặc chưa chọn project thì không tạo được', async () => {
    const { calls } = mockServer(routes());
    mount();
    await screen.findByRole('combobox', { name: 'Project' });
    const create = screen.getByRole('button', { name: 'Tạo' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(posts(calls)).toHaveLength(0);
  });

  it('file .zip hiện cảnh báo, vẫn tạo được và upload sau khi có issue (S5.3)', async () => {
    const { calls } = mockServer(
      routes({ 'POST /api/companies/c1/issues/i-new/attachments': { status: 201, body: { id: 'att' } } }),
    );
    mount();
    await fillReady();
    await screen.findByText('Trợ Lý Alpha');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.zip')] } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('a.zip');
    fireEvent.click(screen.getByRole('button', { name: 'Gửi vẫn tiếp tục' }));
    expect(await screen.findByText('a.zip')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/issues/i-new/attachments'))).toBe(true));
    const order = calls.filter((c) => c.method === 'POST').map((c) => c.url.split('/').slice(-1)[0]);
    expect(order.indexOf('issues')).toBeLessThan(order.indexOf('attachments'));
  });

  it('server từ chối thì hiện lỗi nguyên văn và giữ dialog mở', async () => {
    mockServer(
      routes({ 'POST /api/companies/c1/issues': { status: 422, body: { error: 'Project không giao được' } } }),
    );
    const { onOpenChange } = mount();
    await fillReady();
    await screen.findByText('Trợ Lý Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    expect(await screen.findByText('Project không giao được')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
