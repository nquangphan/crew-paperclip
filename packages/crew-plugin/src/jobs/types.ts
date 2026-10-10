/** Work the board queues for a Mac; the 2P Crew app claims it with a board key and reports the result. */
export type MachineJobKind = "inspect-folder" | "prepare-checkouts" | "agent-workspace" | "skill-sync" | "check"
  | "remove-checkouts" | "skill-remove";
export type MachineJobStatus = "queued" | "claimed" | "done" | "failed" | "cancelled";
export type CrewRoleSlot = "assistant" | "executor" | "executor-2" | "reviewer" | "integrator";

export const MACHINE_JOB_KINDS: readonly MachineJobKind[] = [
  "inspect-folder", "prepare-checkouts", "agent-workspace", "skill-sync", "check", "remove-checkouts", "skill-remove",
];
export const MACHINE_JOB_STATUSES: readonly MachineJobStatus[] = ["queued", "claimed", "done", "failed", "cancelled"];
export const CREW_ROLE_SLOTS: readonly CrewRoleSlot[] = ["assistant", "executor", "executor-2", "reviewer", "integrator"];

/** `result` is set when a job is `done`, and also when a `check` job is `failed` (the doctor items the board lists). */
export interface MachineJob {
  id: string; companyId: string; machineId: string; kind: MachineJobKind; payload: JobPayload; status: MachineJobStatus;
  result: JobResult | null; errorCode: JobErrorCode | null; errorText: string | null; attempts: number;
  setupRunId: string | null; createdAt: string; claimedAt: string | null; finishedAt: string | null;
}

export type JobPayload =
  | { kind: "inspect-folder"; folder: string }
  | { kind: "prepare-checkouts"; projectKey: string; folder: string; roles: { role: CrewRoleSlot; branch: string }[] }
  | { kind: "agent-workspace"; projectKey: string; folder: string; role: CrewRoleSlot; branch: string }
  | { kind: "skill-sync"; skillId: string; slug: string; version: string }
  | { kind: "check"; projectKey: string }
  /** Removes the project's checkouts under `~/crew-agents/<projectKey>/`; a dirty, busy or foreign checkout is kept. */
  | { kind: "remove-checkouts"; projectId: string; projectKey: string; roles: CrewRoleSlot[]; removeStatusRepo: boolean }
  /** Removes the copy under `~/.crew/skills/<companyId>/<slug>`. */
  | { kind: "skill-remove"; skillId: string; slug: string };

/** Why a checkout was kept by `remove-checkouts`; keeping one is a `done` result, never a failure. */
export type KeptCheckoutReason = "dirty" | "busy" | "not_worktree" | "git_failed";
export const KEPT_CHECKOUT_REASONS: readonly KeptCheckoutReason[] = ["dirty", "busy", "not_worktree", "git_failed"];

export type JobResult =
  | { kind: "inspect-folder"; root: string; branch: string | null; remote: string | null; docsBundle: string | null; clean: boolean }
  | { kind: "prepare-checkouts"; checkouts: { role: CrewRoleSlot; path: string; head: string }[] }
  | { kind: "agent-workspace"; role: CrewRoleSlot; path: string; head: string }
  | { kind: "skill-sync"; sha256: string; files: number }
  | { kind: "check"; items: { id: string; status: "ok" | "warn" | "error"; title: string }[] }
  | {
    kind: "remove-checkouts";
    removed: { role: CrewRoleSlot; path: string }[];
    kept: { role: CrewRoleSlot; path: string; reason: KeptCheckoutReason; detail?: string }[];
    absent: CrewRoleSlot[];
  }
  | { kind: "skill-remove"; removed: boolean };

export type JobErrorCode =
  | "folder_not_git" | "folder_forbidden" | "folder_missing" | "checkout_exists" | "git_failed"
  | "skill_fetch_failed" | "check_failed" | "lease_expired" | "app_error";

export const JOB_ERROR_CODES: readonly JobErrorCode[] = [
  "folder_not_git", "folder_forbidden", "folder_missing", "checkout_exists", "git_failed",
  "skill_fetch_failed", "check_failed", "lease_expired", "app_error",
];

/** A claimed job the app has not reported within this window goes back to the queue. */
export const JOB_LEASE_MINUTES = 10;
/** Lease expiries after which a job stops being retried automatically. */
export const JOB_MAX_ATTEMPTS = 3;
export const JOB_LIST_LIMIT = 100;
