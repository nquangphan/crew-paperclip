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

const CONTRIB_INVITE = invite('inv-c', { defaultsPayload: { crew: { role: 'contributor' } } });
const base = (over: Record<string, unknown> = {}) => ({
  'GET /api/companies/c1/members': {
    body: { members: [member('u1', 'owner', 'Chủ'), member('u2', 'viewer', 'Lan'), member('u3', 'viewer', 'Minh')] },
  },
  'GET /api/crew/companies/c1/contributors': {
    body: { items: [{ userId: 'u2', grantedAt: '2026-10-11T00:00:00.000Z', grantedByUserId: 'u1' }] },
  },
  'GET /api/companies/c1/invites': { body: { invites: [CONTRIB_INVITE, invite('inv-n')] } },
  'GET /api/companies/c1/join-requests': { body: [] },
  ...over,
});

describe('trang Thành viên', () => {
  it('hiện role, viewer có dấu là Phòng Marketing kèm nút Gỡ, viewer thuần kèm nút Bật', async () => {
    mockServer(base());
    mount();
    const rows = await screen.findAllByTestId('member-row');
    expect(rows.map((r) => r.getAttribute('data-role'))).toEqual(['owner', 'contributor', 'viewer']);
    expect(within(rows[1]).getByText('Phòng Marketing')).toBeTruthy();
    expect(within(rows[1]).getByRole('button', { name: 'Gỡ Phòng Marketing' })).toBeTruthy();
    expect(within(rows[2]).getByRole('button', { name: 'Đặt Phòng Marketing' })).toBeTruthy();
    expect(within(rows[0]).queryByRole('button')).toBeNull();
  });

  it('Đặt Phòng Marketing gọi PUT contributors/:userId', async () => {
    const { calls } = mockServer(base({ 'PUT /api/crew/companies/c1/contributors/u3': { status: 204 } }));
    mount();
    const row = (await screen.findAllByTestId('member-row'))[2];
    fireEvent.click(within(row).getByRole('button', { name: 'Đặt Phòng Marketing' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/contributors/u3'))).toBe(true));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Mời Phòng Marketing' }));
    const input = (await screen.findByLabelText('Link mời')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/paperclip/invite/tok-123`);
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/invites'));
    expect(post?.body).toEqual({
      allowedJoinTypes: 'human',
      humanRole: 'viewer',
      defaultsPayload: { crew: { role: 'contributor' } },
    });
  });

  it('chép link vào clipboard', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mockServer(
      base({ 'POST /api/companies/c1/invites': { status: 201, body: { ...CONTRIB_INVITE, token: 'tok-9' } } }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Mời Phòng Marketing' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chép link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/paperclip/invite/tok-9`);
  });

  it('liệt kê lời mời còn hiệu lực và thu hồi sau khi xác nhận', async () => {
    const { calls } = mockServer(
      base({ 'POST /api/invites/inv-c/revoke': { body: { ...CONTRIB_INVITE, state: 'revoked' } } }),
    );
    mount();
    const rows = await screen.findAllByTestId('invite-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Phòng Marketing')).toBeTruthy();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Thu hồi' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/invites/inv-c/revoke')).toBe(true),
    );
  });

  it('yêu cầu tham gia của lời mời khách có nhãn, lời mời thường không', async () => {
    mockServer(
      base({
        'GET /api/companies/c1/join-requests': {
          body: [joinRequest('jr1', 'inv-c', 'u4', 'Hoa'), joinRequest('jr2', 'inv-n', 'u5', 'Bình')],
        },
      }),
    );
    mount();
    const rows = await screen.findAllByTestId('join-request-row');
    expect(within(rows[0]).getByText('Lời mời Phòng Marketing')).toBeTruthy();
    expect(within(rows[1]).queryByText('Lời mời Phòng Marketing')).toBeNull();
    expect(within(rows[1]).getByText('Lời mời thường')).toBeTruthy();
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
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/contributors/u4'))).toBe(true));
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(writes).toEqual([
      'POST /api/companies/c1/join-requests/jr1/approve',
      'PUT /api/crew/companies/c1/contributors/u4',
    ]);
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

  it('không tìm thấy lời mời: nhãn cảnh báo và nút Duyệt và Đặt Phòng Marketing (duyệt rồi bật dấu)', async () => {
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
    fireEvent.click(within(row).getByRole('button', { name: 'Duyệt và Đặt Phòng Marketing' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/contributors/u4'))).toBe(true));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Mời Phòng Marketing' }));
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
    expect(await screen.findByText('Chỉ đặt được Phòng Marketing cho thành viên chỉ xem đang hoạt động.')).toBeTruthy();
    expect(screen.queryByText('câu server')).toBeNull();
  });
});
