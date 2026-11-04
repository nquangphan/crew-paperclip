/** Work the board queues for a Mac; the 2P Crew app claims it with a board key and reports the result. */
export type MachineJobKind = "inspect-folder" | "prepare-checkouts" | "agent-workspace" | "skill-sync" | "check"
  | "remove-checkouts" | "skill-remove" | "runtimes-setup" | "ensure-project" | "bug-finding-review";
export type MachineJobStatus = "queued" | "claimed" | "done" | "failed" | "cancelled";
/** Số executor Claude tối đa của một project (ô `executor`, `executor-2` … `executor-5`). */
export const MAX_EXECUTORS = 5;
/** Ô executor Claude theo thứ tự trong `executorAgentIds`: phần tử đầu là `executor`, phần tử thứ N là `executor-N`. */
export const EXECUTOR_SLOTS = ["executor", "executor-2", "executor-3", "executor-4", "executor-5"] as const;
export type ExecutorSlot = (typeof EXECUTOR_SLOTS)[number];
/** `executor-codex`, `executor-opencode`, `reviewer-codex`: agent chạy runtime ngoài Claude, mỗi ô một agent. */
export type CrewRoleSlot = "assistant" | ExecutorSlot | "reviewer" | "integrator"
  | "executor-codex" | "executor-opencode" | "reviewer-codex";

/** Thư mục checkout của agent UIUX (vai `designer`): không phải ô vai trò, chỉ việc `agent-workspace` nhận. */
export const DESIGNER_CHECKOUT = "designer";
export type WorkspaceRole = CrewRoleSlot | typeof DESIGNER_CHECKOUT;

export const MACHINE_JOB_KINDS: readonly MachineJobKind[] = [
  "inspect-folder", "prepare-checkouts", "agent-workspace", "skill-sync", "check", "remove-checkouts", "skill-remove",
  "runtimes-setup", "ensure-project", "bug-finding-review",
];
export const MACHINE_JOB_STATUSES: readonly MachineJobStatus[] = ["queued", "claimed", "done", "failed", "cancelled"];
export const CREW_ROLE_SLOTS: readonly CrewRoleSlot[] = [
  "assistant", ...EXECUTOR_SLOTS, "reviewer", "integrator", "executor-codex", "executor-opencode", "reviewer-codex",
];

/** `result` is set when a job is `done`, and also when a `check` job is `failed` (the doctor items the board lists). */
export interface MachineJob {
  id: string; companyId: string; machineId: string; kind: MachineJobKind; payload: JobPayload; status: MachineJobStatus;
  result: JobResult | null; errorCode: JobErrorCode | null; errorText: string | null; attempts: number;
  setupRunId: string | null; createdAt: string; claimedAt: string | null; finishedAt: string | null;
}

export type JobPayload =
  | { kind: "inspect-folder"; folder: string }
  | { kind: "prepare-checkouts"; projectKey: string; folder: string; roles: { role: CrewRoleSlot; branch: string }[] }
  | { kind: "agent-workspace"; projectKey: string; folder: string; role: WorkspaceRole; branch: string }
  | { kind: "skill-sync"; skillId: string; slug: string; version: string }
  | { kind: "check"; projectKey: string }
  /** Removes the project's checkouts under `~/crew-agents/<projectKey>/`; a dirty, busy or foreign checkout is kept. */
  | { kind: "remove-checkouts"; projectId: string; projectKey: string; roles: string[]; removeStatusRepo: boolean }
  /** Removes the copy under `~/.crew/skills/<companyId>/<slug>`. */
  | { kind: "skill-remove"; skillId: string; slug: string }
  /** Cài/cập nhật wrapper runtime trên Mac rồi báo trạng thái. Key OpenCode không bao giờ đi qua hàng đợi. */
  | { kind: "runtimes-setup" }
  /**
   * Dựng project trên máy (flow `multi-machine`, server Crew xếp việc): tìm repo có sẵn cùng origin hoặc clone về
   * `~/crew-agents/<projectKey>/repo`, cài crew-docs, worktree cho từng `roles[].role`, repo đi kèm cạnh worktree.
   */
  | {
    kind: "ensure-project"; projectKey: string; projectId: string; originUrl: string; branch: string;
    roles: { role: string; branch: string }[]; companions: { name: string; originUrl: string }[];
  }
  /**
   * Xếp một lượt review PR vào hàng đợi app Bug Finding trên Mac (flow `bug-finding`, plugin xếp khi ticket tổng vào stage
   * cầu nối). App ghi yêu cầu vào thư mục cầu nối rồi trả `accepted` ngay; tiến độ và kết quả đi qua `POST /bug-finding/results`.
   */
  | ({ kind: "bug-finding-review" } & BugFindingReviewPayload);

export interface BugFindingReviewPayload {
  requestId: string; issueId: string; identifier: string; run: number; projectId: string; projectKey: string;
  repoPath: string; provider: "github"; prNumber: number; prUrl: string; headSha: string; baseBranch: string;
  reviewerInputText?: string;
}
/** Phản hồi người review gửi kèm lượt chạy lại (khối `crew-bf-feedback` của Trợ Lý), tối đa chừng này ký tự. */
export const BUG_FINDING_INPUT_MAX = 20_000;

/** Why a checkout was kept by `remove-checkouts`; keeping one is a `done` result, never a failure. */
export type KeptCheckoutReason = "dirty" | "busy" | "not_worktree" | "git_failed";
export const KEPT_CHECKOUT_REASONS: readonly KeptCheckoutReason[] = ["dirty", "busy", "not_worktree", "git_failed"];

export type JobResult =
  | { kind: "inspect-folder"; root: string; branch: string | null; remote: string | null; docsBundle: string | null; clean: boolean }
  | { kind: "prepare-checkouts"; checkouts: { role: CrewRoleSlot; path: string; head: string }[] }
  | { kind: "agent-workspace"; role: WorkspaceRole; path: string; head: string }
  | { kind: "skill-sync"; sha256: string; files: number }
  | { kind: "check"; items: { id: string; status: "ok" | "warn" | "error"; title: string }[] }
  | {
    kind: "remove-checkouts";
    removed: { role: string; path: string }[];
    kept: { role: string; path: string; reason: KeptCheckoutReason; detail?: string }[];
    absent: string[];
  }
  | { kind: "skill-remove"; removed: boolean }
  | {
    kind: "runtimes-setup";
    wrappers: { codex: boolean; opencode: boolean };
    codex: { version: string | null; loggedIn: boolean | null };
    opencode: { version: string | null; keyPresent: boolean | null };
  }
  | {
    kind: "ensure-project"; repoPath: string; cloned: boolean;
    checkouts: { role: string; path: string; head: string }[]; companions: { name: string; path: string }[];
  }
  | { kind: "bug-finding-review"; accepted: true };

export type JobErrorCode =
  | "folder_not_git" | "folder_forbidden" | "folder_missing" | "checkout_exists" | "git_failed" | "clone_auth_failed"
  | "skill_fetch_failed" | "check_failed" | "lease_expired" | "app_error"
  /** `bug-finding-review`: máy không có repo của project, không thấy app Bug Finding nhúng, bản cài riêng cũ đang chạy. */
  | "project_missing" | "bug_finding_missing" | "standalone_running";

export const JOB_ERROR_CODES: readonly JobErrorCode[] = [
  "folder_not_git", "folder_forbidden", "folder_missing", "checkout_exists", "git_failed", "clone_auth_failed",
  "skill_fetch_failed", "check_failed", "lease_expired", "app_error", "project_missing", "bug_finding_missing",
  "standalone_running",
];

/** A claimed job the app has not reported within this window goes back to the queue (always longer than the app's 15 minutes). */
export const JOB_LEASE_MINUTES = 17;
/** Lease expiries after which a job stops being retried automatically. */
export const JOB_MAX_ATTEMPTS = 3;
export const JOB_LIST_LIMIT = 100;
