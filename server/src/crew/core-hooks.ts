import type { Db, heartbeatRuns, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import type { EnvironmentDriverReleaseInput } from "../services/environment-runtime.js";
import { crewBeforeIssueCreate } from "./issue-create-policy.js";
import { crewBeforeIssueWrite } from "./issue-gate.js";
import { applyBundleResumeSafely } from "./bundle-resume.js";
import { crewBeforeClaim } from "./load-gate.js";
import { startRemoteStopOnRelease } from "./remote-stop.js";

/** H1: gọi ở dòng đầu `claimQueuedRun` trong `heartbeatService(db)`. */
export interface BeforeClaimInput {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}

/** H2: gọi ở dòng đầu `runUpdate` (closure trong `issueService(db).update`), trước khi khóa dòng issue. */
export interface BeforeIssueWriteInput {
  /** Handle transaction của `runUpdate`; lệnh đọc/ghi qua `tx` nằm cùng transaction với lệnh ghi issue. */
  tx: Db;
  issueId: string;
  /** Bản issue đọc trước khi khóa dòng. Cần số liệu chắc chắn thì đọc lại qua `tx` với `.for("update")`. */
  existing: typeof issues.$inferSelect;
  /**
   * Các cột sắp ghi, kể cả `status` và `executionPolicy` nếu request gửi lên. Chính object này được ghi xuống DB.
   * Ngoại lệ duy nhất được sửa: Crew đặt `executionState = null` khi issue có policy rời `done`/`cancelled`.
   */
  patch: Partial<typeof issues.$inferInsert>;
  actorAgentId: string | null | undefined;
  actorUserId: string | null | undefined;
}

/** H4: gọi ở dòng đầu `issueService(db).create`, trước mọi kiểm tra; giá trị trả về thay cho `data`. */
export interface IssueCreateLike {
  parentId?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  assigneeAgentId?: string | null;
  status?: string | null;
  originKind?: string | null;
  originId?: string | null;
  executionPolicy?: unknown;
}

export interface BeforeIssueCreateInput<T extends IssueCreateLike> {
  db: Db;
  companyId: string;
  data: T;
}

/**
 * H3: gọi ở dòng đầu `releaseRunLease` của SSH driver, trước `environmentsSvc.releaseLease`.
 * `db` là tham số `db` của `createSshEnvironmentDriver(db: Db)`; implementation cần nó để giải private key SSH
 * từ secret của Paperclip (server không có `db` dùng chung).
 * Hook nhận mọi lease SSH được trả, kể cả lease không gắn run (`lease.heartbeatRunId === null`): lease của probe
 * (`environment-probe.ts`), device-login và setup-token transport binding. Implementation phải trả về ngay khi
 * lease không gắn run.
 */
export type RunLeaseReleasedInput = EnvironmentDriverReleaseInput & { db: Db };

export interface CrewCoreHooks {
  /** Trả `true` để giữ run ở `queued` (`claimQueuedRun` trả `null`, scheduler thử lại ở tick sau). Run không ở `queued` thì phải trả `false`.
   * Khi trả `false`, Crew có thể ghi `resumeFromRunId`, `resumeSessionParams`, `resumeSessionDisplayId`
   * vào `run.contextSnapshot` (DB và object run) trước khi claim.
   */
  beforeClaim(input: BeforeClaimInput): Promise<boolean>;
  /** Ném `HttpError` (ví dụ `unprocessable(...)` từ `server/src/errors.ts`) để chặn lệnh ghi; transaction rollback. Trả bình thường để cho ghi. */
  beforeIssueWrite(input: BeforeIssueWriteInput): Promise<void>;
  /** Trả `data` (có thể đã gắn `executionPolicy` template Crew); ném `HttpError` để từ chối tạo issue. */
  beforeIssueCreate<T extends IssueCreateLike>(input: BeforeIssueCreateInput<T>): Promise<T>;
  /**
   * Dừng phần việc còn chạy phía remote của run gắn với lease. Trả về ngay khi `lease.heartbeatRunId` là `null`.
   * Bản Crew ghi dấu `crew.remote_stop.started`, khởi động lệnh dừng chạy nền rồi trả về, để lease được nhả trước khi SSH xong (xem
   * `startRemoteStopOnRelease`). Lỗi bị nuốt và ghi log; quá `CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS` thì wrapper
   * bỏ chờ, ghi log và trả về, để lease vẫn được trả.
   */
  onRunLeaseReleased(input: RunLeaseReleasedInput): Promise<void>;
}

/** Thời hạn chờ `onRunLeaseReleased` trước khi bỏ chờ và trả lease (Mac ngủ, TCP không RST). */
export const CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS = 15_000;

const implementations: CrewCoreHooks = {
  beforeClaim: async (input) => {
    if (await crewBeforeClaim(input)) return true;
    await applyBundleResumeSafely(input);
    return false;
  },
  beforeIssueWrite: crewBeforeIssueWrite,
  beforeIssueCreate: crewBeforeIssueCreate,
  onRunLeaseReleased: async (input) => {
    await startRemoteStopOnRelease(input);
  },
};

export const crewCoreHooks: CrewCoreHooks = {
  beforeClaim: (input) => implementations.beforeClaim(input),
  beforeIssueWrite: (input) => implementations.beforeIssueWrite(input),
  beforeIssueCreate: (input) => implementations.beforeIssueCreate(input),
  async onRunLeaseReleased(input) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS);
    });
    try {
      const outcome = await Promise.race([
        Promise.resolve()
          .then(() => implementations.onRunLeaseReleased(input))
          .then(() => "done" as const),
        timedOut,
      ]);
      if (outcome === "timeout") {
        logger.warn(
          {
            leaseId: input.lease.id,
            environmentId: input.environment.id,
            status: input.status,
            timeoutMs: CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS,
          },
          "crew onRunLeaseReleased timed out; releasing the lease anyway",
        );
      }
    } catch (error) {
      logger.warn(
        { err: error, leaseId: input.lease.id, environmentId: input.environment.id, status: input.status },
        "crew onRunLeaseReleased failed; releasing the lease anyway",
      );
    } finally {
      clearTimeout(timer);
    }
  },
};

export function overrideCrewCoreHooksForTests(partial: Partial<CrewCoreHooks>): () => void {
  const previous = { ...implementations };
  Object.assign(implementations, partial);
  return () => {
    Object.assign(implementations, previous);
  };
}
