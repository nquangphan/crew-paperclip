// Kiểu dữ liệu Bug Finding cho web (chỉ kiểu: module lượt và kế hoạch dùng helper DB của plugin lúc chạy).
import type { BugFindingRun } from "../bug-finding/runs.js";
import type { BugFindingRunTriage } from "../bug-finding/triage.js";

export type { BugFindingFinding, BugFindingRun, BugFindingRunState, BugFindingVerdict } from "../bug-finding/runs.js";
export type { BugFindingFixIssue, BugFindingRunTriage } from "../bug-finding/triage.js";

/** Một lượt kèm kế hoạch xử lý của Trợ Lý (chỉ lượt `succeeded` đã được phân loại mới có). */
export type BugFindingRunView = BugFindingRun & { triage: BugFindingRunTriage | null };

/** Body của `GET /api/plugins/crew.core/api/issues/:issueId/bug-finding`. */
export interface BugFindingView {
  runs: BugFindingRunView[];
  batchesUsed: number;
  maxBatches: number;
  currentHead: string | null;
  approvalRound: number;
}
