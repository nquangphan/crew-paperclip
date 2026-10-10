import type { CrewRoleSlot } from "../jobs/types.js";

/** Progress of a web wizard, kept on the server so "Chạy tiếp" resumes from the last finished step. */
export type SetupRunKind = "add-project" | "add-agent" | "remove-project" | "remove-agent";
/** `abandoned`: the owner gave up a failed add-project run that never created a project, freeing its key. Final. */
export type SetupRunStatus = "running" | "failed" | "done" | "abandoned";

/** Steps in order; finishing the last one with `done` finishes the run. */
export const SETUP_STEPS = {
  "add-project": ["inspect", "project", "checkouts", "environments", "agents", "roles", "check"],
  "add-agent": ["agent", "pin", "environment", "workspace", "role", "assistant-instructions"],
  "remove-project": ["pause-agents", "roles", "environments", "checkouts", "project"],
  "remove-agent": ["roles", "pause-agent", "environment", "checkout"],
} as const;
export type SetupStepId = (typeof SETUP_STEPS)[SetupRunKind][number];

/** Steps of one run: an agent removed without a role only pauses and archives its environment. */
export function setupStepsOf(run: Pick<SetupRun, "kind" | "input">): readonly SetupStepId[] {
  if (run.kind === "remove-agent" && (run.input as RemoveAgentInput).role === null) return ["pause-agent", "environment"];
  return SETUP_STEPS[run.kind];
}

export const SETUP_RUN_KINDS: readonly SetupRunKind[] = ["add-project", "add-agent", "remove-project", "remove-agent"];
export const SETUP_RUN_STATUSES: readonly SetupRunStatus[] = ["running", "failed", "done", "abandoned"];
/**
 * A step lock older than this is treated as dead (closed tab, crashed browser). It must outlast the longest step:
 * a step waits up to 10 minutes for a machine job, and a takeover before that would run the step twice.
 */
export const SETUP_LOCK_MINUTES = 15;
export const SETUP_LIST_LIMIT = 100;

export interface SetupStepState { status: "done" | "failed"; at: string; refs?: Record<string, string>; error?: string }

export interface SetupRun {
  id: string; companyId: string; kind: SetupRunKind; projectKey: string; projectId: string | null;
  machineId: string; input: SetupRunInput; steps: Partial<Record<SetupStepId, SetupStepState>>;
  status: SetupRunStatus; runningStep: SetupStepId | null; createdAt: string; updatedAt: string;
}

export interface AddProjectInput { name: string; key: string; folder: string; executors: 1 | 2 }
export interface AddAgentInput { projectId: string; slot: CrewRoleSlot; name: string; model: string }
export interface RemoveProjectInput { projectId: string; projectName: string }
/** `projectId` and `role` are both set (the agent holds that role) or both null. */
export interface RemoveAgentInput { agentId: string; agentName: string; projectId: string | null; role: CrewRoleSlot | null }
export type SetupRunInput = AddProjectInput | AddAgentInput | RemoveProjectInput | RemoveAgentInput;
