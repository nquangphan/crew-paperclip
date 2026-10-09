// Trạng thái sẵn sàng của agent và project Crew, tính thuần ở web (plugin không đọc được bảng environments).
// Bảng kiểm A1–A7 theo spec R3 mục 4.8; áp cho cả agent do wizard web tạo lẫn agent do app Mac tạo.
import { crewExtraArgs, SUPERPOWERS_PIN_RE, WRAPPER_RE } from '@/lib/instructions';

export type AgentCheckId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7';
export type ProjectCheckId = 'P1' | 'P2';

/** Bước wizard để "Làm tiếp" (cùng tên bước với tiến độ wizard của plugin). */
export type ReadinessStep = 'agent' | 'pin' | 'environment' | 'workspace' | 'role';
export type ResumeTarget =
  | { wizard: 'add-agent'; step: ReadinessStep; agentId: string }
  | { wizard: 'add-project'; setupRunId: string }
  | { none: true };

/** `detail` là khóa dịch trong namespace `readiness`. */
export interface AgentCheckFailure {
  id: AgentCheckId;
  detail: string;
  resume: ResumeTarget;
}
export interface AgentReadiness {
  agentId: string;
  state: 'ready' | 'paused' | 'not_ready' | 'terminated';
  failed: AgentCheckFailure[];
}
export interface ProjectCheckFailure {
  id: ProjectCheckId;
  detail: string;
  /** P2: agent trong vai trò chưa sẵn sàng hoặc không còn. */
  agentIds?: string[];
}
export interface ProjectReadiness {
  projectId: string;
  state: 'ready' | 'not_ready' | 'untracked';
  failed: ProjectCheckFailure[];
  agents: AgentReadiness[];
}

// Kiểu đầu vào chỉ giữ trường cần đọc, để nhận cả Agent/Environment của REST lẫn dữ liệu plugin.
export interface ReadinessAgent {
  id: string;
  status: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown> | null;
  defaultEnvironmentId?: string | null;
}
export interface ReadinessEnvironment {
  id: string;
  driver: string;
  status: string;
  config: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}
/** Bản tin máy mới nhất (`crew.machines` → `latest`); các key mới là tùy chọn vì crew-mac bản cũ không gửi. */
export interface ReadinessReport {
  superpowers?: { pinned: string | null; pinDir?: string | null } | null;
  checkouts?: { path: string; head?: string | null; clean?: boolean | null }[] | null;
}
export interface ReadinessSetupRun {
  id: string;
  kind: 'add-project' | 'add-agent';
  status: 'running' | 'failed' | 'done';
  steps: Partial<Record<string, { status: string; refs?: Record<string, string> } | undefined>>;
}
export interface ReadinessProjectRoles {
  assistantAgentId: string;
  executorAgentIds: string[];
  reviewerAgentId: string;
  integratorAgentId: string;
}

export interface AgentReadinessInput {
  agent: ReadinessAgent;
  /** Environment theo `defaultEnvironmentId`; null khi agent không có hoặc không tìm thấy. */
  environment: ReadinessEnvironment | null;
  /** Bản tin mới nhất của máy chạy agent; null khi chưa có bản tin nào. */
  report: ReadinessReport | null;
  /** Ô vai trò agent đang giữ (`assistant`, `executor-2`, …, `file` cho vai trò trong file); null nếu không giữ. */
  roleOf: string | null;
  /** Setup run gần nhất đã tạo agent này; null với agent do app tạo. */
  setupRun: ReadinessSetupRun | null;
  /** `contentHash` của AGENTS.md hiện tại; null khi agent chưa có file. */
  instructionsHash: string | null;
  /** AGENTS.md hiện tại đúng là bản render từ template với executor của project (Trợ Lý sau khi sửa vai trò). */
  instructionsRendered?: boolean;
}

const RESUME_STEP: Record<Exclude<AgentCheckId, 'A7'>, ReadinessStep> = {
  A1: 'agent',
  A2: 'pin',
  A3: 'pin',
  A4: 'environment',
  A5: 'workspace',
  A6: 'role',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Refs của agent trong setup run: khóa `agent_<ô>` (add-project) hoặc `agent` (add-agent) mang id agent. */
function agentRefs(run: ReadinessSetupRun | null, agentId: string): { instructions?: string; checkout?: string } {
  if (!run) return {};
  const refs: Record<string, string> = {};
  for (const step of Object.values(run.steps)) Object.assign(refs, step?.refs ?? {});
  const key = Object.keys(refs).find((k) => (k === 'agent' || k.startsWith('agent_')) && refs[k] === agentId);
  if (key === undefined) return {};
  const suffix = key.slice('agent'.length);
  return { instructions: refs[`instructions${suffix}`], checkout: refs[`checkout${suffix}`] };
}

/** A1: cấu hình chạy Crew (dùng chung với wizard tạo agent ở chế độ sửa). */
export function checkAdapter(agent: ReadinessAgent): boolean {
  const config = agent.adapterConfig;
  const heartbeat = isRecord(agent.runtimeConfig) ? agent.runtimeConfig.heartbeat : undefined;
  return (
    agent.adapterType === 'claude_local' &&
    config.engine === 'cli' &&
    typeof config.model === 'string' &&
    config.model !== '' &&
    isRecord(config.env) &&
    Object.keys(config.env).length === 0 &&
    isRecord(heartbeat) &&
    heartbeat.enabled === false &&
    heartbeat.maxConcurrentRuns === 1
  );
}

/** A2: wrapper và ghim Superpowers theo bản tin máy. */
export function checkPin(agent: ReadinessAgent, report: ReadinessReport | null): boolean {
  const { command, extraArgs } = agent.adapterConfig;
  if (typeof command !== 'string' || !WRAPPER_RE.test(command)) return false;
  if (!Array.isArray(extraArgs) || extraArgs.length !== 4) return false;
  const pinDir = extraArgs[3];
  if (typeof pinDir !== 'string') return false;
  const home = SUPERPOWERS_PIN_RE.exec(pinDir)?.[1];
  if (!home || command !== `${home}/.crew/bin/crew-claude-run`) return false;
  if (crewExtraArgs(pinDir).some((arg, i) => extraArgs[i] !== arg)) return false;
  // Chưa có bản tin máy thì chỉ kiểm được dạng (A5 đã báo thiếu bản tin).
  if (!report) return true;
  const sp = report.superpowers;
  if (sp?.pinDir) return pinDir === sp.pinDir;
  if (sp?.pinned) return pinDir.endsWith(`/superpowers/${sp.pinned}`);
  return false;
}

/** A4: environment SSH `in_place` trỏ đúng checkout. */
export function checkEnvironment(env: ReadinessEnvironment | null, checkout: string | undefined): boolean {
  if (!env) return false;
  const path = env.config.remoteWorkspacePath;
  return (
    env.status === 'active' &&
    env.driver === 'ssh' &&
    env.metadata?.workspaceRealizationMode === 'in_place' &&
    typeof path === 'string' &&
    path !== '' &&
    (checkout === undefined || path === checkout)
  );
}

export function computeAgentReadiness(input: AgentReadinessInput): AgentReadiness {
  const { agent, environment, report, roleOf, setupRun, instructionsHash, instructionsRendered } = input;
  if (agent.status === 'terminated') {
    return {
      agentId: agent.id,
      state: 'terminated',
      failed: [{ id: 'A7', detail: 'detail.A7', resume: { none: true } }],
    };
  }
  const unfinishedRun = setupRun && setupRun.kind === 'add-project' && setupRun.status !== 'done' ? setupRun : null;
  const resumeFor = (id: Exclude<AgentCheckId, 'A7'>): ResumeTarget =>
    unfinishedRun
      ? { wizard: 'add-project', setupRunId: unfinishedRun.id }
      : { wizard: 'add-agent', step: RESUME_STEP[id], agentId: agent.id };
  const failed: AgentCheckFailure[] = [];
  const fail = (id: Exclude<AgentCheckId, 'A7'>) => failed.push({ id, detail: `detail.${id}`, resume: resumeFor(id) });

  const refs = agentRefs(setupRun, agent.id);
  if (!checkAdapter(agent)) fail('A1');
  if (!checkPin(agent, report)) fail('A2');
  if (
    instructionsHash === null ||
    (refs.instructions !== undefined && refs.instructions !== instructionsHash && !instructionsRendered)
  ) {
    fail('A3');
  }
  if (!checkEnvironment(environment, refs.checkout)) fail('A4');

  const envPath = environment?.config.remoteWorkspacePath;
  const checkout = refs.checkout ?? (typeof envPath === 'string' && envPath !== '' ? envPath : undefined);
  if (!report) {
    failed.push({ id: 'A5', detail: 'detail.noReport', resume: { none: true } });
  } else if (!Array.isArray(report.checkouts)) {
    // crew-mac bản cũ chưa gửi `checkouts`: không biết checkout có trên máy hay không.
    failed.push({ id: 'A5', detail: 'detail.checkoutsUnknown', resume: { none: true } });
  } else if (checkout !== undefined && !report.checkouts.some((c) => c?.path === checkout)) {
    fail('A5');
  }
  // Không biết đường checkout (thiếu environment) thì A4 đã báo; A5 kiểm lại sau khi sửa environment.

  if (roleOf === null) fail('A6');
  failed.sort((a, b) => a.id.localeCompare(b.id));

  if (agent.status === 'pending_approval') {
    failed.push({ id: 'A7', detail: 'detail.A7', resume: { none: true } });
  }
  // `paused` chỉ hiện "Tạm dừng" khi mọi mục khác đạt; agent bị wizard pause giữa chừng vẫn là chưa sẵn sàng.
  const state = failed.length > 0 ? 'not_ready' : agent.status === 'paused' ? 'paused' : 'ready';
  return { agentId: agent.id, state, failed };
}

export function computeProjectReadiness(input: {
  project: { id: string; archivedAt?: string | Date | null };
  roles: ReadinessProjectRoles | null;
  fileRoles: boolean;
  agents: AgentReadiness[];
}): ProjectReadiness {
  const { project, roles, fileRoles, agents } = input;
  if (project.archivedAt) return { projectId: project.id, state: 'untracked', failed: [], agents };
  if (!roles && !fileRoles) {
    return { projectId: project.id, state: 'not_ready', failed: [{ id: 'P1', detail: 'detail.P1' }], agents };
  }
  const byId = new Map(agents.map((a) => [a.agentId, a]));
  const roleIds = roles
    ? [roles.assistantAgentId, ...roles.executorAgentIds, roles.reviewerAgentId, roles.integratorAgentId]
    : agents.map((a) => a.agentId);
  const notReady = roleIds.filter((id) => {
    const state = byId.get(id)?.state;
    return state !== 'ready' && state !== 'paused';
  });
  if (notReady.length > 0) {
    return {
      projectId: project.id,
      state: 'not_ready',
      failed: [{ id: 'P2', detail: 'detail.P2', agentIds: notReady }],
      agents,
    };
  }
  return { projectId: project.id, state: 'ready', failed: [], agents };
}
