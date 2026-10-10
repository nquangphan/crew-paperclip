// Ca âm R3X bằng token agent: agent không sửa/xóa/chép skill, không tự đổi skill của mình, không gỡ/archive project,
// không tạm dừng agent khác, không chạm route setup-runs và machine-jobs; payload việc máy sai bị plugin từ chối.
import { agentToken } from '../support/agent-token';
import { type Api, bearerApi } from '../support/api';
import { archiveProject, createProject, uniqueToken } from '../support/data';
import { isProd } from '../support/env';
import { expect, test } from '../support/fixtures';
import {
  createSkill,
  ensureSkillDenyRule,
  gateAgents,
  removeSkillViaUi,
  skillAgent,
  skillMarkdown,
  skillSlug,
} from '../support/r3x';

const PLUGIN = '/api/plugins/crew.core/api';
const NO_MACHINE = '11111111-1111-4111-8111-111111111111';
const NO_PROJECT = '22222222-2222-4222-8222-222222222222';
const NO_SKILL = '33333333-3333-4333-8333-333333333333';

/** Chạy `fn` với client bearer của key agent tạm; key luôn bị thu hồi. */
async function asAgent<T>(api: Api, agentId: string, fn: (agent: Api) => Promise<T>): Promise<T> {
  const key = await agentToken(api, agentId);
  const client = await bearerApi(key.token);
  try {
    return await fn(client);
  } finally {
    await client.dispose();
    await key.revoke();
  }
}

test('PW-X-AX6 Token agent không sửa, xóa, chép skill hay tự đổi skill của mình @t1', async ({
  page,
  company,
  api,
}) => {
  await ensureSkillDenyRule(api, company.id, !isProd());
  const slug = skillSlug('e2e-neg');
  const skill = await createSkill(api, company.id, slug, 'Bản gốc');
  const { id: agentId } = await skillAgent(api, company.id);
  try {
    await asAgent(api, agentId, async (agent) => {
      const edit = await agent.raw('PATCH', `/api/companies/${company.id}/skills/${skill.id}/files`, {
        path: 'SKILL.md',
        content: skillMarkdown(slug, 'Bị agent sửa'),
      });
      expect(edit.status).toBe(403);
      expect(edit.body).toMatchObject({ code: 'skill_policy_denied' });

      const del = await agent.raw('DELETE', `/api/companies/${company.id}/skills/${skill.id}`);
      expect(del.status).toBe(403);
      expect(del.body).toMatchObject({ code: 'skill_policy_denied' });

      const fork = await agent.raw('POST', `/api/companies/${company.id}/skills/${skill.id}/fork`, {});
      expect(fork.status).toBe(403);

      const own = await agent.raw('POST', `/api/agents/${agentId}/skills/sync`, {
        desiredSkills: [skill.key],
        mode: 'replace',
      });
      expect(own.status).toBe(422);
    });

    // Tác dụng thật: skill còn nguyên, nội dung cũ, không bản chép nào.
    const still = await api.get<{ id: string; markdown: string }>(`/api/companies/${company.id}/skills/${skill.id}`);
    expect(still.markdown).toContain('Bản gốc');
    const all = await api.get<{ forkedFromSkillId?: string | null }[]>(`/api/companies/${company.id}/skills`);
    expect(all.some((s) => s.forkedFromSkillId === skill.id)).toBe(false);

    // Trang Skills: khối skill ghim chỉ đọc, không có nút hay liên kết nào.
    await page.goto(company.path('skills'));
    const pinned = page.getByRole('region', { name: 'Skill ghim (Superpowers)' });
    await expect(pinned).toBeVisible();
    await expect(pinned.getByRole('button')).toHaveCount(0);
    await expect(pinned.getByRole('link')).toHaveCount(0);
  } finally {
    await removeSkillViaUi(page, api, company, { id: skill.id, slug }, [agentId]);
  }
});

test('PW-X-AX6b Plugin từ chối việc máy skill-remove có slug thoát thư mục @t1', async ({ company, api }) => {
  for (const slug of ['../workflows', '..', 'a/b', '.hidden', '']) {
    const res = await api.raw('POST', `${PLUGIN}/machine-jobs`, {
      companyId: company.id,
      machineId: NO_MACHINE,
      kind: 'skill-remove',
      payload: { kind: 'skill-remove', skillId: NO_SKILL, slug },
    });
    expect(res.status, `slug ${JSON.stringify(slug)}`).toBe(400);
  }
});

test('PW-X-AX9 Token agent không archive project, không tạm dừng agent khác, không chạm setup-runs và machine-jobs @t1', async ({
  company,
  api,
}) => {
  const project = await createProject(api, company.id, `e2e-neg-${uniqueToken()}`);
  const { workerId, reviewerId } = await gateAgents(api, company.id);
  try {
    await asAgent(api, workerId, async (agent) => {
      const archive = await agent.raw('PATCH', `/api/projects/${project.id}`, {
        archivedAt: new Date().toISOString(),
      });
      expect(archive.status).toBe(403);
      expect(archive.body).toMatchObject({ code: 'crew_board_only' });

      const pause = await agent.raw('POST', `/api/agents/${reviewerId}/pause`, {});
      expect(pause.status).toBe(403);

      const calls: [string, string, unknown?][] = [
        [
          'POST',
          `${PLUGIN}/setup-runs`,
          { companyId: company.id, kind: 'remove-project', projectKey: 'x', machineId: NO_MACHINE },
        ],
        ['GET', `${PLUGIN}/setup-runs/${NO_PROJECT}?companyId=${company.id}`],
        ['GET', `${PLUGIN}/machine-jobs?companyId=${company.id}`],
        [
          'POST',
          `${PLUGIN}/machine-jobs`,
          {
            companyId: company.id,
            machineId: NO_MACHINE,
            kind: 'skill-remove',
            payload: { kind: 'skill-remove', skillId: NO_SKILL, slug: 'x' },
          },
        ],
      ];
      for (const [method, url, body] of calls) {
        const res = await agent.raw(method, url, body);
        expect(res.status, `${method} ${url}`).toBe(403);
      }
    });
    const after = await api.get<{ archivedAt?: string | null }>(`/api/projects/${project.id}`);
    expect(after.archivedAt ?? null).toBeNull();
    const reviewer = await api.get<{ status: string }>(`/api/agents/${reviewerId}`);
    expect(reviewer.status).not.toBe('paused');
  } finally {
    await archiveProject(api, project.id);
  }
});

test('PW-X-AX9b Plugin từ chối việc máy remove-checkouts có projectKey thoát thư mục @t1', async ({ company, api }) => {
  for (const projectKey of ['../x', 'a/b', '..', 'X', '']) {
    const res = await api.raw('POST', `${PLUGIN}/machine-jobs`, {
      companyId: company.id,
      machineId: NO_MACHINE,
      kind: 'remove-checkouts',
      payload: {
        kind: 'remove-checkouts',
        projectId: NO_PROJECT,
        projectKey,
        roles: ['executor'],
        removeStatusRepo: false,
      },
    });
    expect(res.status, `projectKey ${JSON.stringify(projectKey)}`).toBe(400);
  }
});
