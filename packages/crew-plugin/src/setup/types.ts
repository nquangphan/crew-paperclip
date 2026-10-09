import type { CrewRoleSlot } from "../jobs/types.js";

/** Progress of a web wizard, kept on the server so "Chạy tiếp" resumes from the last finished step. */
export type SetupRunKind = "add-project" | "add-agent";
export type SetupRunStatus = "running" | "failed" | "done";

/** Steps in order; finishing the last one with `done` finishes the run. */
export const SETUP_STEPS = {
  "add-project": ["inspect", "project", "checkouts", "environments", "agents", "roles", "check"],
  "add-agent": ["agent", "pin", "environment", "workspace", "role", "assistant-instructions"],
} as const;
export type SetupStepId = (typeof SETUP_STEPS)[SetupRunKind][number];

export const SETUP_RUN_KINDS: readonly SetupRunKind[] = ["add-project", "add-agent"];
export const SETUP_RUN_STATUSES: readonly SetupRunStatus[] = ["running", "failed", "done"];
/** A step lock older than this is treated as abandoned (closed tab, crashed browser). */
export const SETUP_LOCK_MINUTES = 5;
export const SETUP_LIST_LIMIT = 100;

export interface SetupStepState { status: "done" | "failed"; at: string; refs?: Record<string, string>; error?: string }

export interface SetupRun {
  id: string; companyId: string; kind: SetupRunKind; projectKey: string; projectId: string | null;
  machineId: string; input: AddProjectInput | AddAgentInput; steps: Partial<Record<SetupStepId, SetupStepState>>;
  status: SetupRunStatus; runningStep: SetupStepId | null; createdAt: string; updatedAt: string;
}

export interface AddProjectInput { name: string; key: string; folder: string; executors: 1 | 2 }
export interface AddAgentInput { projectId: string; slot: CrewRoleSlot; name: string; model: string }
