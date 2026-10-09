// F5 Hủy: bấm Hủy khi run đang chạy → issue và run thành cancelled, process group của run trên Mac mất hết;
// ca âm: agent không tự hủy được (422 agent_cancel_forbidden). Chỉ chạy ở T2 (project nền e2e-base, stub 300 giây).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { withAgentToken } from '../support/agent-token';
import { bearerApi } from '../support/api';
import { trackIssue } from '../support/cleanup';
import { uniqueToken } from '../support/data';
import { BASE_PROJECT_KEY } from '../support/env';
import { expect, test } from '../support/fixtures';
import { e2eCheckouts, stub } from '../support/stub';

interface Roles {
  assistantAgentId: string;
}
interface Run {
  id: string;
  status: string;
  contextSnapshot?: { issueId?: string };
}

const groupPids = (pgid: string): string[] =>
  (() => {
    try {
      return execFileSync('ps', ['-g', pgid, '-o', 'pid='], { encoding: 'utf8' })
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return []; // ps thoát khác 0 khi không còn process nào trong nhóm
    }
  })();

test('PW-F5 hủy khi run đang chạy: issue và run cancelled, process group trên Mac mất, agent không tự hủy được', async ({
  page,
  company,
  api,
}) => {
  const projectId = process.env.CREW_E2E_BASE_PROJECT_ID ?? '';
  test.skip(!projectId, 'Cần project nền e2e-base (T2)');
  test.setTimeout(300_000);
  const roles = (await api.crewRoute<{ roles: Roles }>('GET', `/projects/${projectId}/roles?companyId=${company.id}`))
    .roles;
  const assistantId = roles.assistantAgentId;

  stub.on(BASE_PROJECT_KEY, 300);
  try {
    const created = await api.post<{ id: string; identifier: string }>(`/api/companies/${company.id}/issues`, {
      title: `PW-F5 ${uniqueToken()}`,
      projectId,
      assigneeAgentId: assistantId,
      status: 'todo',
    });
    trackIssue(created.id);

    const runOf = async () =>
      (await api.get<Run[]>(`/api/companies/${company.id}/heartbeat-runs?agentId=${assistantId}`)).find(
        (r) => r.contextSnapshot?.issueId === created.id,
      );
    await expect.poll(async () => (await runOf())?.status, { timeout: 90_000, intervals: [2_000] }).toBe('running');
    const runId = (await runOf())?.id as string;

    // Wrapper ghi pgid của run vào <checkout>/.paperclip-runtime/runs/<runId>/pgid (assets/crew-claude-run.sh).
    let pgidFile = '';
    await expect
      .poll(
        () => {
          for (const c of e2eCheckouts(BASE_PROJECT_KEY)) {
            const f = path.join(c.checkout, '.paperclip-runtime', 'runs', runId, 'pgid');
            if (existsSync(f)) {
              pgidFile = f;
              return true;
            }
          }
          return false;
        },
        { timeout: 30_000, intervals: [1_000], message: 'wrapper chưa ghi pgid của run' },
      )
      .toBe(true);
    const pgid = readFileSync(pgidFile, 'utf8').trim();
    expect(pgid).toMatch(/^\d+$/);
    expect(groupPids(pgid).length, 'process group phải còn sống trước khi hủy').toBeGreaterThan(0);

    // Ca âm: token agent tự hủy bị từ chối, issue và run không đổi.
    await withAgentToken(api, assistantId, async (token) => {
      const agent = await bearerApi(token);
      try {
        const res = await agent.raw(
          'PATCH',
          `/api/issues/${created.id}`,
          { status: 'cancelled' },
          { 'X-Paperclip-Run-Id': runId },
        );
        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain('agent_cancel_forbidden');
      } finally {
        await agent.dispose();
      }
    });
    expect((await api.get<{ status: string }>(`/api/issues/${created.id}`)).status).not.toBe('cancelled');

    // Hủy bằng UI.
    await page.goto(company.path(`issues/${created.identifier}`));
    await page.getByRole('button', { name: 'Hủy yêu cầu' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hủy yêu cầu' }).click();

    await expect
      .poll(async () => (await api.get<{ status: string }>(`/api/issues/${created.id}`)).status, { timeout: 30_000 })
      .toBe('cancelled');
    await expect.poll(async () => (await runOf())?.status, { timeout: 30_000, intervals: [1_000] }).toBe('cancelled');
    await expect
      .poll(() => groupPids(pgid), { timeout: 30_000, intervals: [1_000], message: 'process group của run vẫn còn' })
      .toEqual([]);
  } finally {
    stub.on(BASE_PROJECT_KEY, 5);
  }
});
