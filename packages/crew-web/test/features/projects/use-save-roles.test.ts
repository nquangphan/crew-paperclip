import { beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/api';
import { bmadIdsOf, saveRoles } from '@/features/projects/detail/use-save-roles';
import { mockServer } from '../../app/fetch-mock';
import { ID, ROLES } from './helpers';

const lastBody = (s: { calls: { body: unknown }[] }) => s.calls[s.calls.length - 1].body as Record<string, unknown>;
const RULES = '## Agent BMAD của company\n\n';
const FILE_URL = `GET /api/agents/${ID.assistant}/instructions-bundle/file`;
const PUT_URL = `PUT /api/agents/${ID.assistant}/instructions-bundle/file`;
const ROLES_POST = 'POST /api/plugins/crew.core/api/projects/p1/roles';

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    [ROLES_POST]: (init) => ({ body: { roles: JSON.parse(String(init?.body)) } }),
    [FILE_URL]: { body: { content: 'cũ', contentHash: 'h-old' } },
    [PUT_URL]: { body: { contentHash: 'h-new' } },
    ...(extra as Record<string, never>),
  });
}

describe('bmadIdsOf', () => {
  it('lấy id trong mục Agent BMAD, bỏ qua mục Executor', () => {
    const text = `## Executor của company\n\n- \`${ID.executor}\`\n\n${RULES}- \`${ID.spare}\`\n`;
    expect(bmadIdsOf(text)).toEqual([ID.spare]);
  });
  it('mục "Không có" hoặc không có mục → rỗng', () => {
    expect(bmadIdsOf(`${RULES}Không có. Luôn dùng Superpowers.\n`)).toEqual([]);
    expect(bmadIdsOf('chưa render')).toEqual([]);
  });
});

describe('saveRoles', () => {
  let s: ReturnType<typeof mockServer>;
  beforeEach(() => {
    s = server();
  });

  it('đổi reviewer (executor giữ nguyên) → 1 POST roles, không đụng AGENTS.md', async () => {
    const next = { ...ROLES, reviewerAgentId: ID.spare };
    const res = await saveRoles(api, 'c-tps', 'p1', next, ROLES);
    expect(res).toEqual({ roles: 'ok', instructions: 'unchanged' });
    expect(s.calls.map((c) => c.method)).toEqual(['POST']);
    expect(s.calls[0].body).toEqual({ companyId: 'c-tps', ...next });
  });

  it('thêm executor → POST roles rồi GET + PUT AGENTS.md của Trợ Lý có baseHash, giữ danh sách BMAD', async () => {
    s = server({
      [FILE_URL]: { body: { content: `${RULES}- \`${ID.spare}\`\n`, contentHash: 'h-old' } },
    });
    const next = { ...ROLES, executorAgentIds: [ID.executor, ID.executor2] };
    const res = await saveRoles(api, 'c-tps', 'p1', next, ROLES);
    expect(res).toEqual({ roles: 'ok', instructions: 'ok' });
    const kinds = s.calls.map((c) => c.method);
    expect(kinds[0]).toBe('POST');
    expect(kinds.at(-1)).toBe('PUT');
    const body = lastBody(s) as { path: string; content: string; baseHash: string };
    expect(body.path).toBe('AGENTS.md');
    expect(body.baseHash).toBe('h-old');
    expect(body.content).toContain(`- \`${ID.executor2}\``);
    expect(body.content).toContain(`- \`${ID.spare}\``);
  });

  it('PUT trả 409 → instructions: conflict (vai trò vẫn lưu)', async () => {
    s = server({ [PUT_URL]: { status: 409, body: { error: 'conflict' } } });
    const next = { ...ROLES, executorAgentIds: [ID.executor, ID.executor2] };
    expect(await saveRoles(api, 'c-tps', 'p1', next, ROLES)).toEqual({ roles: 'ok', instructions: 'conflict' });
  });

  it('POST roles trả 400 → ném message nguyên văn, không PUT', async () => {
    s = server({ [ROLES_POST]: { status: 400, body: { error: 'Reviewer không được trùng Integrator' } } });
    const next = { ...ROLES, executorAgentIds: [ID.executor, ID.executor2], reviewerAgentId: ID.integrator };
    await expect(saveRoles(api, 'c-tps', 'p1', next, ROLES)).rejects.toThrow('Reviewer không được trùng Integrator');
    expect(s.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('project chưa có dòng vai trò → coi như executor đổi, render cho Trợ Lý', async () => {
    s = server({ [FILE_URL]: { status: 404, body: { error: 'not found' } } });
    const res = await saveRoles(api, 'c-tps', 'p1', ROLES, null);
    expect(res).toEqual({ roles: 'ok', instructions: 'ok' });
    expect(lastBody(s).baseHash).toBeNull();
  });

  it('nội dung render trùng file hiện có → unchanged, không PUT', async () => {
    const first = server();
    await saveRoles(api, 'c-tps', 'p1', ROLES, null);
    const rendered = lastBody(first).content as string;
    s = server({ [FILE_URL]: { body: { content: rendered, contentHash: 'same' } } });
    expect(await saveRoles(api, 'c-tps', 'p1', ROLES, null)).toEqual({ roles: 'ok', instructions: 'unchanged' });
    expect(s.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
