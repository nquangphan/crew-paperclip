import type { Db, heartbeatRuns, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import type { EnvironmentDriverReleaseInput } from "../services/environment-runtime.js";

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
 */
export type RunLeaseReleasedInput = EnvironmentDriverReleaseInput & { db: Db };

export interface CrewCoreHooks {
  /** Trả `true` để giữ run ở `queued` (`claimQueuedRun` trả `null`, scheduler thử lại ở tick sau). Run không ở `queued` thì phải trả `false`. */
  beforeClaim(input: BeforeClaimInput): Promise<boolean>;
  /** Ném `HttpError` (ví dụ `unprocessable(...)` từ `server/src/errors.ts`) để chặn lệnh ghi; transaction rollback. Trả bình thường để cho ghi. */
  beforeIssueWrite(input: BeforeIssueWriteInput): Promise<void>;
  /** Dừng phần việc còn chạy phía remote. Lỗi bị nuốt và ghi log để lease vẫn được trả. */
  onRunLeaseReleased(input: RunLeaseReleasedInput): Promise<void>;
}

const implementations: CrewCoreHooks = {
  beforeClaim: async () => false,
  beforeIssueWrite: async () => {},
  onRunLeaseReleased: async () => {},
};

export const crewCoreHooks: CrewCoreHooks = {
  beforeClaim: (input) => implementations.beforeClaim(input),
  beforeIssueWrite: (input) => implementations.beforeIssueWrite(input),
  async onRunLeaseReleased(input) {
    try {
      await implementations.onRunLeaseReleased(input);
    } catch (error) {
      logger.warn(
        { err: error, leaseId: input.lease.id, environmentId: input.environment.id, status: input.status },
        "crew onRunLeaseReleased failed; releasing the lease anyway",
      );
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
