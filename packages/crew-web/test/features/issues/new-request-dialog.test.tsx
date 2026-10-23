// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import type { NewRequestInitial } from '@/features/issues/new/follow-plan';
import { NewRequestDialog } from '@/features/issues/new/new-request-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer, projectAccessRoute } from '../../app/fetch-mock';

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
  // jsdom không có object URL; ảnh chưa upload hiện qua URL này.
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
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
const DOCS = { id: 'l-docs', name: 'docs' };
const PLAN = { id: 'l-plan', name: 'plan' };

function routes(over: Record<string, unknown> = {}) {
  return {
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: ROLES } },
    'GET /api/companies/c1/labels': { body: [RESEARCH, DOCS, PLAN] },
    'POST /api/companies/c1/issues': { status: 201, body: { id: 'i-new', identifier: 'TPS-5' } },
    ...over,
  } as Parameters<typeof mockServer>[0];
}

function mount(onOpenChange = vi.fn(), onCreated = vi.fn(), initial?: NewRequestInitial) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <NewRequestDialog open onOpenChange={onOpenChange} companyId="c1" onCreated={onCreated} initial={initial} />
      </CompanyContext.Provider>
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
    mockServer(routes({ 'GET /api/companies/c1/labels': { body: [{ id: 'l-bug', name: 'bug' }] } }));
    mount();
    await fillReady();
    await screen.findByText(/chưa có nhãn “research”/);
    fireEvent.keyDown(kindTrigger(), { key: 'Enter' });
    expect(screen.queryByRole('option', { name: 'Nghiên cứu' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Code' })).toBeTruthy();
  });

  it('loại Viết tài liệu gửi labelIds nhãn docs', async () => {
    const { calls } = mockServer(routes());
    mount();
    await fillReady();
    await screen.findByText('Trợ Lý Alpha');
    await waitFor(() => {
      fireEvent.keyDown(kindTrigger(), { key: 'Enter' });
      expect(screen.getByRole('option', { name: 'Viết tài liệu' })).toBeTruthy();
    });
    const names = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['Code', 'Bug', 'Nghiên cứu', 'Viết tài liệu', 'Lập kế hoạch']);
    fireEvent.click(screen.getByRole('option', { name: 'Viết tài liệu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toMatchObject({ labelIds: ['l-docs'] });
  });

  it('loại Lập kế hoạch gửi labelIds nhãn plan', async () => {
    const { calls } = mockServer(routes());
    mount();
    await fillReady();
    await screen.findByText('Trợ Lý Alpha');
    await waitFor(() => {
      fireEvent.keyDown(kindTrigger(), { key: 'Enter' });
      expect(screen.getByRole('option', { name: 'Lập kế hoạch' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('option', { name: 'Lập kế hoạch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toMatchObject({ labelIds: ['l-plan'] });
  });

  it('không có nhãn plan thì ẩn loại Lập kế hoạch và hiện gợi ý', async () => {
    mockServer(routes({ 'GET /api/companies/c1/labels': { body: [RESEARCH, DOCS] } }));
    mount();
    await fillReady();
    await screen.findByText(/chưa có nhãn “plan”/);
    fireEvent.keyDown(kindTrigger(), { key: 'Enter' });
    expect(screen.queryByRole('option', { name: 'Lập kế hoạch' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Viết tài liệu' })).toBeTruthy();
  });

  it('initial điền sẵn project, loại, tiêu đề, mô tả và gửi đúng body', async () => {
    const { calls } = mockServer(routes());
    mount(vi.fn(), vi.fn(), {
      projectId: 'p1',
      kind: 'code',
      title: 'Làm theo kế hoạch: Đăng nhập',
      description: 'crew-from-plan plans/x/plan.md\nKế hoạch: TPS-7',
    });
    expect(((await screen.findByLabelText('Tiêu đề')) as HTMLInputElement).value).toBe('Làm theo kế hoạch: Đăng nhập');
    expect((screen.getByLabelText('Mô tả') as HTMLTextAreaElement).value).toBe(
      'crew-from-plan plans/x/plan.md\nKế hoạch: TPS-7',
    );
    expect(await screen.findByText('Trợ Lý Alpha')).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Tạo' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toMatchObject({
      title: 'Làm theo kế hoạch: Đăng nhập',
      description: 'crew-from-plan plans/x/plan.md\nKế hoạch: TPS-7',
      projectId: 'p1',
      assigneeAgentId: 'a-assist',
    });
    expect(posts(calls)[0].body).not.toHaveProperty('labelIds');
  });

  it('initial trỏ project chưa sẵn sàng hoặc không thấy được thì nút Tạo tắt', async () => {
    const { calls } = mockServer(routes());
    mount(vi.fn(), vi.fn(), { projectId: 'p2', kind: 'code', title: 'Làm theo kế hoạch: X', description: 'mô tả' });
    await screen.findByRole('combobox', { name: 'Project' });
    const create = screen.getByRole('button', { name: 'Tạo' }) as HTMLButtonElement;
    await new Promise((r) => setTimeout(r, 50));
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(posts(calls)).toHaveLength(0);
  });

  it('project sẵn sàng nhưng owner không thấy thì không gửi được', async () => {
    mockServer(routes(projectAccessRoute('c1', ['p9'])));
    mount(vi.fn(), vi.fn(), { projectId: 'p1', kind: 'code', title: 'Làm theo kế hoạch: X', description: 'mô tả' });
    await screen.findByText(/Chưa có project nào sẵn sàng/);
    await new Promise((r) => setTimeout(r, 50));
    expect((screen.getByRole('button', { name: 'Tạo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('đóng rồi mở lại thì form dựng lại từ initial', async () => {
    mockServer(routes());
    const initial = { projectId: 'p1', kind: 'code' as const, title: 'Tiêu đề điền sẵn', description: 'mô tả' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (open: boolean) => (
      <QueryClientProvider client={client}>
        <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
          <NewRequestDialog open={open} onOpenChange={vi.fn()} companyId="c1" initial={initial} />
        </CompanyContext.Provider>
      </QueryClientProvider>
    );
    const view = render(ui(true));
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'Đã sửa tay' } });
    expect((screen.getByLabelText('Tiêu đề') as HTMLInputElement).value).toBe('Đã sửa tay');
    view.rerender(ui(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    view.rerender(ui(true));
    expect(((await screen.findByLabelText('Tiêu đề')) as HTMLInputElement).value).toBe('Tiêu đề điền sẵn');
  });

  it('không có nhãn docs thì ẩn loại Viết tài liệu và hiện gợi ý, Nghiên cứu vẫn chọn được', async () => {
    mockServer(routes({ 'GET /api/companies/c1/labels': { body: [RESEARCH] } }));
    mount();
    await fillReady();
    await screen.findByText(/chưa có nhãn “docs”/);
    expect(screen.queryByText(/chưa có nhãn “research”/)).toBeNull();
    fireEvent.keyDown(kindTrigger(), { key: 'Enter' });
    expect(screen.queryByRole('option', { name: 'Viết tài liệu' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Nghiên cứu' })).toBeTruthy();
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

  it('bấm Đính kèm file và chọn file không gửi yêu cầu', async () => {
    const { calls } = mockServer(routes());
    mount();
    await fillReady();
    await screen.findByText('Trợ Lý Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Đính kèm file' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'mockup.png', { type: 'image/png' })] } });
    expect((await screen.findByRole('img', { name: 'mockup.png' })).getAttribute('src')).toBe('blob:preview');
    expect(screen.queryByText('mockup.png')).toBeNull();
    expect(posts(calls)).toHaveLength(0);
  });

  it('dán ảnh từ clipboard vào mô tả: ảnh vào đính kèm, mô tả có dòng nhắc tên ảnh, không gửi yêu cầu', async () => {
    const { calls } = mockServer(
      routes({ 'POST /api/companies/c1/issues/i-new/attachments': { status: 201, body: { id: 'att' } } }),
    );
    mount();
    await fillReady();
    await screen.findByText('Trợ Lý Alpha');
    const description = screen.getByLabelText('Mô tả') as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: 'Sửa nút này' } });
    description.setSelectionRange(11, 11);
    const image = new File(['png'], 'image.png', { type: 'image/png' });
    fireEvent.paste(description, { clipboardData: { files: [image], getData: () => '' } });
    const item = await screen.findByRole('img', { name: /^anh-dan-\d+-1\.png$/ });
    expect(description.value).toBe(`Sửa nút này[Ảnh đính kèm: ${item.getAttribute('alt')}]`);
    expect(posts(calls)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/issues/i-new/attachments'))).toBe(true));
  });

  it('dán chữ thường vào mô tả không thêm đính kèm', async () => {
    mockServer(routes());
    mount();
    await fillReady();
    const description = screen.getByLabelText('Mô tả');
    fireEvent.paste(description, { clipboardData: { files: [], getData: () => 'chữ' } });
    expect(screen.queryByRole('img', { name: /^anh-dan-/ })).toBeNull();
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

  it('viewer thuần: không có dialog nào (kể cả mở thẳng ?new=1), không gọi route chỉ người ghi đọc', async () => {
    const { calls } = mockServer({
      ...routes(),
      ...accessRoute('c1', { userId: 'u3', membershipRole: 'viewer', contributor: false, canApprove: false }),
    });
    mount();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/crew/companies/c1/access')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((c) => c.url.includes('/roles') || c.url.endsWith('/labels'))).toBe(false);
  });
});

const MACHINES = {
  items: [
    {
      machineId: 'm-mini',
      hostname: 'Phans-Mac-mini',
      online: true,
      status: null,
      running: 0,
      load1: 1.2,
      cpuCount: 10,
      memFreePct: 54,
    },
    {
      machineId: 'm-book',
      hostname: 'Phans-MacBook-Pro',
      online: true,
      status: 'ready',
      running: 2,
      load1: 3.9,
      cpuCount: 12,
      memFreePct: 60,
    },
    {
      machineId: 'm-prov',
      hostname: 'Mac-dang-dung',
      online: true,
      status: 'provisioning',
      running: 0,
      load1: 0.5,
      cpuCount: 8,
      memFreePct: 50,
    },
    {
      machineId: 'm-bad',
      hostname: 'Mac-hong',
      online: true,
      status: 'failed',
      running: 1,
      load1: 0.7,
      cpuCount: 8,
      memFreePct: 50,
    },
    {
      machineId: 'm-off',
      hostname: 'Mac-cu',
      online: false,
      status: 'ready',
      running: 0,
      load1: null,
      cpuCount: null,
      memFreePct: null,
    },
  ],
};
const MINI_LABEL = 'Phans-Mac-mini · 0 run · load 1,2 · sẽ dựng lần đầu';
const PIN_VIEW = {
  rootIssueId: 'i-new',
  isRoot: true,
  locked: false,
  pin: {
    machineId: 'm-mini',
    hostname: 'Phans-Mac-mini',
    source: 'owner',
    reason: {},
    pinnedAt: '2026-10-24T01:00:00.000Z',
  },
};
const machineTrigger = () => screen.findByRole('combobox', { name: 'Máy thực thi' });

/** Máy tải bất đồng bộ nên mở danh sách lại tới khi mục cần chọn xuất hiện. */
async function pickMachine(option: string) {
  const trigger = await machineTrigger();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await waitFor(() => expect(within(screen.getByRole('listbox')).getByRole('option', { name: option })).toBeTruthy());
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}

describe('Máy thực thi', () => {
  it('owner thấy ô mặc định Tự chọn; chỉ máy online; ghi chú theo trạng thái dựng', async () => {
    mockServer(routes({ 'GET /api/crew/companies/c1/machines': { body: MACHINES } }));
    mount();
    await fillReady();
    const trigger = await machineTrigger();
    expect(trigger.textContent).toContain('Tự chọn');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() =>
      expect(within(screen.getByRole('listbox')).getByRole('option', { name: MINI_LABEL })).toBeTruthy(),
    );
    const list = within(screen.getByRole('listbox'));
    expect(list.getByRole('option', { name: MINI_LABEL })).toBeTruthy();
    expect(list.getByRole('option', { name: 'Phans-MacBook-Pro · 2 run · load 3,9' })).toBeTruthy();
    expect(list.getByRole('option', { name: 'Mac-dang-dung · 0 run · load 0,5 · đang dựng' })).toBeTruthy();
    expect(list.getByRole('option', { name: 'Mac-hong · 1 run · load 0,7 · dựng hỏng' })).toBeTruthy();
    expect(list.queryByRole('option', { name: /Mac-cu/ })).toBeNull();
  });

  it('chọn máy: tạo nháp, ghim máy, chuyển Cần làm', async () => {
    const { calls } = mockServer(
      routes({
        'GET /api/crew/companies/c1/machines': { body: MACHINES },
        'PUT /api/crew/companies/c1/issues/i-new/machine': { body: PIN_VIEW },
        'PATCH /api/issues/i-new': { body: { id: 'i-new', identifier: 'TPS-5', status: 'todo' } },
      }),
    );
    const { onCreated } = mount();
    await fillReady();
    await pickMachine(MINI_LABEL);
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.split('?')[0]}`);
    expect(writes).toEqual([
      'POST /api/companies/c1/issues',
      'PUT /api/crew/companies/c1/issues/i-new/machine',
      'PATCH /api/issues/i-new',
    ]);
    expect(posts(calls)[0]?.body).toMatchObject({ status: 'backlog' });
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ machineId: 'm-mini' });
    expect(onCreated.mock.calls[0]?.[1]).toEqual({ draft: false, failedUploads: [], machineError: null });
  });

  it('Tự chọn: tạo thẳng Cần làm, không gọi ghim máy', async () => {
    const { calls } = mockServer(routes({ 'GET /api/crew/companies/c1/machines': { body: MACHINES } }));
    const { onCreated } = mount();
    await fillReady();
    await machineTrigger();
    await screen.findByText('Trợ Lý Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(posts(calls)[0]?.body).toMatchObject({ status: 'todo' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('ghim lỗi: báo là nháp kèm lỗi', async () => {
    mockServer(
      routes({
        'GET /api/crew/companies/c1/machines': { body: MACHINES },
        'PUT /api/crew/companies/c1/issues/i-new/machine': {
          status: 409,
          body: { error: 'Cây yêu cầu đã có run nên không đổi máy được nữa.' },
        },
      }),
    );
    const { onCreated } = mount();
    await fillReady();
    await pickMachine(MINI_LABEL);
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0]?.[1]).toMatchObject({
      draft: true,
      machineError: expect.stringContaining('không đổi máy'),
    });
  });

  it('không phải owner: không có ô Máy thực thi', async () => {
    mockServer(
      routes({
        ...accessRoute('c1', { userId: 'u4', membershipRole: 'operator', contributor: false, canApprove: false }),
        'GET /api/crew/companies/c1/machines': { body: MACHINES },
      }),
    );
    mount();
    await fillReady();
    expect(screen.queryByRole('combobox', { name: 'Máy thực thi' })).toBeNull();
  });
});
