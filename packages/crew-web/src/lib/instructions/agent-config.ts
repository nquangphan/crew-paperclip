// Cấu hình agent Crew tạo từ web: cùng giá trị với agent app Mac tạo (apps/mac-app add-project.ts, paperclip/client.ts)
// và agent R1 trên prod. Tên trường theo createAgentSchema của packages/shared: maxConcurrentRuns nằm trong
// runtimeConfig.heartbeat, permissions là trường gốc. Không gửi `role` (enum riêng của Paperclip, để mặc định).

export type CrewRole = 'assistant' | 'executor' | 'reviewer' | 'integrator';
export type CrewRoleSlot = 'assistant' | 'executor' | 'executor-2' | 'reviewer' | 'integrator';

/** Model Crew cho phép, bằng tập model trong CREW_COMPLEXITY_MODEL của server/src/crew/model-policy.ts. */
export const CREW_MODELS = ['claude-sonnet-5', 'claude-opus-5'] as const;
export type CrewModel = (typeof CREW_MODELS)[number];

/** Model mặc định theo vai trò, như app: Trợ Lý chạy opus, còn lại sonnet. */
export const ROLE_MODELS: Readonly<Record<CrewRole, CrewModel>> = Object.freeze({
  assistant: 'claude-opus-5',
  executor: 'claude-sonnet-5',
  reviewer: 'claude-sonnet-5',
  integrator: 'claude-sonnet-5',
});

export const CREW_AGENT_PERMISSIONS = Object.freeze({ canCreateAgents: false, canCreateSkills: false } as const);
export const CREW_RUNTIME_CONFIG = Object.freeze({
  heartbeat: Object.freeze({ enabled: false, maxConcurrentRuns: 1 } as const),
});
/** Grant thêm cho Trợ Lý để giao việc cho executor. */
export const ASSISTANT_GRANTS = Object.freeze(['tasks:assign'] as const);

/** Đuôi đường dẫn wrapper; đường đầy đủ là `<home>` + đuôi này (tuyệt đối, như WRAPPER_RE của merge-agent-config). */
export const CREW_WRAPPER_SUFFIX = '/.crew/bin/crew-claude-run';
export const WRAPPER_RE = /^\/.+\/\.crew\/bin\/crew-claude-run$/;
/** Bản ghim Superpowers của máy: `<home>/.crew/workflows/superpowers/<bản>`. */
export const SUPERPOWERS_PIN_RE = /^(\/.+)\/\.crew\/workflows\/superpowers\/(?!\.\.?$)[^/]+$/;

function homeOfPin(pinDir: string): string {
  const match = SUPERPOWERS_PIN_RE.exec(pinDir);
  if (!match?.[1]) {
    throw new Error(`Thư mục Superpowers phải là bản ghim <home>/.crew/workflows/superpowers/<bản>: ${pinDir}`);
  }
  return match[1];
}

/** Web không biết home của Mac: suy từ bản ghim Superpowers mà máy báo (`superpowers.pinDir`). */
export function crewWrapperCommand(pinDir: string): string {
  return `${homeOfPin(pinDir)}${CREW_WRAPPER_SUFFIX}`;
}

/** `extraArgs` ghim Superpowers, đúng thứ tự `merge-agent-config.mjs` ghi. */
export function crewExtraArgs(pinDir: string): string[] {
  homeOfPin(pinDir);
  return ['--setting-sources', 'project,local', '--plugin-dir', pinDir];
}

export function roleOfSlot(slot: CrewRoleSlot): CrewRole {
  return slot === 'executor-2' ? 'executor' : slot;
}

export function isCrewModel(model: string): model is CrewModel {
  return (CREW_MODELS as readonly string[]).includes(model);
}

export interface CreateAgentBody {
  name: string;
  adapterType: 'claude_local';
  adapterConfig: { engine: 'cli'; command: string; extraArgs: string[]; model: CrewModel; env: Record<string, never> };
  runtimeConfig: { heartbeat: { enabled: boolean; maxConcurrentRuns: number } };
  defaultEnvironmentId?: string;
  permissions: { canCreateAgents: boolean; canCreateSkills: boolean };
}

/**
 * Body `POST /companies/:c/agents` cho agent Crew. `engine: 'cli'` bắt buộc: thiếu thì Paperclip chạy ACP, mà ACP
 * không chạy environment SSH `in_place`. `env` rỗng, không mang secret.
 */
export function crewAgentCreateBody(input: {
  name: string;
  role: CrewRole;
  model: string;
  pinDir: string;
  environmentId?: string;
}): CreateAgentBody {
  if (input.name.trim() === '') throw new Error('Tên agent không được trống');
  if (!isCrewModel(input.model)) throw new Error(`Model ${input.model} không nằm trong danh sách model Crew`);
  if (!Object.hasOwn(ROLE_MODELS, input.role)) throw new Error(`Vai trò không hợp lệ: ${input.role}`);
  return {
    name: input.name,
    adapterType: 'claude_local',
    adapterConfig: {
      engine: 'cli',
      command: crewWrapperCommand(input.pinDir),
      extraArgs: crewExtraArgs(input.pinDir),
      model: input.model,
      env: {},
    },
    runtimeConfig: { heartbeat: { ...CREW_RUNTIME_CONFIG.heartbeat } },
    ...(input.environmentId ? { defaultEnvironmentId: input.environmentId } : {}),
    permissions: { ...CREW_AGENT_PERMISSIONS },
  };
}
