// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadProjectReadiness, type ReadinessSource } from '@/features/readiness';
import { AddAgentPage } from '@/features/wizards/add-agent/add-agent-page';
import { initI18n, setLanguage } from '@/i18n';
import { crewAgentCreateBody } from '@/lib/instructions';
import { mockServer } from '../../app/fetch-mock';
import { data, ID, ROLES, renderPage } from '../projects/helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const PLUGIN = '/api/plugins/crew.core/api';
const PIN = '/Users/owner/.crew/workflows/superpowers/5.0.7';
const MACHINES = [
  {
    machineId: 'm1',
    hostname: 'mac-mini',
    online: true,
    latest: { superpowers: { pinned: '5.0.7', pinDir: PIN }, checkouts: [] },
  },
];
const PROJECT_RUN = {
  id: 'run-p',
  companyId: 'c-tps',
  kind: 'add-project',
  projectKey: 'demo',
  projectId: 'p1',
  machineId: 'm1',
  input: { name: 'Demo', key: 'demo', folder: '/Users/owner/code/demo', executors: 1 },
  steps: { inspect: { status: 'done', at: 'x', refs: { root: '/Users/owner/code/demo-root' } } },
  status: 'done',
  runningStep: null,
  createdAt: 'x',
  updatedAt: 'x',
};
const agent = (id: string, name: string, role: 'assistant' | 'executor' | 'reviewer' | 'integrator') => ({
  ...crewAgentCreateBody({ name, role, model: 'claude-sonnet-5', pinDir: PIN }),
  id,
  status: 'idle',
  defaultEnvironmentId: `env-${name}`,
  createdAt: '2026-10-01T00:00:00.000Z',
});
const AGENTS = [
  agent(ID.assistant, 'demo-assistant', 'assistant'),
  agent(ID.executor, 'demo-executor', 'executor'),
  agent(ID.reviewer, 'demo-reviewer', 'reviewer'),
  agent(ID.integrator, 'demo-integrator', 'integrator'),
];
const AGENT_RUN = {
  ...PROJECT_RUN,
  id: 'run-a',
  kind: 'add-agent',
  input: { projectId: 'p1', slot: 'executor-2', name: 'demo-executor-2', model: 'claude-sonnet-5' },
  steps: {
    agent: { status: 'done', at: 'x', refs: { agent: ID.spare, created: 'true', folder: '/Users/owner/code/demo' } },
    pin: { status: 'done', at: 'x', refs: { instructions: 'h' } },
    environment: { status: 'done', at: 'x', refs: { environment: 'env-x', checkout: '/c' } },
    workspace: { status: 'failed', at: 'x', error: 'Lệnh git trên máy lỗi: worktree add' },
  },
  status: 'failed',
};

const FIX_RUN = {
  ...AGENT_RUN,
  input: { ...AGENT_RUN.input, slot: 'executor', name: 'demo-executor' },
  steps: { agent: { status: 'done', at: 'x', refs: { agent: ID.executor, folder: '/Users/owner/code/demo-root' } } },
  status: 'running',
};

function server(extra: Record<string, unknown> = {}, runs: unknown[] = [PROJECT_RUN]) {
  return mockServer({
    'GET /api/companies/c-tps/projects': {
      body: [
        { id: 'p1', name: 'Demo', urlKey: 'demo', archivedAt: null },
        { id: 'p2', name: 'Chưa có vai trò', urlKey: 'khac', archivedAt: null },
      ],
    },
    'GET /api/companies/c-tps/agents': { body: AGENTS },
    'GET /api/companies/c-tps/environments': { body: [] },
    [`GET ${PLUGIN}/projects/p1/roles`]: { body: { roles: ROLES } },
    [`GET ${PLUGIN}/projects/p2/roles`]: { body: { roles: null } },
    ...data('crew.machines', MACHINES),
    ...data('crew.setupRuns', runs),
    ...(extra as Record<string, { body: unknown }>),
  });
}

const mount = (at: string) => renderPage(<AddAgentPage />, { route: 'agents/new', at });
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('AddAgentPage', () => {
  it('?project=&slot= điền sẵn khóa, folder, máy từ lần thêm project; Bắt đầu tạo setup run add-agent rồi chạy', async () => {
    const { calls } = server({
      [`POST ${PLUGIN}/setup-runs`]: { status: 201, body: { ...AGENT_RUN, steps: {}, status: 'running' } },
      [`GET ${PLUGIN}/setup-runs/run-a`]: { body: { ...AGENT_RUN, steps: {}, status: 'running' } },
      [`POST ${PLUGIN}/setup-runs/run-a/steps/agent/begin`]: { status: 409, body: { error: 'Bước agent đang chạy' } },
    });
    const router = mount('/TPS/agents/new?project=p1&slot=executor-2');

    await waitFor(() => expect(field('Khóa project').value).toBe('demo'));
    // Khóa lấy từ project: không sửa tay được (checkout và job dựng theo khóa này).
    expect(field('Khóa project').readOnly).toBe(true);
    expect(field('Folder repo trên máy').value).toBe('/Users/owner/code/demo-root');
    expect(field('Tên agent').value).toBe('demo-executor-2');
    // Ô đang trống: thêm mới; project chưa có dòng vai trò thì không chọn được.
    expect(screen.getByText('Thêm agent vào ô này.')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Project' }), { key: 'Enter' });
    expect((await screen.findByRole('option', { name: /Chưa có vai trò/ })).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(screen.getByRole('option', { name: 'Demo' }), { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    await waitFor(() => expect(router.state.location.search).toBe('?resume=run-a'));
    expect(calls.find((c) => c.method === 'POST' && c.url === `${PLUGIN}/setup-runs`)?.body).toEqual({
      companyId: 'c-tps',
      kind: 'add-agent',
      projectKey: 'demo',
      machineId: 'm1',
      input: { projectId: 'p1', slot: 'executor-2', name: 'demo-executor-2', model: 'claude-sonnet-5' },
    });
    expect(await screen.findByText('Đang có người chạy bước này. Đợi một lát rồi bấm Chạy tiếp.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/agents'))).toBe(false);
  });

  it('ô executor Codex: danh sách model Codex, mặc định gpt-6-luna, setup run mang ô và model', async () => {
    const { calls } = server({
      [`POST ${PLUGIN}/setup-runs`]: { status: 201, body: { ...AGENT_RUN, steps: {}, status: 'running' } },
      [`GET ${PLUGIN}/setup-runs/run-a`]: { body: { ...AGENT_RUN, steps: {}, status: 'running' } },
      [`POST ${PLUGIN}/setup-runs/run-a/steps/agent/begin`]: { status: 409, body: { error: 'Bước agent đang chạy' } },
    });
    const router = mount('/TPS/agents/new?project=p1&slot=executor-codex');
    await waitFor(() => expect(field('Tên agent').value).toBe('demo-executor-codex'));
    expect(screen.getByText('Model mặc định của agent, trong danh sách model của runtime codex_local.')).toBeTruthy();
    expect(
      screen.getByText(
        'Thêm agent vào ô này. Agent chạy runtime codex_local trên máy. Bật runtime ở trang Máy trước khi giao việc.',
      ),
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model' }), { key: 'Enter' });
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    fireEvent.keyDown(screen.getByRole('option', { name: 'gpt-6-luna' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    await waitFor(() => expect(router.state.location.search).toBe('?resume=run-a'));
    expect(calls.find((c) => c.method === 'POST' && c.url === `${PLUGIN}/setup-runs`)?.body).toMatchObject({
      input: { projectId: 'p1', slot: 'executor-codex', name: 'demo-executor-codex', model: 'gpt-6-luna' },
    });
  });

  it('ô reviewer Codex: model cố định gpt-6-sol, không chọn được model khác', async () => {
    server();
    mount('/TPS/agents/new?project=p1&slot=reviewer-codex');
    await waitFor(() => expect(field('Tên agent').value).toBe('demo-reviewer-codex'));
    expect(screen.getByText('Reviewer Codex chạy model cố định gpt-6-sol, effort high.')).toBeTruthy();
    const model = screen.getByRole('combobox', { name: 'Model' });
    expect(model.textContent).toContain('gpt-6-sol');
    expect((model as HTMLButtonElement).disabled).toBe(true);
  });

  it('danh sách ô có ba ô runtime', async () => {
    server();
    mount('/TPS/agents/new?project=p1');
    await waitFor(() => expect(field('Khóa project').value).toBe('demo'));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Ô vai trò' }), { key: 'Enter' });
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual([
      'Trợ Lý',
      'Executor',
      'Executor thứ 2',
      'Reviewer',
      'Integrator',
      'Executor Codex',
      'Executor OpenCode',
      'Reviewer Codex',
    ]);
  });

  it('chọn ô đang có agent: báo sẽ thay; tên trùng agent đang có thì chặn, không tạo setup run', async () => {
    const { calls } = server();
    mount('/TPS/agents/new?project=p1&slot=reviewer');
    await waitFor(() => expect(field('Khóa project').value).toBe('demo'));
    expect(screen.getByText('Thay demo-reviewer. Agent cũ giữ nguyên, chỉ rời vai trò.')).toBeTruthy();
    fireEvent.change(field('Tên agent'), { target: { value: 'demo-reviewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    expect(await screen.findByText('Đã có agent tên này')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url.startsWith(`${PLUGIN}/setup-runs`))).toBe(false);
  });

  it('project không suy được khóa (không có lần thêm project, không có checkout) thì cho nhập khóa', async () => {
    server(
      {
        'GET /api/companies/c-tps/projects': { body: [{ id: 'p3', name: 'Cũ', urlKey: 'cu', archivedAt: null }] },
        [`GET ${PLUGIN}/projects/p3/roles`]: { body: { roles: ROLES } },
      },
      [],
    );
    mount('/TPS/agents/new?project=p3&slot=executor-2');
    await waitFor(() => expect(field('Tên agent')).toBeTruthy());
    expect(field('Khóa project').readOnly).toBe(false);
    fireEvent.change(field('Khóa project'), { target: { value: 'cu' } });
    expect(field('Khóa project').value).toBe('cu');
  });

  it('?fix= có lần tạo agent dở của agent đó → chuyển sang chạy tiếp lần đó', async () => {
    server({ [`GET ${PLUGIN}/setup-runs/run-a`]: { body: AGENT_RUN } }, [PROJECT_RUN, AGENT_RUN]);
    const router = mount(`/TPS/agents/new?fix=${ID.spare}&step=workspace`);
    await waitFor(() => expect(router.state.location.search).toBe('?resume=run-a'));
  });

  it('?fix= agent do app tạo: ô và project lấy từ vai trò, bỏ các bước trước bước cần sửa rồi chạy', async () => {
    const { calls } = server({
      [`POST ${PLUGIN}/setup-runs`]: {
        status: 201,
        body: { ...AGENT_RUN, input: { ...AGENT_RUN.input, slot: 'executor' }, steps: {}, status: 'running' },
      },
      [`POST ${PLUGIN}/setup-runs/run-a/steps/agent/begin`]: {
        body: { ...FIX_RUN, steps: {}, runningStep: 'agent', lockToken: '0f000000-0000-4000-8000-000000000001' },
      },
      [`POST ${PLUGIN}/setup-runs/run-a/steps/agent/finish`]: { body: FIX_RUN },
      [`GET ${PLUGIN}/setup-runs/run-a`]: { body: FIX_RUN },
      [`POST ${PLUGIN}/setup-runs/run-a/steps/pin/begin`]: { status: 409, body: { error: 'Bước pin đang chạy' } },
    });
    const router = mount(`/TPS/agents/new?fix=${ID.executor}&step=pin&rewrite=1`);
    expect(await screen.findByText(/Sửa agent demo-executor từ bước “Ghim Superpowers và AGENTS.md”/)).toBeTruthy();
    await waitFor(() => expect(field('Khóa project').value).toBe('demo'));
    expect(screen.queryByLabelText('Tên agent')).toBeNull();
    // Agent đang giữ ô: project và ô cố định (đổi sang ô khác thì một agent nằm hai ô).
    expect((screen.getByRole('combobox', { name: 'Project' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Ô vai trò' }) as HTMLButtonElement).disabled).toBe(true);
    expect(field('Khóa project').readOnly).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Sửa tiếp' }));
    await waitFor(() => expect(router.state.location.search).toBe('?resume=run-a'));
    expect(calls.find((c) => c.method === 'POST' && c.url === `${PLUGIN}/setup-runs`)?.body).toMatchObject({
      kind: 'add-agent',
      projectKey: 'demo',
      input: { projectId: 'p1', slot: 'executor', name: 'demo-executor', model: 'claude-sonnet-5' },
    });
    expect(calls.find((c) => c.url === `${PLUGIN}/setup-runs/run-a/steps/agent/finish`)?.body).toEqual({
      companyId: 'c-tps',
      status: 'done',
      refs: { agent: ID.executor, folder: '/Users/owner/code/demo-root', rewrite: 'true' },
      lockToken: '0f000000-0000-4000-8000-000000000001',
    });
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/companies/c-tps/agents'))).toBe(false);
  });

  it('?resume= hiện 6 bước, bước lỗi kèm lỗi và nút Chạy tiếp', async () => {
    server({ [`GET ${PLUGIN}/setup-runs/run-a`]: { body: AGENT_RUN } });
    mount('/TPS/agents/new?resume=run-a');
    const list = await screen.findByRole('list');
    const item = (title: string) => within(list).getByText(title).closest('li') as HTMLElement;
    await waitFor(() => expect(item('Tạo agent').dataset.state).toBe('done'));
    expect(item('Ghim Superpowers và AGENTS.md').dataset.state).toBe('done');
    expect(item('Environment SSH').dataset.state).toBe('done');
    expect(item('Dựng checkout trên máy').dataset.state).toBe('failed');
    expect(item('Ghi vai trò').dataset.state).toBe('pending');
    expect(item('Cập nhật AGENTS.md của Trợ Lý').dataset.state).toBe('pending');
    expect(screen.getByRole('alert').textContent).toContain('worktree add');
    expect(screen.getByRole('button', { name: 'Chạy tiếp' })).toBeTruthy();
  });
});

describe('agent dở không được chọn làm người nhận (S13.7)', () => {
  it('vai trò trỏ agent của lần tạo agent lỗi ở bước checkout → project not_ready, agent not_ready', async () => {
    const fresh = {
      ...agent(ID.spare, 'demo-executor-2', 'executor'),
      status: 'paused',
      defaultEnvironmentId: 'env-x',
    };
    const roles = { ...ROLES, executorAgentIds: [ID.executor, ID.spare] };
    const env = (id: string, path: string) => ({
      id,
      driver: 'ssh',
      status: 'active',
      config: { remoteWorkspacePath: path },
      metadata: { workspaceRealizationMode: 'in_place' },
    });
    const source: ReadinessSource = {
      agents: {
        list: async () => [...AGENTS, fresh] as never,
        instructionsFile: async () => ({ content: 'x', contentHash: 'h' }),
      },
      environments: {
        list: async () => [
          ...AGENTS.map((a) => env(a.defaultEnvironmentId, `/Users/owner/crew-agents/demo/${a.name.slice(5)}`)),
          env('env-x', '/c'),
        ],
      },
      projects: { list: async () => [{ id: 'p1', archivedAt: null }] },
      issues: { list: async () => [] },
      roles: { get: async () => roles },
      crew: {
        machines: async () => [
          {
            machineId: 'm1',
            latest: {
              superpowers: { pinned: '5.0.7', pinDir: PIN },
              checkouts: ['assistant', 'executor', 'reviewer', 'integrator'].map((r) => ({
                path: `/Users/owner/crew-agents/demo/${r}`,
              })),
            },
          },
        ],
        setupRuns: async () => [AGENT_RUN as never],
        roots: async () => [],
      },
    };
    const [project] = await loadProjectReadiness(source, 'c-tps');
    expect(project?.state).toBe('not_ready');
    expect(project?.failed[0]?.agentIds).toEqual([ID.spare]);
    const spare = project?.agents.find((a) => a.agentId === ID.spare);
    expect(spare?.state).toBe('not_ready');
    expect(spare?.failed.map((f) => f.id)).toContain('A5');
    expect(project?.agents.filter((a) => a.agentId !== ID.spare).every((a) => a.state === 'ready')).toBe(true);
  });
});
