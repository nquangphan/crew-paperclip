import type { Db, heartbeatRuns, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import type { EnvironmentDriverReleaseInput } from "../services/environment-runtime.js";
import { stopRemoteRunOnRelease } from "./remote-stop.js";

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
  /** Các cột sắp ghi, kể cả `status` và `executionPolicy` nếu request gửi lên. Không được sửa. */
  patch: Readonly<Partial<typeof issues.$inferInsert>>;
  actorAgentId: string | null | undefined;
  actorUserId: string | null | undefined;
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
  /** Trả `true` để giữ run ở `queued` (`claimQueuedRun` trả `null`, scheduler thử lại ở tick sau). Run không ở `queued` thì phải trả `false`. */
  beforeClaim(input: BeforeClaimInput): Promise<boolean>;
  /** Ném `HttpError` (ví dụ `unprocessable(...)` từ `server/src/errors.ts`) để chặn lệnh ghi; transaction rollback. Trả bình thường để cho ghi. */
  beforeIssueWrite(input: BeforeIssueWriteInput): Promise<void>;
  /**
   * Dừng phần việc còn chạy phía remote của run gắn với lease. Trả về ngay khi `lease.heartbeatRunId` là `null`.
   * Lỗi bị nuốt và ghi log; quá `CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS` thì wrapper bỏ chờ, ghi log và trả về,
   * để lease vẫn được trả.
   */
  onRunLeaseReleased(input: RunLeaseReleasedInput): Promise<void>;
}

/** Thời hạn chờ `onRunLeaseReleased` trước khi bỏ chờ và trả lease (Mac ngủ, TCP không RST). */
export const CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS = 15_000;

const implementations: CrewCoreHooks = {
  beforeClaim: async () => false,
  beforeIssueWrite: async () => {},
  onRunLeaseReleased: async (input) => {
    await stopRemoteRunOnRelease(input);
  },
};

export const crewCoreHooks: CrewCoreHooks = {
  beforeClaim: (input) => implementations.beforeClaim(input),
  beforeIssueWrite: (input) => implementations.beforeIssueWrite(input),
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
