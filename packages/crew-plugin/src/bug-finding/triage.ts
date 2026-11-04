import { jsonObject } from "../shared/db.js";
import type { BugFindingRun } from "./runs.js";

/**
 * Kế hoạch xử lý finding của Trợ Lý cho một lượt Bug Finding (comment `crew-bf-triage`, template `crew/agents/assistant.md`):
 * dòng đầu `crew-bf-triage run=<n> batch=bf-fix-<k> fix=<F-..> ask=<F-..> dismiss=<F-..>` (nhóm rỗng ghi `-`), các dòng sau
 * `F-xx: <lý do>`. Web chia finding của lượt thành ba nhóm theo kế hoạch này; chỉ tin comment do đúng Trợ Lý của ticket viết.
 */
export interface BugFindingTriage {
  run: number;
  batch: number;
  fix: string[];
  ask: string[];
  dismiss: string[];
  reasons: Record<string, string>;
}

/** Việc con sửa finding (mô tả có `crew-bf finding=<F-xx[,F-yy]> run=<n>`). */
export interface BugFindingFixIssue { id: string; identifier: string | null; status: string }

export interface BugFindingRunTriage extends BugFindingTriage {
  createdAt: string;
  /** Việc con sửa theo id finding, tạo sau kế hoạch và trước lượt kế tiếp. */
  fixIssues: Record<string, BugFindingFixIssue[]>;
}

type Comment = { authorAgentId?: string | null; body: string; createdAt: Date | string };
type Child = BugFindingFixIssue & { description: string | null; createdAt: Date | string };

const TRIAGE = /^crew-bf-triage run=([1-9][0-9]*) batch=bf-fix-([1-9][0-9]*) fix=(\S+) ask=(\S+) dismiss=(\S+)\s*$/;
const REASON = /^(F-[0-9A-Za-z]+):\s*(.+)$/;
const FIX_LINE = /(?:^|\n)crew-bf finding=(\S+) run=([1-9][0-9]*)(?=[ \t\r]|\n|$)/;

const ids = (group: string) => group === "-" ? [] : group.split(",").map((id) => id.trim()).filter(Boolean);
const time = (value: Date | string) => new Date(value).getTime();

export function parseTriage(body: string): BugFindingTriage | null {
  const [first = "", ...rest] = body.split(/\r?\n/);
  const match = TRIAGE.exec(first.trim());
  if (!match) return null;
  const reasons: Record<string, string> = {};
  for (const line of rest) {
    const reason = REASON.exec(line.trim());
    if (reason && !(reason[1]! in reasons)) reasons[reason[1]!] = reason[2]!.trim();
  }
  return { run: Number(match[1]), batch: Number(match[2]), fix: ids(match[3]!), ask: ids(match[4]!), dismiss: ids(match[5]!), reasons };
}

/**
 * Trợ Lý của ticket tổng: `returnAssignee` khi ticket đang ở stage review (người nhận lại việc), không thì người được giao
 * hiện tại nếu đó không phải agent của stage gộp/cầu nối.
 */
export function triageAuthor(
  issue: { executionState?: unknown; assigneeAgentId?: string | null },
  roles: { integratorId: string; reviewerId: string },
): string | null {
  const back = jsonObject(jsonObject(issue.executionState)?.returnAssignee);
  if (back?.type === "agent" && typeof back.agentId === "string") return back.agentId;
  const assignee = issue.assigneeAgentId ?? null;
  return assignee && assignee !== roles.integratorId && assignee !== roles.reviewerId ? assignee : null;
}

/**
 * Gắn kế hoạch của Trợ Lý vào từng lượt `succeeded` (`runs` mới nhất trước): comment `crew-bf-triage run=<lượt>` mới nhất
 * của Trợ Lý viết sau khi lượt xong và trước lượt kế tiếp; kèm việc con sửa của lô tạo trong cùng khoảng đó.
 */
export function attachTriage<R extends BugFindingRun>(
  runs: readonly R[], comments: readonly Comment[], assistantId: string | null, children: readonly Child[],
): (R & { triage: BugFindingRunTriage | null })[] {
  const plans = assistantId
    ? comments.filter((comment) => comment.authorAgentId === assistantId)
      .map((comment) => ({ at: time(comment.createdAt), createdAt: new Date(comment.createdAt).toISOString(), plan: parseTriage(comment.body) }))
      .filter((item): item is { at: number; createdAt: string; plan: BugFindingTriage } => item.plan !== null)
      .sort((a, b) => b.at - a.at)
    : [];
  const starts = runs.map((run) => time(run.createdAt));
  return runs.map((run) => {
    if (run.state !== "succeeded") return { ...run, triage: null };
    const from = time(run.finishedAt ?? run.createdAt);
    const until = Math.min(...starts.filter((start) => start > time(run.createdAt)), Number.POSITIVE_INFINITY);
    const found = plans.find((item) => item.plan.run === run.run && item.at >= from && item.at < until);
    if (!found) return { ...run, triage: null };
    const fixIssues: Record<string, BugFindingFixIssue[]> = {};
    for (const child of children) {
      const line = FIX_LINE.exec(child.description ?? "");
      const at = time(child.createdAt);
      if (!line || Number(line[2]) !== run.run || at < found.at || at >= until) continue;
      for (const id of ids(line[1]!)) (fixIssues[id] ??= []).push({ id: child.id, identifier: child.identifier, status: child.status });
    }
    return { ...run, triage: { ...found.plan, createdAt: found.createdAt, fixIssues } };
  });
}
