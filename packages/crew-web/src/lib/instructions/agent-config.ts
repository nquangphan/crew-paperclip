// Cấu hình agent Crew tạo từ web: cùng giá trị với agent app Mac tạo (apps/mac-app add-project.ts, paperclip/client.ts)
// và agent R1 trên prod. Tên trường theo createAgentSchema của packages/shared: maxConcurrentRuns nằm trong
// runtimeConfig.heartbeat, permissions là trường gốc. Không gửi `role` (enum riêng của Paperclip, để mặc định).
// Agent Codex/OpenCode theo cùng dạng `adapterConfig` mà crew/agents/merge-agent-config.mjs kiểm.

import type { ModelEffort, ModelRole, ModelSettings } from '../../api/crew/model-settings';

export type CrewRole = 'assistant' | 'executor' | 'reviewer' | 'integrator';
export type CrewRuntime = 'claude_local' | 'codex_local' | 'opencode_local';
export type CrewRuntimeSlot = 'executor-codex' | 'executor-opencode' | 'reviewer-codex';
export type CrewRoleSlot = 'assistant' | 'executor' | 'executor-2' | 'reviewer' | 'integrator' | CrewRuntimeSlot;

/** Mọi ô vai trò, cùng thứ tự CREW_ROLE_SLOTS của plugin (`src/jobs/types.ts`). */
export const CREW_ROLE_SLOTS: readonly CrewRoleSlot[] = Object.freeze([
  'assistant',
  'executor',
  'executor-2',
  'reviewer',
  'integrator',
  'executor-codex',
  'executor-opencode',
  'reviewer-codex',
]);

/** Ô runtime và khóa của nó trong vai trò project (cột `*_agent_id` của plugin). */
export const RUNTIME_SLOT_KEYS = Object.freeze({
  'executor-codex': 'codexExecutorAgentId',
  'executor-opencode': 'opencodeExecutorAgentId',
  'reviewer-codex': 'codexReviewerAgentId',
} as const satisfies Record<CrewRuntimeSlot, string>);
export type RuntimeSlotKey = (typeof RUNTIME_SLOT_KEYS)[CrewRuntimeSlot];

const SLOT_RUNTIME: Readonly<Record<CrewRuntimeSlot, CrewRuntime>> = Object.freeze({
  'executor-codex': 'codex_local',
  'executor-opencode': 'opencode_local',
  'reviewer-codex': 'codex_local',
});

export function isRuntimeSlot(slot: string): slot is CrewRuntimeSlot {
  return Object.hasOwn(SLOT_RUNTIME, slot);
}

/** Runtime mà agent của ô phải chạy; ô Claude là `claude_local`. */
export function runtimeOfSlot(slot: CrewRoleSlot): CrewRuntime {
  return isRuntimeSlot(slot) ? SLOT_RUNTIME[slot] : 'claude_local';
}

/** Template AGENTS.md của ô: executor-2 và executor runtime dùng executor, reviewer Codex dùng reviewer. */
export function roleOfSlot(slot: CrewRoleSlot): CrewRole {
  if (slot === 'executor-2' || slot === 'executor-codex' || slot === 'executor-opencode') return 'executor';
  if (slot === 'reviewer-codex') return 'reviewer';
  return slot;
}

/** Vai trong bảng cài đặt model của từng ô: `executor-2` dùng vai `executor`, các ô khác dùng vai cùng tên. */
export function modelRoleOfSlot(slot: CrewRoleSlot): ModelRole {
  return slot === 'executor-2' ? 'executor' : slot;
}

/**
 * Sắp id model tăng dần kiểu natural sort (`x-5.3` trước `x-5.10`, `localeCompare` với `numeric`). Thứ tự khóa của
 * `models` không ổn định: server lưu `jsonb`, Postgres trả khóa theo độ dài rồi chữ cái, nên mọi danh sách model hiển
 * thị đi qua hàm này.
 */
export function sortModelIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** Model chọn được cho runtime: mọi model trong catalog của bảng cài đặt model (một nguồn duy nhất, không chép), đã sắp. */
export function crewModelsOf(runtime: CrewRuntime, settings: ModelSettings): string[] {
  return sortModelIds(Object.keys(settings.catalog[runtime].models));
}

/** Model chọn được cho ô: theo runtime của ô; reviewer Codex chỉ có model cố định của vai `reviewer-codex`. */
export function slotModels(slot: CrewRoleSlot, settings: ModelSettings): string[] {
  if (slot === 'reviewer-codex') return [settings.roles['reviewer-codex'].model];
  return crewModelsOf(runtimeOfSlot(slot), settings);
}

/** Model mặc định của ô theo `settings.roles`. */
export function defaultModelOf(slot: CrewRoleSlot, settings: ModelSettings): string {
  return settings.roles[modelRoleOfSlot(slot)].model;
}

/** Effort mặc định của ô theo `settings.roles`; null khi vai không có effort. */
export function defaultEffortOf(slot: CrewRoleSlot, settings: ModelSettings): ModelEffort | null {
  return settings.roles[modelRoleOfSlot(slot)].effort;
}

export function isCrewModel(model: string, settings: ModelSettings, runtime: CrewRuntime = 'claude_local'): boolean {
  return crewModelsOf(runtime, settings).includes(model);
}

export const CREW_AGENT_PERMISSIONS = Object.freeze({ canCreateAgents: false, canCreateSkills: false } as const);
export const CREW_RUNTIME_CONFIG = Object.freeze({
  heartbeat: Object.freeze({ enabled: false, maxConcurrentRuns: 1 } as const),
});
/** Grant thêm cho Trợ Lý để giao việc cho executor. */
export const ASSISTANT_GRANTS = Object.freeze(['tasks:assign'] as const);

const WRAPPER_NAMES: Readonly<Record<CrewRuntime, string>> = Object.freeze({
  claude_local: 'crew-claude-run',
  codex_local: 'crew-codex-run',
  opencode_local: 'crew-opencode-run',
});
/** Đuôi đường dẫn wrapper; đường đầy đủ là `<home>` + đuôi này (tuyệt đối, như WRAPPER_RE của merge-agent-config). */
export const CREW_WRAPPER_SUFFIX = '/.crew/bin/crew-claude-run';
export const WRAPPER_RE = /^\/.+\/\.crew\/bin\/crew-claude-run$/;
const WRAPPER_RES: Readonly<Record<CrewRuntime, RegExp>> = Object.freeze({
  claude_local: WRAPPER_RE,
  codex_local: /^\/.+\/\.crew\/bin\/crew-codex-run$/,
  opencode_local: /^\/.+\/\.crew\/bin\/crew-opencode-run$/,
});
export const wrapperReOf = (runtime: CrewRuntime): RegExp => WRAPPER_RES[runtime];
/** Đuôi wrapper của runtime: `/.crew/bin/crew-<x>-run`. */
export const wrapperSuffixOf = (runtime: CrewRuntime): string => `/.crew/bin/${WRAPPER_NAMES[runtime]}`;

/**
 * Bản ghim Superpowers của máy: `<home>/.crew/workflows/superpowers/<bản>`. Home và bản chỉ gồm chữ, số, `._+-`, không
 * có đoạn `.`/`..`: wrapper suy từ home nên home lạ sẽ trỏ command ra ngoài home.
 */
export const SUPERPOWERS_PIN_RE =
  /^((?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._+-]+)+)\/\.crew\/workflows\/superpowers\/(?!\.\.?$)[A-Za-z0-9._+-]+$/;

function homeOfPin(pinDir: string): string {
  const match = SUPERPOWERS_PIN_RE.exec(pinDir);
  if (!match?.[1]) {
    throw new Error(`Thư mục Superpowers phải là bản ghim <home>/.crew/workflows/superpowers/<bản>: ${pinDir}`);
  }
  return match[1];
}

/** Web không biết home của Mac: suy từ bản ghim Superpowers mà máy báo (`superpowers.pinDir`). */
export function crewWrapperCommand(pinDir: string, runtime: CrewRuntime = 'claude_local'): string {
  return `${homeOfPin(pinDir)}${wrapperSuffixOf(runtime)}`;
}

/** `extraArgs` ghim Superpowers, đúng thứ tự `merge-agent-config.mjs` ghi. */
export function crewExtraArgs(pinDir: string): string[] {
  homeOfPin(pinDir);
  return ['--setting-sources', 'project,local', '--plugin-dir', pinDir];
}

/** `extraArgs` theo runtime: chỉ Claude nhận `--plugin-dir`; Codex/OpenCode đọc bản ghim qua wrapper. */
export function crewExtraArgsOf(pinDir: string, runtime: CrewRuntime): string[] {
  if (runtime === 'claude_local') return crewExtraArgs(pinDir);
  homeOfPin(pinDir);
  return [];
}

/**
 * Gốc instance Paperclip trên server theo image của fork (`PAPERCLIP_HOME=/paperclip`, instance `default`). CODEX_HOME
 * của agent Codex nằm ngoài cây `companies/<companyId>`: CODEX_HOME do server quản lý mà thiếu `auth.json` thì server
 * chặn run (`configuration_incomplete`). Codex thật chạy với CODEX_HOME riêng trên Mac do `crew-codex-run` dựng.
 */
export const CREW_CODEX_HOME_ROOT = '/paperclip/instances/default/crew-codex-home';
const PROJECT_KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
const MANAGED_HOME_RE = /(^|\/)companies\/[^/]+/;

/** CODEX_HOME trên server của agent ô `slot` trong project `projectKey`. */
export function crewCodexHome(projectKey: string, slot: CrewRoleSlot): string {
  if (!PROJECT_KEY_RE.test(projectKey)) throw new Error(`Khóa project không hợp lệ: ${projectKey}`);
  return `${CREW_CODEX_HOME_ROOT}/${projectKey}/${slot}`;
}

/** CODEX_HOME hợp lệ cho agent Codex của Crew: tuyệt đối, không có `..`, ngoài cây `companies/<id>`. */
export function isUnmanagedCodexHome(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.split('/').includes('..') &&
    !MANAGED_HOME_RE.test(value)
  );
}

export interface ClaudeAgentConfig {
  engine: 'cli';
  command: string;
  extraArgs: string[];
  model: string;
  /** Có khi vai trong bảng cài đặt model có effort. */
  effort?: ModelEffort;
  env: Record<string, never>;
}
export interface CodexAgentConfig {
  /** Adapter Codex mặc định `acp`, mà ACP không chạy environment SSH `in_place`: luôn `cli`. */
  engine: 'cli';
  command: string;
  extraArgs: string[];
  model: string;
  modelReasoningEffort: ModelEffort;
  dangerouslyBypassApprovalsAndSandbox: true;
  env: { CODEX_HOME: string };
}
export interface OpencodeAgentConfig {
  command: string;
  extraArgs: string[];
  model: string;
  env: Record<string, never>;
}

interface AgentBodyBase {
  name: string;
  runtimeConfig: { heartbeat: { enabled: boolean; maxConcurrentRuns: number } };
  defaultEnvironmentId?: string;
  permissions: { canCreateAgents: boolean; canCreateSkills: boolean };
}
export type CreateAgentBody = AgentBodyBase &
  (
    | { adapterType: 'claude_local'; adapterConfig: ClaudeAgentConfig }
    | { adapterType: 'codex_local'; adapterConfig: CodexAgentConfig }
    | { adapterType: 'opencode_local'; adapterConfig: OpencodeAgentConfig }
  );

/**
 * Phần `adapterConfig` mà wizard đặt khi tạo hay sửa agent của ô (trừ `model` và effort). Effort theo vai trong bảng cài
 * đặt model nên do `crewAgentCreateBody` thêm; chế độ sửa giữ effort đang có của agent.
 */
export function crewRuntimeConfigOf(
  slot: CrewRoleSlot,
  pinDir: string,
  projectKey: string,
):
  | Omit<ClaudeAgentConfig, 'model' | 'effort'>
  | Omit<CodexAgentConfig, 'model' | 'modelReasoningEffort'>
  | Omit<OpencodeAgentConfig, 'model'> {
  const runtime = runtimeOfSlot(slot);
  const command = crewWrapperCommand(pinDir, runtime);
  const extraArgs = crewExtraArgsOf(pinDir, runtime);
  if (runtime === 'claude_local') return { engine: 'cli', command, extraArgs, env: {} };
  if (runtime === 'opencode_local') return { command, extraArgs, env: {} };
  return {
    engine: 'cli',
    command,
    extraArgs,
    dangerouslyBypassApprovalsAndSandbox: true,
    env: { CODEX_HOME: crewCodexHome(projectKey, slot) },
  };
}

/**
 * Body `POST /companies/:c/agents` cho agent Crew. Agent Claude: `engine: 'cli'` bắt buộc (thiếu thì Paperclip chạy
 * ACP, mà ACP không chạy environment SSH `in_place`), `env` rỗng. Agent Codex: `engine: 'cli'` (cùng lý do), wrapper `crew-codex-run`, bỏ sandbox
 * (gitdir của worktree nằm ngoài worktree), `env` chỉ có CODEX_HOME, không bao giờ có OPENAI_API_KEY. Agent OpenCode:
 * wrapper `crew-opencode-run`, `env` rỗng (key nằm trong Keychain của Mac). `slot` hoặc `role` (ô Claude).
 */
export function crewAgentCreateBody(input: {
  name: string;
  role?: CrewRole;
  slot?: CrewRoleSlot;
  model: string;
  /** Bảng cài đặt model hiện hành: danh sách model hợp lệ của ô và effort mặc định của vai. */
  settings: ModelSettings;
  pinDir: string;
  /** Bắt buộc với ô Codex (dựng CODEX_HOME). */
  projectKey?: string;
  environmentId?: string;
}): CreateAgentBody {
  if (input.name.trim() === '') throw new Error('Tên agent không được trống');
  const slot = input.slot ?? input.role;
  if (!slot || !(CREW_ROLE_SLOTS as readonly string[]).includes(slot)) {
    throw new Error(`Vai trò không hợp lệ: ${String(slot)}`);
  }
  if (!slotModels(slot, input.settings).includes(input.model)) {
    throw new Error(`Model ${input.model} không nằm trong danh sách model Crew`);
  }
  const base: AgentBodyBase = {
    name: input.name,
    runtimeConfig: { heartbeat: { ...CREW_RUNTIME_CONFIG.heartbeat } },
    ...(input.environmentId ? { defaultEnvironmentId: input.environmentId } : {}),
    permissions: { ...CREW_AGENT_PERMISSIONS },
  };
  const runtime = runtimeOfSlot(slot);
  // Effort theo vai trong bảng cài đặt model, ghi vào key effort của runtime; ô Codex luôn có effort.
  const effortKey = input.settings.catalog[runtime].effortKey;
  const effort = defaultEffortOf(slot, input.settings) ?? (runtime === 'codex_local' ? 'medium' : null);
  const adapterConfig = {
    ...crewRuntimeConfigOf(slot, input.pinDir, input.projectKey ?? ''),
    model: input.model,
    ...(effortKey && effort ? { [effortKey]: effort } : {}),
  };
  return { ...base, adapterType: runtime, adapterConfig } as CreateAgentBody;
}

/** Vai trò project theo ô (dạng ProjectRoles của route roles; ô runtime thiếu hay null là trống). */
export interface CrewSlotRoles {
  assistantAgentId: string;
  executorAgentIds: readonly string[];
  reviewerAgentId: string;
  integratorAgentId: string;
  codexExecutorAgentId?: string | null;
  opencodeExecutorAgentId?: string | null;
  codexReviewerAgentId?: string | null;
}

/** Agent của ô; ô trống thì null. */
export function agentOfSlot(roles: CrewSlotRoles, slot: CrewRoleSlot): string | null {
  if (isRuntimeSlot(slot)) return roles[RUNTIME_SLOT_KEYS[slot]] || null;
  if (slot === 'assistant') return roles.assistantAgentId || null;
  if (slot === 'executor') return roles.executorAgentIds[0] || null;
  if (slot === 'executor-2') return roles.executorAgentIds[1] || null;
  if (slot === 'reviewer') return roles.reviewerAgentId || null;
  return roles.integratorAgentId || null;
}

/** Các ô đang có agent, theo thứ tự CREW_ROLE_SLOTS. */
export function slotAgents(roles: CrewSlotRoles): [CrewRoleSlot, string][] {
  return CREW_ROLE_SLOTS.flatMap((slot) => {
    const id = agentOfSlot(roles, slot);
    return id ? [[slot, id] as [CrewRoleSlot, string]] : [];
  });
}

/** Ô mà agent đang giữ (so id không phân biệt hoa thường); không giữ thì null. */
export function slotOfAgent(roles: CrewSlotRoles, agentId: string): CrewRoleSlot | null {
  const key = agentId.toLowerCase();
  return slotAgents(roles).find(([, id]) => id.toLowerCase() === key)?.[0] ?? null;
}
