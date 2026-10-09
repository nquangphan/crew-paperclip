// Api giả cho wizard thêm project và tạo agent: giữ trạng thái trong bộ nhớ, ghi lại mọi lời gọi (tên hàm + tham số).
import {
  ApiError,
  type JobPayload,
  type JobResult,
  type MachineJob,
  type ProjectRoles,
  type SetupRun,
  type SetupStepId,
} from '@/api';
import { ADD_AGENT_STEPS } from '@/features/wizards/add-agent/steps';
import { ADD_PROJECT_STEPS } from '@/features/wizards/add-project/steps';

export const PIN = '/Users/owner/.crew/workflows/superpowers/5.0.7';
export const COMPANY = 'c-run';

export interface FakeAgent {
  id: string;
  name: string;
  status: string;
  defaultEnvironmentId: string | null;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface Call {
  fn: string;
  args: unknown[];
}

let seq = 0;
const PREFIX: Record<string, string> = { job: '0b', proj: '0c', env: '0e', agent: '0a' };
/** uuid thật (hex) để render AGENTS.md nhận; tiền tố cho dễ đọc khi test đỏ. */
const uuid = (kind: string) => {
  seq += 1;
  return `${PREFIX[kind]}000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

export function addProjectRun(over: Partial<SetupRun> = {}): SetupRun {
  return {
    id: 'run-1',
    companyId: COMPANY,
    kind: 'add-project',
    projectKey: 'demo',
    projectId: null,
    machineId: 'm1',
    input: { name: 'Demo', key: 'demo', folder: '/Users/owner/code/demo', executors: 1 },
    steps: {},
    status: 'running',
    runningStep: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...over,
  };
}

export const TEMPLATE_ENV = {
  id: 'env-template',
  name: 'mac-mini',
  description: null,
  driver: 'ssh',
  status: 'active',
  config: {
    host: 'mac.local',
    port: 2222,
    username: 'owner',
    remoteWorkspacePath: '/Users/owner/crew-agents/old/assistant',
    privateKeySecretRef: { type: 'secret_ref', secretId: 'sec-1', version: 'latest' },
    knownHosts: 'mac.local ssh-ed25519 AAAA',
    strictHostKeyChecking: true,
  },
  envVars: {},
  metadata: { workspaceRealizationMode: 'in_place', crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 30 } },
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

export type JobOutcome = (payload: JobPayload) => Partial<MachineJob>;

const defaultOutcome: JobOutcome = (payload) => {
  let result: JobResult;
  if (payload.kind === 'inspect-folder') {
    result = {
      kind: 'inspect-folder',
      root: payload.folder,
      branch: 'main',
      remote: null,
      docsBundle: null,
      clean: true,
    };
  } else if (payload.kind === 'prepare-checkouts') {
    result = {
      kind: 'prepare-checkouts',
      checkouts: payload.roles.map((r) => ({
        role: r.role,
        path: `/Users/owner/crew-agents/${payload.projectKey}/${r.role}`,
        head: 'a'.repeat(40),
      })),
    };
  } else if (payload.kind === 'agent-workspace') {
    result = {
      kind: 'agent-workspace',
      role: payload.role,
      path: `/Users/owner/crew-agents/${payload.projectKey}/${payload.role}`,
      head: 'b'.repeat(40),
    };
  } else if (payload.kind === 'check') {
    result = { kind: 'check', items: [{ id: 'doctor', status: 'ok', title: 'Máy ổn' }] };
  } else {
    throw new Error(`job ${payload.kind} không dùng trong wizard`);
  }
  return { status: 'done', result };
};

export function fakeApi(opts: { run?: SetupRun; busy?: boolean; jobOutcome?: JobOutcome } = {}) {
  const calls: Call[] = [];
  const failures = new Map<string, (n: number) => Error | null>();
  const counts = new Map<string, number>();
  const state = {
    run: structuredClone(opts.run ?? addProjectRun()),
    jobs: [] as MachineJob[],
    projects: [] as { id: string; name: string; urlKey: string; createdAt: string; archivedAt: null }[],
    environments: [structuredClone(TEMPLATE_ENV)] as Record<string, unknown>[],
    agents: [] as FakeAgent[],
    files: new Map<string, { content: string; contentHash: string }>(),
    roles: null as ProjectRoles | null,
    busy: opts.busy ?? false,
  };

  /** Ghi lời gọi; lỗi tiêm cho lần gọi thứ n (đếm từ 1) thì ném. */
  const record = (fn: string, ...args: unknown[]) => {
    calls.push({ fn, args });
    const n = (counts.get(fn) ?? 0) + 1;
    counts.set(fn, n);
    const err = failures.get(fn)?.(n);
    if (err) throw err;
  };

  const api = {
    setup: {
      begin: async (companyId: string, id: string, stepId: SetupStepId) => {
        record('setup.begin', companyId, id, stepId);
        if (state.busy) throw new ApiError(409, `Bước ${stepId} đang chạy`);
        if (state.run.status === 'done') throw new ApiError(409, 'Lần cài đặt đã xong');
        state.run = { ...state.run, status: 'running', runningStep: stepId };
        return structuredClone(state.run);
      },
      finish: async (
        companyId: string,
        id: string,
        stepId: SetupStepId,
        body: { status: 'done' | 'failed'; refs?: Record<string, string>; error?: string; projectId?: string },
      ) => {
        record('setup.finish', companyId, id, stepId, structuredClone(body));
        if (state.run.runningStep !== stepId) throw new ApiError(409, `Bước ${stepId} không đang chạy`);
        const order: readonly string[] = state.run.kind === 'add-agent' ? ADD_AGENT_STEPS : ADD_PROJECT_STEPS;
        const last = order[order.length - 1] === stepId;
        state.run = {
          ...state.run,
          runningStep: null,
          projectId: body.projectId ?? state.run.projectId,
          status: body.status === 'failed' ? 'failed' : last ? 'done' : state.run.status,
          steps: {
            ...state.run.steps,
            [stepId]: {
              status: body.status,
              at: '2026-10-10T00:00:01.000Z',
              ...(body.refs ? { refs: body.refs } : {}),
              ...(body.error ? { error: body.error } : {}),
            },
          },
        };
        return structuredClone(state.run);
      },
    },
    jobs: {
      create: async (body: {
        companyId: string;
        machineId: string;
        kind: JobPayload['kind'];
        payload: JobPayload;
        setupRunId?: string;
      }) => {
        record('jobs.create', structuredClone(body));
        const job: MachineJob = {
          id: uuid('job'),
          companyId: body.companyId,
          machineId: body.machineId,
          kind: body.kind,
          payload: body.payload,
          status: 'queued',
          result: null,
          errorCode: null,
          errorText: null,
          attempts: 0,
          setupRunId: body.setupRunId ?? null,
          createdAt: new Date().toISOString(),
          claimedAt: null,
          finishedAt: null,
          ...(opts.jobOutcome ?? defaultOutcome)(body.payload),
        };
        state.jobs.unshift(job);
        return structuredClone({ ...job, status: 'queued' as const, result: null });
      },
      list: async (companyId: string, query: Record<string, unknown> = {}) => {
        record('jobs.list', companyId, query);
        return structuredClone(state.jobs.filter((j) => !query.setupRunId || j.setupRunId === query.setupRunId));
      },
    },
    projects: {
      list: async (companyId: string) => {
        record('projects.list', companyId);
        return structuredClone(state.projects);
      },
      create: async (companyId: string, body: Record<string, unknown>) => {
        record('projects.create', companyId, body);
        const project = {
          id: uuid('proj'),
          name: String(body.name),
          urlKey: String(body.name).toLowerCase(),
          createdAt: new Date().toISOString(),
          archivedAt: null,
        };
        state.projects.push(project);
        return structuredClone(project);
      },
    },
    environments: {
      list: async (companyId: string) => {
        record('environments.list', companyId);
        return structuredClone(state.environments);
      },
      create: async (companyId: string, body: Record<string, unknown>) => {
        record('environments.create', companyId, structuredClone(body));
        const env = { ...body, id: uuid('env'), status: 'active', createdAt: new Date().toISOString() };
        state.environments.push(env);
        return structuredClone(env);
      },
    },
    agents: {
      list: async (companyId: string) => {
        record('agents.list', companyId);
        return structuredClone(state.agents);
      },
      create: async (companyId: string, body: Record<string, unknown>) => {
        record('agents.create', companyId, structuredClone(body));
        const agent: FakeAgent = {
          id: uuid('agent'),
          name: String(body.name),
          status: 'idle',
          defaultEnvironmentId: (body.defaultEnvironmentId as string) ?? null,
          adapterType: String(body.adapterType),
          adapterConfig: structuredClone(body.adapterConfig as Record<string, unknown>),
          runtimeConfig: structuredClone(body.runtimeConfig as Record<string, unknown>),
          createdAt: new Date().toISOString(),
        };
        state.agents.push(agent);
        return structuredClone(agent);
      },
      get: async (id: string, companyId?: string) => {
        record('agents.get', id, companyId);
        const agent = state.agents.find((a) => a.id === id);
        if (!agent) throw new ApiError(404, 'Agent not found');
        return structuredClone(agent);
      },
      /** PATCH merge như server: adapterConfig gộp nông, trường khác thay. */
      update: async (id: string, body: Record<string, unknown>, companyId?: string) => {
        record('agents.update', id, structuredClone(body), companyId);
        const agent = state.agents.find((a) => a.id === id);
        if (!agent) throw new ApiError(404, 'Agent not found');
        const { adapterConfig, ...rest } = structuredClone(body);
        Object.assign(agent, rest);
        if (adapterConfig) agent.adapterConfig = { ...agent.adapterConfig, ...(adapterConfig as object) };
        return structuredClone(agent);
      },
      pause: async (id: string, companyId?: string) => {
        record('agents.pause', id, companyId);
        const agent = state.agents.find((a) => a.id === id);
        if (agent) agent.status = 'paused';
        return structuredClone(agent);
      },
      resume: async (id: string, companyId?: string) => {
        record('agents.resume', id, companyId);
        const agent = state.agents.find((a) => a.id === id);
        if (agent) agent.status = 'idle';
        return structuredClone(agent);
      },
      setPermissions: async (id: string, body: Record<string, unknown>, companyId?: string) => {
        record('agents.setPermissions', id, body, companyId);
        return {};
      },
      instructionsFile: async (id: string, path?: string, companyId?: string) => {
        record('agents.instructionsFile', id, path, companyId);
        const file = state.files.get(id);
        if (!file) throw new ApiError(404, 'File not found');
        return structuredClone(file);
      },
      saveInstructionsFile: async (
        id: string,
        body: { path: string; content: string; baseHash?: string | null },
        companyId?: string,
      ) => {
        record('agents.saveInstructionsFile', id, structuredClone(body), companyId);
        const saved = { content: body.content, contentHash: `hash-${id}` };
        state.files.set(id, saved);
        return structuredClone(saved);
      },
    },
    roles: {
      get: async (companyId: string, projectId: string) => {
        record('roles.get', companyId, projectId);
        return structuredClone(state.roles);
      },
      set: async (companyId: string, projectId: string, roles: unknown) => {
        record('roles.set', companyId, projectId, structuredClone(roles));
        state.roles = roles as ProjectRoles;
        return structuredClone(roles);
      },
    },
    crew: {
      machines: async (companyId: string) => {
        record('crew.machines', companyId);
        return [{ machineId: 'm1', hostname: 'mac-mini', latest: { superpowers: { pinned: '5.0.7', pinDir: PIN } } }];
      },
    },
  };

  return {
    api,
    calls,
    state,
    /** Lời gọi thứ n (từ 1) của `fn` ném `error`. */
    failOn(fn: string, n: number, error: Error) {
      failures.set(fn, (i) => (i === n ? error : null));
    },
    clearFailures() {
      failures.clear();
    },
    names: () => calls.map((c) => c.fn),
  };
}
