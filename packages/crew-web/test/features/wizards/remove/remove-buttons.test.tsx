// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RemoveAgentButton, RemoveProjectButton } from '@/features/wizards/remove/remove-buttons';
import { RemoveProjectPage } from '@/features/wizards/remove/remove-pages';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../../app/fetch-mock';
import { data, ID, renderPage } from '../../projects/helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

/** Nút đã hết trạng thái tải (lúc tải nút hiện nhưng tắt). */
async function enabledButton(name: string) {
  return waitFor(() => {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    return button;
  });
}

const PLUGIN = '/api/plugins/crew.core/api';
const P = 'p0000000-0000-4000-8000-000000000001';
const M1 = 'm1000000-0000-4000-8000-000000000001';

const roles = (executors: string[]) => ({
  assistantAgentId: ID.assistant,
  executorAgentIds: executors,
  reviewerAgentId: ID.reviewer,
  integratorAgentId: ID.integrator,
});
const agent = (id: string, name: string, slot: string, status = 'idle') => ({
  id,
  name,
  status,
  defaultEnvironmentId: `env-${slot}`,
});
const AGENTS = [
  agent(ID.assistant, 'demo-assistant', 'assistant'),
  agent(ID.executor, 'demo-executor', 'executor', 'running'),
  agent(ID.executor2, 'demo-executor-2', 'executor-2'),
  agent(ID.reviewer, 'demo-reviewer', 'reviewer'),
  agent(ID.integrator, 'demo-integrator', 'integrator'),
  agent(ID.spare, 'le', 'spare'),
];
const ADD_RUN = {
  id: 'run-add',
  companyId: 'c-tps',
  kind: 'add-project',
  projectKey: 'demo',
  projectId: P,
  machineId: M1,
  input: { name: 'Demo', key: 'demo', folder: '/Users/owner/code/demo', executors: 2 },
  steps: {},
  status: 'done',
  runningStep: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const MACHINES = [
  {
    machineId: M1,
    hostname: 'mac-mini',
    online: true,
    latest: {
      checkouts: [
        { path: '/Users/owner/crew-agents/demo/assistant', head: null, clean: true },
        { path: '/Users/owner/crew-agents/demo/executor', head: null, clean: false },
        { path: '/Users/owner/crew-agents/demo/executor-2', head: null, clean: true },
        { path: '/Users/owner/crew-agents/other/executor', head: null, clean: false },
      ],
    },
  },
];

function server(opts: { runs?: unknown[]; extra?: Record<string, unknown> } = {}) {
  return mockServer({
    ...data('crew.setupRuns', opts.runs ?? [ADD_RUN]),
    ...data('crew.machines', MACHINES),
    'GET /api/companies/c-tps/agents': { body: AGENTS },
    'GET /api/companies/c-tps/environments': { body: [] },
    'GET /api/companies/c-tps/projects': { body: [{ id: P, name: 'Demo', urlKey: 'demo', archivedAt: null }] },
    [`GET ${PLUGIN}/projects/${P}/roles`]: { body: { roles: roles([ID.executor, ID.executor2]) } },
    'GET /api/companies/c-tps/issues': {
      body: [
        { id: 'i1', status: 'todo' },
        { id: 'i2', status: 'in_progress' },
        { id: 'i3', status: 'done' },
      ],
    },
    'GET /api/companies/c-tps/live-runs': {
      body: [
        { id: 'r1', status: 'running', agentId: ID.executor, agentName: 'demo-executor' },
        { id: 'r2', status: 'succeeded', agentId: ID.assistant, agentName: 'demo-assistant' },
        { id: 'r3', status: 'running', agentId: ID.spare, agentName: 'le' },
      ],
    },
    ...((opts.extra ?? {}) as Record<string, { body: unknown }>),
  });
}

const mountProject = () =>
  renderPage(<RemoveProjectButton project={{ id: P, name: 'Demo' }} />, {
    route: 'projects/:id',
    at: `/TPS/projects/${P}`,
  });

describe('RemoveProjectButton', () => {
  it('hộp xác nhận hiện agent, số yêu cầu chưa xong, run đang chạy, checkout bẩn; phải gõ đúng tên', async () => {
    server();
    mountProject();
    fireEvent.click(await enabledButton('Gỡ project'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/demo-assistant/)).toBeTruthy();
    expect(await within(dialog).findByText('2 yêu cầu chưa xong: giữ nguyên, không hủy.')).toBeTruthy();
    expect(within(dialog).getByText('1 run đang chạy: sẽ dừng.')).toBeTruthy();
    expect(
      within(dialog).getByText('/Users/owner/crew-agents/demo/executor · có việc chưa commit, sẽ giữ lại'),
    ).toBeTruthy();
    expect(within(dialog).getByText('/Users/owner/crew-agents/demo/assistant · sạch, sẽ gỡ')).toBeTruthy();
    expect(within(dialog).queryByText(/crew-agents\/other/)).toBeNull();

    const confirm = within(dialog).getByRole('button', { name: 'Gỡ project' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'demo' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Demo' } });
    expect(confirm.disabled).toBe(false);
  });

  it('xác nhận tạo setup run remove-project với input {projectId, projectName} rồi mở trang tiến độ', async () => {
    const { calls } = server({
      extra: {
        [`POST ${PLUGIN}/setup-runs`]: { status: 201, body: { ...ADD_RUN, id: 'run-rm', kind: 'remove-project' } },
      },
    });
    const router = mountProject();
    fireEvent.click(await enabledButton('Gỡ project'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Demo' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gỡ project' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/projects/remove'));
    expect(router.state.location.search).toBe('?resume=run-rm');
    const create = calls.find((c) => c.method === 'POST' && c.url === `${PLUGIN}/setup-runs`);
    expect(create?.body).toEqual({
      companyId: 'c-tps',
      kind: 'remove-project',
      projectKey: 'demo',
      machineId: M1,
      input: { projectId: P, projectName: 'Demo' },
    });
  });

  it('409 kèm setupRunId (đã có lần gỡ dở) → mở lần đó', async () => {
    server({
      extra: {
        [`POST ${PLUGIN}/setup-runs`]: {
          status: 409,
          body: { error: 'Đang có lần gỡ project dở', setupRunId: 'run-old' },
        },
      },
    });
    const router = mountProject();
    fireEvent.click(await enabledButton('Gỡ project'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Demo' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gỡ project' }));
    await waitFor(() => expect(router.state.location.search).toBe('?resume=run-old'));
  });

  it('lần gỡ dở (lỗi) → nút Chạy tiếp tới trang tiến độ, không có nút gỡ mới', async () => {
    const failed = {
      ...ADD_RUN,
      id: 'run-rm',
      kind: 'remove-project',
      status: 'failed',
      input: { projectId: P, projectName: 'Demo' },
      updatedAt: '2026-10-10T00:00:00.000Z',
    };
    server({ runs: [ADD_RUN, failed] });
    mountProject();
    const link = await screen.findByRole('link', { name: 'Chạy tiếp gỡ project' });
    expect(link.getAttribute('href')).toBe('/TPS/projects/remove?resume=run-rm');
    expect(screen.queryByRole('button', { name: 'Gỡ project' })).toBeNull();
  });

  it('không suy được khóa project → nút tắt kèm lý do', async () => {
    server({ runs: [], extra: { [`GET ${PLUGIN}/projects/${P}/roles`]: { body: { roles: null } } } });
    mountProject();
    expect(await screen.findByText(/Không suy ra được khóa project/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Gỡ project' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

const mountAgent = (a: { id: string; name: string; status: string }) =>
  renderPage(<RemoveAgentButton agent={a} />, { route: 'agents/:id', at: `/TPS/agents/${a.id}` });

describe('RemoveAgentButton', () => {
  it('reviewer → nút tắt kèm lý do và lối Đổi vai trò / Gỡ cả project', async () => {
    server();
    mountAgent({ id: ID.reviewer, name: 'demo-reviewer', status: 'idle' });
    expect(await screen.findByText(/đang là reviewer của Demo/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Gỡ agent' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Đổi vai trò' }).getAttribute('href')).toBe(`/TPS/projects/${P}?tab=roles`);
    expect(screen.getByRole('link', { name: 'Gỡ cả project' }).getAttribute('href')).toBe(`/TPS/projects/${P}`);
  });

  it('executor duy nhất → nút tắt', async () => {
    server({ extra: { [`GET ${PLUGIN}/projects/${P}/roles`]: { body: { roles: roles([ID.executor]) } } } });
    mountAgent({ id: ID.executor, name: 'demo-executor', status: 'running' });
    expect(await screen.findByText(/executor duy nhất của Demo/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Gỡ agent' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('agent terminated → không có nút', async () => {
    server();
    mountAgent({ id: ID.spare, name: 'le', status: 'terminated' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gỡ agent' })).toBeNull());
  });

  it('executor-2 → hộp xác nhận hiện vai trò, checkout; gõ tên rồi tạo setup run remove-agent', async () => {
    const { calls } = server({
      extra: {
        [`POST ${PLUGIN}/setup-runs`]: { status: 201, body: { ...ADD_RUN, id: 'run-ra', kind: 'remove-agent' } },
      },
    });
    const router = mountAgent({ id: ID.executor2, name: 'demo-executor-2', status: 'idle' });
    fireEvent.click(await enabledButton('Gỡ agent'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Executor thứ 2 của Demo/)).toBeTruthy();
    expect(within(dialog).getByText('/Users/owner/crew-agents/demo/executor-2 · sạch, sẽ gỡ')).toBeTruthy();
    expect(await within(dialog).findByText('0 run đang chạy: sẽ dừng.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'demo-executor-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gỡ agent' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/agents/remove'));
    expect(router.state.location.search).toBe('?resume=run-ra');
    const create = calls.find((c) => c.method === 'POST' && c.url === `${PLUGIN}/setup-runs`);
    expect(create?.body).toEqual({
      companyId: 'c-tps',
      kind: 'remove-agent',
      projectKey: 'demo',
      machineId: M1,
      input: { agentId: ID.executor2, agentName: 'demo-executor-2', projectId: P, role: 'executor-2' },
    });
    const issues = calls.find((c) => c.url.startsWith('/api/companies/c-tps/issues'));
    expect(issues?.url).toContain(`assigneeAgentId=${ID.executor2}`);
  });

  it('agent không giữ vai trò → khóa run agent-<8 hex>, input projectId/role null', async () => {
    const { calls } = server({
      extra: {
        [`POST ${PLUGIN}/setup-runs`]: { status: 201, body: { ...ADD_RUN, id: 'run-ra', kind: 'remove-agent' } },
      },
    });
    mountAgent({ id: ID.spare, name: 'le', status: 'idle' });
    fireEvent.click(await enabledButton('Gỡ agent'));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByText('1 run đang chạy: sẽ dừng.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'le' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gỡ agent' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === `${PLUGIN}/setup-runs`)).toBe(true));
    const create = calls.find((c) => c.method === 'POST' && c.url === `${PLUGIN}/setup-runs`);
    expect(create?.body).toMatchObject({
      kind: 'remove-agent',
      projectKey: `agent-${ID.spare.slice(0, 8)}`,
      input: { agentId: ID.spare, agentName: 'le', projectId: null, role: null },
    });
  });

  it('agent đã gỡ (lần gỡ xong, còn paused) → không có nút', async () => {
    const done = {
      ...ADD_RUN,
      id: 'run-ra',
      kind: 'remove-agent',
      projectId: null,
      input: { agentId: ID.spare, agentName: 'le', projectId: null, role: null },
      status: 'done',
    };
    server({ runs: [done] });
    mountAgent({ id: ID.spare, name: 'le', status: 'paused' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gỡ agent' })).toBeNull());
  });
});

describe('RemoveProjectPage', () => {
  it('lần gỡ xong có checkout bị giữ → cảnh báo kèm đường dẫn và lệnh tự gỡ', async () => {
    const run = {
      ...ADD_RUN,
      id: 'run-rm',
      kind: 'remove-project',
      input: { projectId: P, projectName: 'Demo' },
      status: 'done',
      steps: {
        'pause-agents': { status: 'done', at: 'x' },
        roles: { status: 'done', at: 'x' },
        environments: { status: 'done', at: 'x' },
        checkouts: {
          status: 'done',
          at: 'x',
          refs: { kept_executor: 'dirty', keptPath_executor: '/Users/owner/crew-agents/demo/executor' },
        },
        project: { status: 'done', at: 'x' },
      },
    };
    server({ extra: { [`GET ${PLUGIN}/setup-runs/run-rm`]: { body: run } } });
    renderPage(<RemoveProjectPage />, { route: 'projects/remove', at: '/TPS/projects/remove?resume=run-rm' });
    expect(await screen.findByText('Đã gỡ project.')).toBeTruthy();
    expect(screen.getByText('Máy giữ lại 1 checkout')).toBeTruthy();
    expect(screen.getByText(/Executor: có việc chưa commit/)).toBeTruthy();
    expect(
      screen.getByText(
        'git -C "/Users/owner/crew-agents/demo/executor" worktree remove "/Users/owner/crew-agents/demo/executor"',
      ),
    ).toBeTruthy();
  });
});
