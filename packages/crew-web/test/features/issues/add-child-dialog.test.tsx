// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AddChildAction } from '@/features/issues/new/add-child-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { ISSUE, mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
});
afterEach(cleanup);

/** Yêu cầu gốc Crew đang ở bước Trợ Lý. */
const ROOT = {
  ...ISSUE,
  id: 'i-root',
  identifier: 'TPS-1',
  title: 'Trang báo cáo',
  parentId: null,
  ancestors: [],
  status: 'in_progress',
  assigneeAgentId: 'a-assist',
  executionState: null,
};
const CHILD = { ...ISSUE, id: 'i-child', identifier: 'TPS-9', title: 'Thêm nút xuất Excel', parentId: 'i-root' };
const DATA = '/api/plugins/crew.core/data';
const map = (rootId: string, diagnostics: string[] = []) => ({
  body: { data: { root: { id: rootId }, nodes: [], edges: [], diagnostics } },
});

function routes(over: Record<string, unknown> = {}) {
  return {
    [`POST ${DATA}/crew.map`]: map('i-root'),
    'GET /api/issues/i-root': { body: ROOT },
    'POST /api/companies/c1/issues': { status: 201, body: CHILD },
    'POST /api/issues/i-root/comments': { status: 201, body: { id: 'cm1' } },
    ...over,
  } as Parameters<typeof mockServer>[0];
}

const button = () => screen.findByRole('button', { name: 'Thêm việc con' });

async function openDialog() {
  fireEvent.click(await button());
  return screen.findByRole('dialog');
}

describe('AddChildAction', () => {
  it('owner trên gốc Crew đang chạy: tạo con chưa giao ai, upload vào con, bình luận báo Trợ Lý trên gốc', async () => {
    const s = mockServer({
      ...routes(),
      'POST /api/companies/c1/issues/i-child/attachments': { status: 201, body: { id: 'at1' } },
    });
    mount(<AddChildAction issue={ROOT as never} />);
    const dialog = await openDialog();
    expect(within(dialog).getByText('Thêm việc con vào TPS-1')).toBeTruthy();
    // Không có ô chọn người làm, project hay loại: Trợ Lý giao, loại theo gốc.
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).getByText('Theo yêu cầu gốc: Code')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Tiêu đề'), { target: { value: 'Thêm nút xuất Excel' } });
    fireEvent.change(within(dialog).getByLabelText('Mô tả'), { target: { value: '**Cột** Ngày, Tổng' } });
    const file = new File(['x'], 'mau.png', { type: 'image/png' });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm việc con' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const writes = s.calls.filter((c) => c.method === 'POST' && !c.url.startsWith(DATA));
    expect(writes.map((c) => c.url)).toEqual([
      '/api/companies/c1/issues',
      '/api/companies/c1/issues/i-child/attachments',
      '/api/issues/i-root/comments',
    ]);
    const body = writes[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: 'Thêm nút xuất Excel',
      description: '**Cột** Ngày, Tổng',
      parentId: 'i-root',
      projectId: 'p1',
      status: 'todo',
      allowDuplicate: true,
    });
    expect(String(body.idempotencyKey)).toMatch(/^crew-add-child:i-root:/);
    for (const key of [
      'assigneeAgentId',
      'assigneeUserId',
      'executionPolicy',
      'labelIds',
      'assigneeAdapterOverrides',
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(writes[2]?.body).toMatchObject({
      body: 'Đã thêm việc con TPS-9: Thêm nút xuất Excel\nTrợ Lý: nhận việc này vào kế hoạch rồi giao cho executor.',
    });
    expect((await screen.findByTestId('add-child-notice')).textContent).toContain('Trợ Lý được báo');
    expect(screen.getByText('Đã thêm TPS-9')).toBeTruthy();
  });

  it('bình luận lỗi: báo đã tạo, bấm Báo lại Trợ Lý chỉ gửi lại bình luận', async () => {
    let fail = true;
    const s = mockServer(
      routes({
        'POST /api/issues/i-root/comments': () =>
          fail ? { status: 500, body: { error: 'mất kết nối' } } : { status: 201, body: { id: 'cm1' } },
      }),
    );
    mount(<AddChildAction issue={ROOT as never} />);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Tiêu đề'), { target: { value: 'Thêm nút xuất Excel' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm việc con' }));
    expect(await within(dialog).findByText('Đã tạo TPS-9 nhưng chưa báo được Trợ Lý')).toBeTruthy();
    fail = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Báo lại Trợ Lý' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(s.calls.filter((c) => c.method === 'POST' && c.url === '/api/companies/c1/issues')).toHaveLength(1);
    const comments = s.calls.filter((c) => c.url === '/api/issues/i-root/comments');
    expect(comments).toHaveLength(2);
    expect(comments[1]?.body).toEqual(comments[0]?.body);
  });

  it('gốc đã sang review lúc gửi: không tạo gì, báo trạng thái mới', async () => {
    const s = mockServer(routes({ 'GET /api/issues/i-root': { body: { ...ROOT, status: 'in_review' } } }));
    mount(<AddChildAction issue={ROOT as never} />);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Tiêu đề'), { target: { value: 'Việc thêm' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm việc con' }));
    expect(await within(dialog).findByText(/đã qua bước Trợ Lý \(đang ở Đang duyệt\)/)).toBeTruthy();
    expect(s.calls.filter((c) => c.method === 'POST' && c.url === '/api/companies/c1/issues')).toHaveLength(0);
  });

  it('yêu cầu đang review: dialog giải thích, chỉ ra đường Yêu cầu sửa, không có form', async () => {
    mockServer(routes());
    mount(<AddChildAction issue={{ ...ROOT, status: 'in_review' } as never} />);
    const dialog = await openDialog();
    expect(within(dialog).getByText('Yêu cầu đã qua bước Trợ Lý')).toBeTruthy();
    expect(within(dialog).getByText(/bấm Yêu cầu sửa/)).toBeTruthy();
    expect(within(dialog).queryByLabelText('Tiêu đề')).toBeNull();
  });

  it('nháp: dialog giải thích Bắt đầu làm trước', async () => {
    mockServer(routes());
    mount(<AddChildAction issue={{ ...ROOT, status: 'backlog' } as never} />);
    const dialog = await openDialog();
    expect(within(dialog).getByText('Yêu cầu còn là nháp')).toBeTruthy();
  });

  it('ẩn: yêu cầu đã xong, việc con, không phải gốc Crew, người chỉ đọc', async () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ ...ROOT, status: 'done' }, routes()],
      [{ ...ROOT, status: 'cancelled' }, routes()],
      [CHILD, routes({ [`POST ${DATA}/crew.map`]: map('i-root') })],
      [ROOT, routes({ [`POST ${DATA}/crew.map`]: map('i-root', ['not_crew_root']) })],
      [ROOT, { ...routes(), ...accessRoute('c1', { userId: 'u1', membershipRole: 'viewer', contributor: false }) }],
    ];
    for (const [issue, r] of cases) {
      const s = mockServer(r as Parameters<typeof mockServer>[0]);
      mount(<AddChildAction issue={issue as never} />);
      await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/crew.map'))).toBe(true));
      // Chờ access và map trả về rồi mới kết luận không có nút.
      await new Promise((r2) => setTimeout(r2, 20));
      expect(screen.queryByRole('button', { name: 'Thêm việc con' })).toBeNull();
      cleanup();
    }
  });
});
