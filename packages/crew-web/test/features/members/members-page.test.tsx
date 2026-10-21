// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { MembersPage } from '@/features/members/members-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MembersPage />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );

/** Mở chỗ chọn project của nút mời rồi bấm Tạo link (không chọn project nào). */
const createLink = async (button = 'Mời Phòng Marketing') => {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  fireEvent.click(
    within(await screen.findByTestId('invite-projects-editor')).getByRole('button', { name: 'Tạo link' }),
  );
};

const user = (id: string, name: string) => ({ id, name, email: `${id}@example.com` });
const member = (principalId: string, membershipRole: string, name: string) => ({
  id: `m-${principalId}`,
  principalId,
  membershipRole,
  status: 'active',
  user: user(principalId, name),
});
const invite = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  state: 'active',
  humanRole: 'viewer',
  allowedJoinTypes: 'human',
  expiresAt: '2026-10-18T00:00:00.000Z',
  createdAt: '2026-10-11T00:00:00.000Z',
  defaultsPayload: null,
  ...over,
});
const joinRequest = (id: string, inviteId: string, userId: string, name: string) => ({
  id,
  inviteId,
  requestType: 'human',
  status: 'pending_approval',
  requestingUserId: userId,
  createdAt: '2026-10-11T01:00:00.000Z',
  requesterUser: user(userId, name),
});

// Lời mời cũ không có `department`: là Phòng Marketing.
const CONTRIB_INVITE = invite('inv-c', { defaultsPayload: { crew: { role: 'contributor' } } });
const QC_INVITE = invite('inv-q', { defaultsPayload: { crew: { role: 'contributor', department: 'qc' } } });
const putBody = (calls: { method: string; url: string; body?: unknown }[], userId: string) =>
  calls.find((c) => c.method === 'PUT' && c.url.endsWith(`/contributors/${userId}`))?.body;
const base = (over: Record<string, unknown> = {}) => ({
  'GET /api/companies/c1/members': {
    body: {
      members: [
        member('u1', 'owner', 'Chủ'),
        member('u2', 'viewer', 'Lan'),
        member('u3', 'viewer', 'Minh'),
        member('u6', 'viewer', 'Quân'),
      ],
    },
  },
  'GET /api/crew/companies/c1/contributors': {
    body: {
      items: [
        { userId: 'u2', department: 'marketing', grantedAt: '2026-10-11T00:00:00.000Z', grantedByUserId: 'u1' },
        { userId: 'u6', department: 'qc', grantedAt: '2026-10-11T00:00:00.000Z', grantedByUserId: 'u1' },
      ],
    },
  },
  'GET /api/companies/c1/invites': { body: { invites: [CONTRIB_INVITE, invite('inv-n')] } },
  'GET /api/companies/c1/join-requests': { body: [] },
  'GET /api/crew/companies/c1/project-access': {
    body: {
      items: [
        { userId: 'u1', all: true, projectIds: [] },
        { userId: 'u2', all: false, projectIds: ['p1'] },
        { userId: 'u3', all: false, projectIds: [] },
        { userId: 'u6', all: false, projectIds: [] },
      ],
    },
  },
  'GET /api/companies/c1/projects': {
    body: [
      { id: 'p1', name: 'Website', archivedAt: null },
      { id: 'p2', name: 'Ứng dụng', archivedAt: null },
      { id: 'p3', name: 'Cũ', archivedAt: '2026-10-01T00:00:00.000Z' },
    ],
  },
  ...over,
});

describe('trang Thành viên', () => {
  it('hiện role theo phòng, mỗi phòng có nút Gỡ riêng, viewer thuần có nút Đặt cho cả hai phòng', async () => {
    mockServer(base());
    mount();
    const rows = await screen.findAllByTestId('member-row');
    expect(rows.map((r) => r.getAttribute('data-role'))).toEqual(['owner', 'marketing', 'viewer', 'qc']);
    expect(within(rows[1]).getByText('Phòng Marketing')).toBeTruthy();
    expect(within(rows[1]).getByRole('button', { name: 'Gỡ Phòng Marketing' })).toBeTruthy();
    expect(within(rows[1]).queryByRole('button', { name: /Đặt Phòng/ })).toBeNull();
    expect(within(rows[2]).getByRole('button', { name: 'Đặt Phòng Marketing' })).toBeTruthy();
    expect(within(rows[2]).getByRole('button', { name: 'Đặt Phòng QC' })).toBeTruthy();
    expect(within(rows[3]).getByText('Phòng QC')).toBeTruthy();
    expect(within(rows[3]).getByRole('button', { name: 'Gỡ Phòng QC' })).toBeTruthy();
    expect(within(rows[3]).queryByRole('button', { name: 'Gỡ Phòng Marketing' })).toBeNull();
    expect(within(rows[0]).queryByRole('button')).toBeNull();
  });

  it('Đặt Phòng Marketing gọi PUT contributors/:userId với department marketing', async () => {
    const { calls } = mockServer(base({ 'PUT /api/crew/companies/c1/contributors/u3': { status: 204 } }));
    mount();
    const row = (await screen.findAllByTestId('member-row'))[2];
    fireEvent.click(within(row).getByRole('button', { name: 'Đặt Phòng Marketing' }));
    await waitFor(() => expect(putBody(calls, 'u3')).toEqual({ department: 'marketing' }));
  });

  it('Đặt Phòng QC gọi PUT contributors/:userId với department qc', async () => {
    const { calls } = mockServer(base({ 'PUT /api/crew/companies/c1/contributors/u3': { status: 204 } }));
    mount();
    const row = (await screen.findAllByTestId('member-row'))[2];
    fireEvent.click(within(row).getByRole('button', { name: 'Đặt Phòng QC' }));
    await waitFor(() => expect(putBody(calls, 'u3')).toEqual({ department: 'qc' }));
  });

  it('Gỡ Phòng QC gọi DELETE contributors/:userId', async () => {
    const { calls } = mockServer(base({ 'DELETE /api/crew/companies/c1/contributors/u6': { status: 204 } }));
    mount();
    const row = (await screen.findAllByTestId('member-row'))[3];
    fireEvent.click(within(row).getByRole('button', { name: 'Gỡ Phòng QC' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/contributors/u6'))).toBe(true),
    );
  });

  it('Gỡ Phòng Marketing gọi DELETE contributors/:userId', async () => {
    const { calls } = mockServer(base({ 'DELETE /api/crew/companies/c1/contributors/u2': { status: 204 } }));
    mount();
    const row = (await screen.findAllByTestId('member-row'))[1];
    fireEvent.click(within(row).getByRole('button', { name: 'Gỡ Phòng Marketing' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/contributors/u2'))).toBe(true),
    );
  });

  it('mời khách: gửi đúng body, hiện link /paperclip/invite/<token>', async () => {
    const { calls } = mockServer(
      base({
        'POST /api/companies/c1/invites': { status: 201, body: { ...CONTRIB_INVITE, id: 'inv-new', token: 'tok-123' } },
      }),
    );
    mount();
    await createLink();
    const input = (await screen.findByLabelText('Link mời')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/paperclip/invite/tok-123`);
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/invites'));
    expect(post?.body).toEqual({
      allowedJoinTypes: 'human',
      humanRole: 'viewer',
      defaultsPayload: { crew: { role: 'contributor', department: 'marketing' } },
    });
  });

  it('Mời Phòng QC: body mang department qc, hộp chọn project ghi đúng phòng', async () => {
    const { calls } = mockServer(
      base({
        'POST /api/companies/c1/invites': { status: 201, body: { ...QC_INVITE, id: 'inv-new', token: 'tok-qc' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Mời Phòng QC' }));
    const editor = await screen.findByTestId('invite-projects-editor');
    expect(editor.getAttribute('data-department')).toBe('qc');
    expect(within(editor).getByText('Project người được mời vào Phòng QC sẽ xem')).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Tạo link' }));
    expect(await screen.findByDisplayValue(`${window.location.origin}/paperclip/invite/tok-qc`)).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/invites'));
    expect(post?.body).toEqual({
      allowedJoinTypes: 'human',
      humanRole: 'viewer',
      defaultsPayload: { crew: { role: 'contributor', department: 'qc' } },
    });
  });

  it('chọn project lúc tạo link: body mang projectIds, project đã gỡ không có trong danh sách', async () => {
    const { calls } = mockServer(
      base({
        'POST /api/companies/c1/invites': { status: 201, body: { ...CONTRIB_INVITE, id: 'inv-new', token: 'tok-7' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Mời Phòng Marketing' }));
    const editor = await screen.findByTestId('invite-projects-editor');
    await waitFor(() => expect(within(editor).getByRole('checkbox', { name: 'Website' })).toBeTruthy());
    expect(within(editor).queryByText('Cũ')).toBeNull();
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Ứng dụng' }));
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Website' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Tạo link' }));
    expect(await screen.findByDisplayValue(`${window.location.origin}/paperclip/invite/tok-7`)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('invite-projects-editor')).toBeNull());
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/invites'));
    expect(post?.body).toEqual({
      allowedJoinTypes: 'human',
      humanRole: 'viewer',
      defaultsPayload: { crew: { role: 'contributor', department: 'marketing', projectIds: ['p2', 'p1'] } },
    });
  });

  it('bảng lời mời hiện project đã chọn theo cùng luật với cột Project được xem', async () => {
    const withProjects = (id: string, projectIds: string[]) =>
      invite(id, { defaultsPayload: { crew: { role: 'contributor', projectIds } } });
    mockServer(
      base({
        'GET /api/companies/c1/invites': {
          body: { invites: [withProjects('i1', ['p1', 'p2']), withProjects('i2', ['p1', 'p2', 'p3']), CONTRIB_INVITE] },
        },
        'GET /api/companies/c1/projects': {
          body: [
            { id: 'p1', name: 'Website', archivedAt: null },
            { id: 'p2', name: 'Ứng dụng', archivedAt: null },
            { id: 'p3', name: 'Sự kiện', archivedAt: null },
          ],
        },
      }),
    );
    mount();
    const rows = await screen.findAllByTestId('invite-row');
    const cell = (row: HTMLElement) => within(row).getByTestId('invite-projects').textContent;
    await waitFor(() => expect(cell(rows[0])).toBe('Website, Ứng dụng'));
    expect(cell(rows[1])).toBe('3 project');
    expect(cell(rows[2])).toBe('Chưa có project');
  });

  it('chép link vào clipboard', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mockServer(
      base({ 'POST /api/companies/c1/invites': { status: 201, body: { ...CONTRIB_INVITE, token: 'tok-9' } } }),
    );
    mount();
    await createLink();
    fireEvent.click(await screen.findByRole('button', { name: 'Chép link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/paperclip/invite/tok-9`);
  });

  it('liệt kê lời mời còn hiệu lực kèm phòng và thu hồi sau khi xác nhận', async () => {
    const { calls } = mockServer(
      base({
        'GET /api/companies/c1/invites': { body: { invites: [CONTRIB_INVITE, invite('inv-n'), QC_INVITE] } },
        'POST /api/invites/inv-c/revoke': { body: { ...CONTRIB_INVITE, state: 'revoked' } },
      }),
    );
    mount();
    const rows = await screen.findAllByTestId('invite-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Phòng Marketing')).toBeTruthy();
    expect(within(rows[1]).getByText('viewer')).toBeTruthy();
    expect(within(rows[2]).getByText('Phòng QC')).toBeTruthy();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Thu hồi' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/invites/inv-c/revoke')).toBe(true),
    );
  });

  it('yêu cầu tham gia của lời mời khách có nhãn đúng phòng, lời mời thường không', async () => {
    mockServer(
      base({
        'GET /api/companies/c1/invites': { body: { invites: [CONTRIB_INVITE, invite('inv-n'), QC_INVITE] } },
        'GET /api/companies/c1/join-requests': {
          body: [
            joinRequest('jr1', 'inv-c', 'u4', 'Hoa'),
            joinRequest('jr2', 'inv-n', 'u5', 'Bình'),
            joinRequest('jr3', 'inv-q', 'u7', 'Tú'),
          ],
        },
      }),
    );
    mount();
    const rows = await screen.findAllByTestId('join-request-row');
    expect(within(rows[0]).getByText('Lời mời Phòng Marketing')).toBeTruthy();
    expect(within(rows[1]).queryByText('Lời mời Phòng Marketing')).toBeNull();
    expect(within(rows[1]).getByText('Lời mời thường')).toBeTruthy();
    expect(within(rows[2]).getByText('Lời mời Phòng QC')).toBeTruthy();
    expect(within(rows[2]).queryByText('Lời mời Phòng Marketing')).toBeNull();
  });

  it('Duyệt lời mời Phòng QC: approve rồi PUT contributors/:userId với department qc', async () => {
    const { calls } = mockServer(
      base({
        'GET /api/companies/c1/invites': { body: { invites: [QC_INVITE] } },
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr3', 'inv-q', 'u7', 'Tú')] },
        'POST /api/companies/c1/join-requests/jr3/approve': { body: { id: 'jr3', status: 'approved' } },
        'PUT /api/crew/companies/c1/contributors/u7': { status: 204 },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(putBody(calls, 'u7')).toEqual({ department: 'qc' }));
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(writes).toEqual([
      'POST /api/companies/c1/join-requests/jr3/approve',
      'PUT /api/crew/companies/c1/contributors/u7',
    ]);
  });

  it('Duyệt lời mời khách: approve rồi PUT contributors/:userId', async () => {
    const { calls } = mockServer(
      base({
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr1', 'inv-c', 'u4', 'Hoa')] },
        'POST /api/companies/c1/join-requests/jr1/approve': { body: { id: 'jr1', status: 'approved' } },
        'PUT /api/crew/companies/c1/contributors/u4': { status: 204 },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(putBody(calls, 'u4')).toEqual({ department: 'marketing' }));
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(writes).toEqual([
      'POST /api/companies/c1/join-requests/jr1/approve',
      'PUT /api/crew/companies/c1/contributors/u4',
    ]);
  });

  it('Duyệt lời mời có project chọn sẵn: approve, PUT contributors rồi PUT project-access đúng danh sách', async () => {
    const PROJ_INVITE = invite('inv-p', {
      defaultsPayload: { crew: { role: 'contributor', projectIds: ['p1', 'p2'] } },
    });
    const { calls } = mockServer(
      base({
        'GET /api/companies/c1/invites': { body: { invites: [PROJ_INVITE] } },
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr1', 'inv-p', 'u4', 'Hoa')] },
        'POST /api/companies/c1/join-requests/jr1/approve': { body: { id: 'jr1', status: 'approved' } },
        'PUT /api/crew/companies/c1/contributors/u4': { status: 204 },
        'PUT /api/crew/companies/c1/project-access/u4': {
          body: { userId: 'u4', all: false, projectIds: ['p1', 'p2'] },
        },
      }),
    );
    mount();
    const [row] = await screen.findAllByTestId('join-request-row');
    await waitFor(() => expect(within(row).getByTestId('join-request-projects').textContent).toBe('Website, Ứng dụng'));
    fireEvent.click(within(row).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/project-access/u4'))).toBe(true),
    );
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(writes).toEqual([
      'POST /api/companies/c1/join-requests/jr1/approve',
      'PUT /api/crew/companies/c1/contributors/u4',
      'PUT /api/crew/companies/c1/project-access/u4',
    ]);
    expect(calls.find((c) => c.url.endsWith('/project-access/u4'))?.body).toEqual({ projectIds: ['p1', 'p2'] });
  });

  it('cấp project chọn sẵn lỗi: báo cảnh báo chọn ở cột Project được xem', async () => {
    const PROJ_INVITE = invite('inv-p', { defaultsPayload: { crew: { role: 'contributor', projectIds: ['p1'] } } });
    mockServer(
      base({
        'GET /api/companies/c1/invites': { body: { invites: [PROJ_INVITE] } },
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr1', 'inv-p', 'u4', 'Hoa')] },
        'POST /api/companies/c1/join-requests/jr1/approve': { body: { id: 'jr1', status: 'approved' } },
        'PUT /api/crew/companies/c1/contributors/u4': { status: 204 },
        'PUT /api/crew/companies/c1/project-access/u4': {
          status: 400,
          body: { error: 'câu server', code: 'crew_project_access_invalid' },
        },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    expect(await screen.findByText('Đã duyệt nhưng chưa cấp được project')).toBeTruthy();
    expect(screen.queryByText('Đã duyệt tham gia nhưng chưa đặt được Phòng Marketing')).toBeNull();
  });

  it('Duyệt lời mời thường: không bật dấu', async () => {
    const { calls } = mockServer(
      base({
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr2', 'inv-n', 'u5', 'Bình')] },
        'POST /api/companies/c1/join-requests/jr2/approve': { body: { id: 'jr2', status: 'approved' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/jr2/approve'))).toBe(true));
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/join-requests')).length).toBeGreaterThan(2));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('bước bật dấu lỗi: báo cảnh báo, người đó vẫn là viewer thuần với nút Đặt Phòng Marketing', async () => {
    mockServer(
      base({
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr1', 'inv-c', 'u3', 'Minh')] },
        'POST /api/companies/c1/join-requests/jr1/approve': { body: { id: 'jr1', status: 'approved' } },
        'PUT /api/crew/companies/c1/contributors/u3': {
          status: 409,
          body: { error: 'Chỉ viewer mới bật được', code: 'crew_contributor_requires_viewer' },
        },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    expect(await screen.findByText('Đã duyệt tham gia nhưng chưa đặt được Phòng Marketing')).toBeTruthy();
    const rows = await screen.findAllByTestId('member-row');
    expect(within(rows[2]).getByRole('button', { name: 'Đặt Phòng Marketing' })).toBeTruthy();
  });

  it('Từ chối yêu cầu gọi reject', async () => {
    const { calls } = mockServer(
      base({
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr1', 'inv-c', 'u4', 'Hoa')] },
        'POST /api/companies/c1/join-requests/jr1/reject': { body: { id: 'jr1', status: 'rejected' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/jr1/reject'))).toBe(true));
  });

  it('không có yêu cầu thì ẩn mục yêu cầu tham gia', async () => {
    mockServer(base());
    mount();
    await screen.findAllByTestId('member-row');
    expect(screen.queryByText('Yêu cầu tham gia chờ duyệt')).toBeNull();
  });

  it('lời mời của yêu cầu nằm ở trang sau: đọc tiếp theo nextOffset rồi mới gắn nhãn', async () => {
    const { calls } = mockServer(
      base({
        'GET /api/companies/c1/invites?limit=100&offset=0': { body: { invites: [invite('inv-n')], nextOffset: 100 } },
        'GET /api/companies/c1/invites?limit=100&offset=100': { body: { invites: [CONTRIB_INVITE], nextOffset: null } },
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr1', 'inv-c', 'u4', 'Hoa')] },
      }),
    );
    mount();
    const [row] = await screen.findAllByTestId('join-request-row');
    expect(within(row).getByText('Lời mời Phòng Marketing')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/companies/c1/invites?limit=100&offset=100')).toBe(true);
  });

  it('không tìm thấy lời mời: nhãn cảnh báo và nút Duyệt và Đặt cho từng phòng (duyệt rồi bật dấu)', async () => {
    const { calls } = mockServer(
      base({
        'GET /api/companies/c1/join-requests': { body: [joinRequest('jr1', 'inv-gone', 'u4', 'Hoa')] },
        'POST /api/companies/c1/join-requests/jr1/approve': { body: { id: 'jr1', status: 'approved' } },
        'PUT /api/crew/companies/c1/contributors/u4': { status: 204 },
      }),
    );
    mount();
    const [row] = await screen.findAllByTestId('join-request-row');
    expect(within(row).getByTestId('join-invite-unknown').textContent).toBe('Không rõ loại lời mời');
    expect(within(row).getByRole('button', { name: 'Duyệt và Đặt Phòng Marketing' })).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Duyệt và Đặt Phòng QC' }));
    await waitFor(() => expect(putBody(calls, 'u4')).toEqual({ department: 'qc' }));
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => c.url);
    expect(writes).toEqual(['/api/companies/c1/join-requests/jr1/approve', '/api/crew/companies/c1/contributors/u4']);
  });

  it('thu hồi đúng lời mời vừa tạo thì link đã chép bị xóa khỏi màn hình', async () => {
    mockServer(
      base({
        'GET /api/companies/c1/invites': { body: { invites: [CONTRIB_INVITE], nextOffset: null } },
        'POST /api/companies/c1/invites': { status: 201, body: { ...CONTRIB_INVITE, token: 'tok-9' } },
        'POST /api/invites/inv-c/revoke': { body: { ...CONTRIB_INVITE, state: 'revoked' } },
      }),
    );
    mount();
    await createLink();
    expect(await screen.findByDisplayValue(`${window.location.origin}/paperclip/invite/tok-9`)).toBeTruthy();
    const [row] = await screen.findAllByTestId('invite-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Thu hồi' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Thu hồi' }));
    await waitFor(() => expect(screen.queryByDisplayValue(/tok-9/)).toBeNull());
  });

  it('lỗi đặt Phòng Marketing có mã của router hiện câu đã dịch, không phải câu server', async () => {
    mockServer(
      base({
        'PUT /api/crew/companies/c1/contributors/u3': {
          status: 409,
          body: { error: 'câu server', code: 'crew_contributor_requires_viewer' },
        },
      }),
    );
    mount();
    const row = (await screen.findAllByTestId('member-row'))[2];
    fireEvent.click(within(row).getByRole('button', { name: 'Đặt Phòng Marketing' }));
    expect(
      await screen.findByText('Chỉ đặt được Phòng Marketing hoặc Phòng QC cho thành viên chỉ xem đang hoạt động.'),
    ).toBeTruthy();
    expect(screen.queryByText('câu server')).toBeNull();
  });

  it('cột Project được xem: owner "Tất cả", người khác hiện project được cấp hoặc "Chưa có project"', async () => {
    mockServer(base());
    mount();
    const rows = await screen.findAllByTestId('member-row');
    const cell = (row: HTMLElement) => within(row).getByTestId('member-projects');
    await waitFor(() => expect(within(cell(rows[1])).getByRole('button', { name: /Chọn project Lan/ })).toBeTruthy());
    expect(within(cell(rows[0])).getByText('Tất cả')).toBeTruthy();
    expect(within(cell(rows[0])).queryByRole('button')).toBeNull();
    expect(within(cell(rows[1])).getByText('Website')).toBeTruthy();
    expect(within(cell(rows[2])).getByText('Chưa có project')).toBeTruthy();
  });

  it('chọn project rồi Lưu gửi PUT project-access/:userId với cả danh sách', async () => {
    const { calls } = mockServer(
      base({
        'PUT /api/crew/companies/c1/project-access/u2': (init: RequestInit | undefined) => ({
          body: { userId: 'u2', all: false, projectIds: JSON.parse(String(init?.body)).projectIds },
        }),
      }),
    );
    mount();
    const row = (await screen.findAllByTestId('member-row'))[1];
    fireEvent.click(await within(row).findByRole('button', { name: /Chọn project Lan/ }));
    const editor = await screen.findByTestId('project-access-editor');
    expect(within(editor).queryByText('Cũ')).toBeNull();
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Ứng dụng' }));
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Website' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/project-access/u2'));
      expect(put?.body).toEqual({ projectIds: ['p2'] });
    });
    await waitFor(() => expect(screen.queryByTestId('project-access-editor')).toBeNull());
  });

  it('lỗi lưu quyền có mã của router hiện câu đã dịch', async () => {
    mockServer(
      base({
        'PUT /api/crew/companies/c1/project-access/u3': {
          status: 409,
          body: { error: 'câu server', code: 'crew_project_access_not_member' },
        },
      }),
    );
    mount();
    const row = (await screen.findAllByTestId('member-row'))[2];
    fireEvent.click(await within(row).findByRole('button', { name: /Chọn project Minh/ }));
    fireEvent.click(within(await screen.findByTestId('project-access-editor')).getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Chỉ chọn project cho thành viên đang hoạt động không phải owner.')).toBeTruthy();
  });
});
