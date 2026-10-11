// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';

afterEach(() => vi.restoreAllMocks());

/** Giả fetch: trả `body` (hoặc 204 khi bỏ trống) và cho đọc lại lời gọi. */
function stub(body?: unknown, status = body === undefined ? 204 : 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function lastCall(f: ReturnType<typeof stub>) {
  const [url, init] = f.mock.calls[f.mock.calls.length - 1] as [string, RequestInit];
  return { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
}

const BASE = '/api/crew/companies/c1';
const item = { id: 'k1', kind: 'issue', status: 'pending' };

describe('api.contributions', () => {
  it('access: GET /access', async () => {
    const f = stub({ userId: 'u1', membershipRole: 'viewer', contributor: true, canApprove: false });
    const res = await api.contributions.access('c1');
    expect(lastCall(f)).toMatchObject({ url: `${BASE}/access`, method: 'GET' });
    expect(res.contributor).toBe(true);
  });

  it('list: GET /contributions với bộ lọc, trả mảng items', async () => {
    const f = stub({ items: [item] });
    const res = await api.contributions.list('c1', { status: 'pending', kind: 'comment', issueId: 'i1' });
    expect(lastCall(f)).toMatchObject({
      url: `${BASE}/contributions?status=pending&kind=comment&issueId=i1`,
      method: 'GET',
    });
    expect(res).toEqual([item]);
  });

  it('page: đọc trang kế bằng before, trả kèm nextBefore', async () => {
    const f = stub({ items: [item], nextBefore: 'k1' });
    const res = await api.contributions.page('c1', { status: 'approved' }, 'k0');
    expect(lastCall(f).url).toBe(`${BASE}/contributions?status=approved&before=k0`);
    expect(res).toEqual({ items: [item], nextBefore: 'k1' });
  });

  it('list không lọc thì không có query', async () => {
    const f = stub({ items: [] });
    await api.contributions.list('c1');
    expect(lastCall(f).url).toBe(`${BASE}/contributions`);
  });

  it('summary: GET /contributions/summary', async () => {
    const f = stub({ pending: 4 });
    expect(await api.contributions.summary('c1')).toEqual({ pending: 4 });
    expect(lastCall(f)).toMatchObject({ url: `${BASE}/contributions/summary`, method: 'GET' });
  });

  it('get: GET /contributions/:id, mã hóa id', async () => {
    const f = stub(item);
    await api.contributions.get('c1', 'a b');
    expect(lastCall(f).url).toBe(`${BASE}/contributions/a%20b`);
  });

  it('create yêu cầu: POST đúng body, không thêm trường nào', async () => {
    const f = stub(item, 201);
    await api.contributions.create('c1', {
      kind: 'issue',
      projectId: 'p1',
      title: 'Làm trang A',
      description: 'Chi tiết',
    });
    expect(lastCall(f)).toMatchObject({
      url: `${BASE}/contributions`,
      method: 'POST',
      body: { kind: 'issue', projectId: 'p1', title: 'Làm trang A', description: 'Chi tiết' },
    });
  });

  it('create bình luận: POST {kind, issueId, body}', async () => {
    const f = stub({ ...item, kind: 'comment' }, 201);
    await api.contributions.create('c1', { kind: 'comment', issueId: 'i1', body: 'Góp ý' });
    expect(lastCall(f).body).toEqual({ kind: 'comment', issueId: 'i1', body: 'Góp ý' });
  });

  it('approve / complete / reject: POST không body vào đúng đường', async () => {
    const approval = {
      contribution: item,
      materialize: { kind: 'comment', issueId: 'i1', body: 'x', clientRequestId: 'k1' },
    };
    const f = stub(approval);
    expect(await api.contributions.approve('c1', 'k1')).toEqual(approval);
    expect(lastCall(f)).toMatchObject({ url: `${BASE}/contributions/k1/approve`, method: 'POST', body: undefined });
    await api.contributions.complete('c1', 'k1');
    expect(lastCall(f)).toMatchObject({ url: `${BASE}/contributions/k1/approve/complete`, method: 'POST' });
    await api.contributions.reject('c1', 'k1');
    expect(lastCall(f)).toMatchObject({ url: `${BASE}/contributions/k1/reject`, method: 'POST' });
  });

  it('complete 409 giữ nguyên câu lỗi và mã của server', async () => {
    stub({ error: 'Chưa thấy bản ghi', code: 'crew_contribution_not_materialized' }, 409);
    await expect(api.contributions.complete('c1', 'k1')).rejects.toMatchObject({
      status: 409,
      message: 'Chưa thấy bản ghi',
      code: 'crew_contribution_not_materialized',
    });
  });

  it('contributors: GET danh sách, PUT bật, DELETE gỡ (204)', async () => {
    const f = stub({ items: [{ userId: 'u2', grantedAt: 't', grantedByUserId: 'u1' }] });
    expect(await api.contributions.contributors('c1')).toHaveLength(1);
    expect(lastCall(f)).toMatchObject({ url: `${BASE}/contributors`, method: 'GET' });
    const g = stub();
    await api.contributions.enableContributor('c1', 'u 2');
    expect(lastCall(g)).toMatchObject({ url: `${BASE}/contributors/u%202`, method: 'PUT' });
    await api.contributions.disableContributor('c1', 'u2');
    expect(lastCall(g)).toMatchObject({ url: `${BASE}/contributors/u2`, method: 'DELETE' });
  });
});

describe('api.comments.add', () => {
  it('clientRequestId đi kèm body khi có, vắng khi không', async () => {
    const f = stub({ id: 'cm1' });
    await api.comments.add('i1', 'Nội dung');
    expect(lastCall(f)).toMatchObject({ url: '/api/issues/i1/comments', method: 'POST', body: { body: 'Nội dung' } });
    await api.comments.add('i1', 'Nội dung', undefined, 'k1');
    expect(lastCall(f).body).toEqual({ body: 'Nội dung', clientRequestId: 'k1' });
    await api.comments.add('i1', 'Nội dung', ['att1'], 'k1');
    expect(lastCall(f).body).toEqual({ body: 'Nội dung', attachmentIds: ['att1'], clientRequestId: 'k1' });
  });
});

describe('api members, invites, joinRequests', () => {
  it('members.list lấy mảng members; userDirectory lấy mảng users', async () => {
    const f = stub({ members: [{ id: 'm1', principalId: 'u2' }], access: {} });
    expect(await api.members.members('c1')).toEqual([{ id: 'm1', principalId: 'u2' }]);
    expect(lastCall(f)).toMatchObject({ url: '/api/companies/c1/members', method: 'GET' });
    stub({ users: [{ principalId: 'u2' }] });
    expect(await api.members.userDirectory('c1')).toEqual([{ principalId: 'u2' }]);
  });

  it('mời khách góp ý: POST invites với viewer và dấu crew.role = contributor', async () => {
    const f = stub({ id: 'inv1', token: 'tok' }, 201);
    const res = await api.invites.createContributor('c1');
    expect(lastCall(f)).toMatchObject({
      url: '/api/companies/c1/invites',
      method: 'POST',
      body: { allowedJoinTypes: 'human', humanRole: 'viewer', defaultsPayload: { crew: { role: 'contributor' } } },
    });
    expect(res.token).toBe('tok');
  });

  it('listAll đọc hết các trang lời mời theo nextOffset; thu hồi POST /invites/:id/revoke', async () => {
    const pages = [
      { invites: [{ id: 'inv1' }], nextOffset: 100 },
      { invites: [{ id: 'inv2' }], nextOffset: null },
    ];
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(pages.shift())));
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await api.invites.listAll('c1')).toEqual([{ id: 'inv1' }, { id: 'inv2' }]);
    expect(f.mock.calls.map(([url]) => url)).toEqual([
      '/api/companies/c1/invites?limit=100&offset=0',
      '/api/companies/c1/invites?limit=100&offset=100',
    ]);
    const r = stub({ id: 'inv1' });
    await api.invites.revoke('inv1');
    expect(lastCall(r)).toMatchObject({ url: '/api/invites/inv1/revoke', method: 'POST' });
  });

  it('listAll dừng ở số trang tối đa', async () => {
    const f = stub({ invites: [{ id: 'x' }], nextOffset: 100 });
    expect(await api.invites.listAll('c1', 3)).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('yêu cầu tham gia: list (lọc trạng thái), approve, reject', async () => {
    const f = stub([{ id: 'jr1' }]);
    await api.joinRequests.list('c1', 'pending_approval');
    expect(lastCall(f)).toMatchObject({
      url: '/api/companies/c1/join-requests?status=pending_approval',
      method: 'GET',
    });
    await api.joinRequests.approve('c1', 'jr1');
    expect(lastCall(f)).toMatchObject({ url: '/api/companies/c1/join-requests/jr1/approve', method: 'POST' });
    await api.joinRequests.reject('c1', 'jr1');
    expect(lastCall(f)).toMatchObject({ url: '/api/companies/c1/join-requests/jr1/reject', method: 'POST' });
  });
});
