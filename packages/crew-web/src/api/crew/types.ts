// Kiểu dữ liệu plugin crew.core dùng ở web. Chép từ hợp đồng plan R3 (I1 hàng đợi việc trên máy, I2 tiến độ wizard,
// I6 data); bản gốc ở packages/crew-plugin/src/jobs/types.ts và src/setup/*. Plugin đổi thì sửa cùng lúc.

import type { Issue } from '@paperclipai/shared';
import type { CrewRoleSlot } from '@/lib/instructions/agent-config';

/** Ô vai trò (cùng CrewRoleSlot của plugin `src/jobs/types.ts`), gồm ba ô runtime `executor-codex`, `executor-opencode`, `reviewer-codex`. */
export type { CrewRoleSlot };

// I1. Hàng đợi việc trên máy
export type MachineJobKind =
  | 'inspect-folder'
  | 'prepare-checkouts'
  | 'agent-workspace'
  | 'skill-sync'
  | 'check'
  | 'remove-checkouts'
  | 'skill-remove'
  | 'runtimes-setup';
export type MachineJobStatus = 'queued' | 'claimed' | 'done' | 'failed' | 'cancelled';
export type JobPayload =
  | { kind: 'inspect-folder'; folder: string }
  | { kind: 'prepare-checkouts'; projectKey: string; folder: string; roles: { role: CrewRoleSlot; branch: string }[] }
  | { kind: 'agent-workspace'; projectKey: string; folder: string; role: CrewRoleSlot; branch: string }
  | { kind: 'skill-sync'; skillId: string; slug: string; version: string }
  | { kind: 'check'; projectKey: string }
  | {
      kind: 'remove-checkouts';
      projectId: string;
      projectKey: string;
      roles: CrewRoleSlot[];
      removeStatusRepo: boolean;
    }
  | { kind: 'skill-remove'; skillId: string; slug: string }
  | { kind: 'runtimes-setup' };
export type JobResult =
  | {
      kind: 'inspect-folder';
      root: string;
      branch: string | null;
      remote: string | null;
      docsBundle: string | null;
      clean: boolean;
    }
  | { kind: 'prepare-checkouts'; checkouts: { role: CrewRoleSlot; path: string; head: string }[] }
  | { kind: 'agent-workspace'; role: CrewRoleSlot; path: string; head: string }
  | { kind: 'skill-sync'; sha256: string; files: number }
  | { kind: 'check'; items: { id: string; status: 'ok' | 'warn' | 'error'; title: string }[] }
  | {
      kind: 'remove-checkouts';
      removed: { role: CrewRoleSlot; path: string }[];
      kept: {
        role: CrewRoleSlot;
        path: string;
        reason: 'dirty' | 'busy' | 'not_worktree' | 'git_failed';
        detail?: string;
      }[];
      absent: CrewRoleSlot[];
    }
  | { kind: 'skill-remove'; removed: boolean }
  | {
      kind: 'runtimes-setup';
      wrappers: { codex: boolean; opencode: boolean };
      codex: { version: string | null; loggedIn: boolean | null };
      opencode: { version: string | null; keyPresent: boolean | null };
    };
export type JobErrorCode =
  | 'folder_not_git'
  | 'folder_forbidden'
  | 'folder_missing'
  | 'checkout_exists'
  | 'git_failed'
  | 'skill_fetch_failed'
  | 'check_failed'
  | 'lease_expired'
  | 'app_error';
export interface MachineJob {
  id: string;
  companyId: string;
  machineId: string;
  kind: MachineJobKind;
  payload: JobPayload;
  status: MachineJobStatus;
  result: JobResult | null;
  errorCode: JobErrorCode | null;
  errorText: string | null;
  attempts: number;
  setupRunId: string | null;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
}

// I3. Công tắc runtime theo máy (GET/POST /runtime-switches) và I8. Bản tin `runtimes` của máy.
export type CrewRuntime = 'claude_local' | 'codex_local' | 'opencode_local';
export type RuntimeSwitchLock = 'opencode-patch-missing';
export interface RuntimeSwitchState {
  enabled: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
  locked: RuntimeSwitchLock | null;
}
export interface MachineRuntimeSwitches {
  machineId: string;
  hostname: string;
  runtimes: Record<CrewRuntime, RuntimeSwitchState>;
}
export interface RuntimesReport {
  codex: { version: string | null; loggedIn: boolean | null; primaryUsedPct: number | null; resetsAt: string | null };
  opencode: {
    version: string | null;
    keyPresent: boolean | null;
    costDay: number | null;
    costWeek: number | null;
    costMonth: number | null;
    models: string[];
  };
}

// I2. Tiến độ wizard
export type SetupStepId =
  | 'inspect'
  | 'project'
  | 'checkouts'
  | 'environments'
  | 'agents'
  | 'roles'
  | 'check'
  | 'agent'
  | 'pin'
  | 'environment'
  | 'workspace'
  | 'role'
  | 'assistant-instructions'
  // remove-project
  | 'pause-agents'
  // remove-agent (dùng chung 'roles', 'environment')
  | 'pause-agent'
  | 'checkout';
export interface SetupStepState {
  status: 'done' | 'failed';
  at: string;
  refs?: Record<string, string>;
  error?: string;
}
export interface AddProjectInput {
  name: string;
  key: string;
  folder: string;
  executors: 1 | 2;
}
export interface AddAgentInput {
  projectId: string;
  slot: CrewRoleSlot;
  name: string;
  model: string;
}
export interface RemoveProjectInput {
  projectId: string;
  projectName: string;
}
export interface RemoveAgentInput {
  agentId: string;
  agentName: string;
  projectId: string | null;
  role: CrewRoleSlot | null;
}
export type SetupRunKind = 'add-project' | 'add-agent' | 'remove-project' | 'remove-agent';
export interface SetupRun {
  id: string;
  companyId: string;
  kind: SetupRunKind;
  projectKey: string;
  projectId: string | null;
  machineId: string;
  input: AddProjectInput | AddAgentInput | RemoveProjectInput | RemoveAgentInput;
  steps: Partial<Record<SetupStepId, SetupStepState>>;
  status: 'running' | 'failed' | 'done' | 'abandoned';
  runningStep: SetupStepId | null;
  createdAt: string;
  updatedAt: string;
}

// Vai trò project (route roles, R2-1). Ba ô runtime: plugin luôn trả (null = trống); body POST thiếu khóa thì plugin giữ
// giá trị đang lưu, null thì xóa.
export interface ProjectRoles {
  assistantAgentId: string;
  executorAgentIds: string[];
  reviewerAgentId: string;
  integratorAgentId: string;
  codexExecutorAgentId?: string | null;
  opencodeExecutorAgentId?: string | null;
  codexReviewerAgentId?: string | null;
}

// I6. Data mới của PL-2
export interface CrewCompany {
  id: string;
  name: string;
}
export interface SkillSyncState {
  skillId: string;
  machineId: string;
  /** Việc mới nhất của cặp skill/máy: đồng bộ hay gỡ (cặp có `skill-remove` đã xong không còn trong danh sách). */
  kind: 'skill-sync' | 'skill-remove';
  status: MachineJobStatus;
  sha256: string | null;
  finishedAt: string | null;
  jobId: string | null;
  errorCode: string | null;
  errorText: string | null;
}

// Ép Done (S6.17): kết quả route issues.forceDone
export type ForceDoneWarning = 'comment_failed' | 'wakeup_failed' | 'activity_failed' | 'violations_unread';
export interface ForceDoneResult {
  issue: Issue;
  /** Mã vi phạm của luật cổng bị bỏ qua (`stage_unapproved:<id>`, `docs_missing`, `push_stale`…). */
  violations: string[];
  warnings: ForceDoneWarning[];
}

// Kiểu data R1 (roots, map, docsCheck, machines, docs.*): import thẳng từ export `shared/*` của plugin, không chép lại.
export type {
  DocsCheckResult,
  DocsHistoryItem,
  DocsNode,
  DocsPage,
  DocsProject,
  DocsStatus,
  DocsTree,
} from '@crew/paperclip-plugin/shared/docs-tree';
export type { CrewMachine, MachineCardModel } from '@crew/paperclip-plugin/shared/machine-card';
export type { CrewMap, CrewMapNode, CrewRoot, MapEdge, MapProjection } from '@crew/paperclip-plugin/shared/map';

// I5. Quyết định runtime của một issue (data `crew.runtimeDecisions`): mới nhất trước, tối đa 50 dòng.
export type RuntimeDecisionKind = 'select' | 'fallback' | 'fallback_refused';
export type RuntimeDecisionRole = 'executor' | 'reviewer';
export type RuntimeDecisionTrigger = 'quota' | 'auth' | 'unavailable' | 'switch_off' | 'other';
export interface RuntimeDecision {
  id: string;
  role: RuntimeDecisionRole;
  kind: RuntimeDecisionKind;
  runId: string | null;
  machineId: string | null;
  fromAgentId: string | null;
  fromAgentName: string | null;
  toAgentId: string | null;
  toAgentName: string | null;
  fromRuntime: string | null;
  toRuntime: string | null;
  model: string | null;
  complexity: string | null;
  trigger: RuntimeDecisionTrigger | null;
  reason: string;
  /** ISO UTC. */
  decidedAt: string;
}
