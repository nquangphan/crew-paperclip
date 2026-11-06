import { randomUUID } from "node:crypto";
import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { insertJob } from "../jobs/data.js";
import { BUG_FINDING_INPUT_MAX, type JobPayload, type PrProvider } from "../jobs/types.js";
import { parsePrUrl, validateJobPayload } from "../jobs/validate.js";
import { pinnedMachineOfIssue } from "../runtimes/machine.js";
import { checkedId, jsonObject, pluginNamespace, UUID } from "../shared/db.js";
import { crewPolicyKind } from "../shared/policy.js";
import {
  announceRun, approvalRound, BROKEN_RUN_STATES, type BugFindingRun, cut, errText, getRunByRequest, listRuns, MAX_RUNS, runsTable,
} from "./runs.js";
import { BUG_FINDING_WATCHDOG_JOB_KEY, runBugFindingWatchdog } from "./watchdog.js";

type Ctx = Pick<PluginContext, "db" | "issues" | "logger">;
type Comment = { authorAgentId?: string | null; body: string; createdAt: Date | string };

/** Khả năng app 2P Crew báo trong bản tin máy (`jobsAgent.capabilities`) khi nhận được việc `bug-finding-review`. */
export const BUG_FINDING_CAPABILITY = "bug-finding-review";
/** Người tạo việc máy do plugin tự xếp (cột `created_by_user_id` bắt buộc). */
const JOB_CREATOR = "crew:bug-finding";
const CREW_PR = /^crew-pr sha=([0-9a-f]{40}) pr=(\S+)$/;
const FEEDBACK_FENCED = /^```crew-bf-feedback[ \t]*\r?\n([\s\S]*?)\r?\n```/m;
const FEEDBACK_BARE = /^crew-bf-feedback[ \t]*\r?\n((?:F-[0-9A-Za-z]+:.*(?:\r?\n|$))+)/m;
const CHECKOUT_REPO = /\/crew-agents\/([a-z][a-z0-9-]{1,30})\/repo\/?$/;
const PROJECT_KEY = /^[a-z][a-z0-9-]{1,30}$/;
const INTEGRATOR_NAME = /^([a-z][a-z0-9-]{1,30})-integrator$/;

export const NOT_CAPABLE_ERROR = "Mac chưa cập nhật 2P Crew có Bug Finding";

/** Agent và owner của ticket tổng `code-bf` đang ở stage cầu nối (stage 1), hoặc `null`. */
export interface BridgeStage { integratorId: string; reviewerId: string; ownerUserId: string | null }

function stageAgent(stage: unknown): string | null {
  const participants = jsonObject(stage)?.participants;
  const first = Array.isArray(participants) ? jsonObject(participants[0]) : null;
  return first?.type === "agent" && typeof first.agentId === "string" ? first.agentId : null;
}

/** Ticket tổng `code-bf` (kể cả khi không ở stage cầu nối): agent stage gộp, reviewer cầu nối, owner. */
export function bugFindingRoles(issue: Issue): BridgeStage | null {
  if (crewPolicyKind(issue.executionPolicy) !== "code-bf") return null;
  const stages = jsonObject(issue.executionPolicy)!.stages as unknown[];
  const owner = jsonObject((jsonObject(stages[2])?.participants as unknown[] | undefined)?.[0]);
  return {
    integratorId: stageAgent(stages[0])!, reviewerId: stageAgent(stages[1])!,
    ownerUserId: owner?.type === "user" && typeof owner.userId === "string" ? owner.userId : null,
  };
}

export function bridgeStage(issue: Issue): BridgeStage | null {
  const roles = bugFindingRoles(issue);
  if (!roles || issue.status !== "in_review") return null;
  const stages = jsonObject(issue.executionPolicy)!.stages as unknown[];
  return jsonObject(issue.executionState)?.currentStageId === jsonObject(stages[1])?.id ? roles : null;
}

const time = (value: Date | string) => new Date(value).getTime();
const newestFirst = (comments: readonly Comment[]) => [...comments].sort((a, b) => time(b.createdAt) - time(a.createdAt));

/**
 * `crew-pr` mới nhất có URL hợp lệ của agent stage gộp: head PR (merged commit), URL, số PR GitHub (`/pull/N`) hoặc số MR GitLab
 * (`/-/merge_requests/N`, tức `iid`) và provider theo URL.
 */
export function latestCrewPr(comments: readonly Comment[], integratorId: string):
  { sha: string; prUrl: string; prNumber: number; provider: PrProvider } | null {
  for (const comment of newestFirst(comments)) {
    if (comment.authorAgentId !== integratorId) continue;
    const match = CREW_PR.exec(comment.body.split("\n", 1)[0]?.trim() ?? "");
    const pr = match ? parsePrUrl(match[2]!) : null;
    if (match && pr) return { sha: match[1]!, prUrl: match[2]!, prNumber: pr.number, provider: pr.provider };
  }
  return null;
}

/**
 * Phản hồi người review cho lượt chạy lại: khối `crew-bf-feedback` (khối code có nhãn đó, hoặc dòng `crew-bf-feedback` rồi các
 * dòng `F-xx: …`) trong comment mới nhất có khối này của Trợ Lý, viết sau lượt trước. Chưa có lượt trước thì không có phản hồi.
 */
export function feedbackText(comments: readonly Comment[], assistantId: string | null, since: string | null): string | null {
  if (!assistantId || !since) return null;
  for (const comment of newestFirst(comments)) {
    if (comment.authorAgentId !== assistantId || time(comment.createdAt) <= time(since)) continue;
    const block = FEEDBACK_FENCED.exec(comment.body)?.[1] ?? FEEDBACK_BARE.exec(comment.body)?.[1];
    if (block === undefined) continue;
    const text = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
    return text ? cut(text, BUG_FINDING_INPUT_MAX) : null;
  }
  return null;
}

/** Máy ghim của cây: ticket tổng là gốc nên đọc thẳng `issue_machine_pins`; issue con thì đi lên gốc. */
async function pinnedMachine(ctx: Ctx, companyId: string, issue: Issue): Promise<string | null> {
  if (issue.parentId) return pinnedMachineOfIssue(ctx, companyId, issue.id);
  const rows = await ctx.db.query<{ machine_id: string }>(`SELECT machine_id::text AS machine_id FROM ${pluginNamespace(ctx)}.issue_machine_pins
    WHERE company_id = $1 AND root_issue_id = $2`, [companyId, checkedId(issue.id)]);
  return rows[0]?.machine_id ?? null;
}

type MachineChoice = { machineId: string; repoPath: string } | { machineId: string | null; error: string };

/**
 * Máy chạy Bug Finding: máy đã ghim cho cây (`issue_machine_pins`), không ghim thì máy `ready` của project trong
 * `project_machines`. Máy phải có repo của project và app báo khả năng `bug-finding-review` trong bản tin máy. Dòng còn
 * `provisioning` mà việc `ensure-project` mới nhất của project trên máy đã `done` kèm `repoPath` tuyệt đối thì repo đã có
 * trên máy: dùng `repoPath` đó (chỉ đọc; server mới đối chiếu dòng sang `ready`). Dòng `ready` có `repo_path` tuyệt đối
 * dùng đúng repo đó; dòng `ready` thiếu repo (dòng cũ trước khi server luôn ghi repo) thử, theo thứ tự, `repoPath` tuyệt đối
 * của việc `ensure-project` mới nhất đã `done` trên máy rồi repo gốc bước `inspect` của lần thêm project mới nhất trên máy
 * (cùng nguồn server ghi cho máy chính, `knownRepoPath`); không có nguồn nào thì máy không dùng được. Dòng `failed` không
 * dùng được. Chỉ đọc, không ghi lại dòng.
 */
async function chooseMachine(ctx: Ctx, companyId: string, issue: Issue): Promise<MachineChoice> {
  const projectId = issue.projectId;
  if (!projectId) return { machineId: null, error: "Ticket tổng chưa gắn project" };
  const ns = pluginNamespace(ctx);
  const pinned = await pinnedMachine(ctx, companyId, issue);
  const rows = await ctx.db.query<{ machine_id: string; repo_path: string | null; status: string; capable: boolean | null }>(
    `SELECT m.machine_id::text AS machine_id,
       CASE WHEN ej.status = 'done' THEN ej.repo_path ELSE COALESCE(dj.repo_path, sr.root, pm.repo_path) END AS repo_path,
       CASE WHEN ej.status = 'done' THEN 'ready' ELSE COALESCE(pm.status, 'absent') END AS status,
       (l.report->'jobsAgent'->'capabilities') @> '["${BUG_FINDING_CAPABILITY}"]'::jsonb AS capable
     FROM (SELECT machine_id FROM ${ns}.project_machines WHERE company_id = $1 AND project_id = $2
           UNION SELECT $3::uuid WHERE $3::uuid IS NOT NULL) m
     LEFT JOIN ${ns}.project_machines pm ON pm.company_id = $1 AND pm.project_id = $2 AND pm.machine_id = m.machine_id
     LEFT JOIN LATERAL (SELECT j.status, j.result->>'repoPath' AS repo_path FROM ${ns}.crew_machine_jobs j
       WHERE j.company_id = $1 AND j.machine_id = m.machine_id AND j.kind = 'ensure-project'
         AND j.payload->>'projectId' = $2::text ORDER BY j.created_at DESC, j.id DESC LIMIT 1) ej ON pm.status = 'provisioning'
     LEFT JOIN LATERAL (SELECT j.result->>'repoPath' AS repo_path FROM ${ns}.crew_machine_jobs j
       WHERE j.company_id = $1 AND j.machine_id = m.machine_id AND j.kind = 'ensure-project' AND j.status = 'done'
         AND j.payload->>'projectId' = $2::text AND j.result->>'repoPath' LIKE '/%'
       ORDER BY j.created_at DESC, j.id DESC LIMIT 1) dj ON pm.status = 'ready' AND COALESCE(pm.repo_path, '') NOT LIKE '/%'
     LEFT JOIN LATERAL (SELECT r.steps->'inspect'->'refs'->>'root' AS root FROM ${ns}.crew_setup_runs r
       WHERE r.company_id = $1 AND r.project_id = $2 AND r.machine_id = m.machine_id AND r.kind = 'add-project'
         AND r.steps->'inspect'->>'status' = 'done' AND r.steps->'inspect'->'refs'->>'root' LIKE '/%'
       ORDER BY r.updated_at DESC, r.id DESC LIMIT 1) sr ON pm.status = 'ready' AND COALESCE(pm.repo_path, '') NOT LIKE '/%'
     LEFT JOIN ${ns}.machine_latest l ON l.company_id = $1 AND l.machine_id = m.machine_id
     ORDER BY pm.updated_at DESC NULLS LAST, m.machine_id`,
    [companyId, checkedId(projectId), pinned],
  );
  const usable = (row: (typeof rows)[number]) => row.status === "ready" && !!row.repo_path?.startsWith("/");
  if (pinned) {
    const row = rows.find((item) => item.machine_id === pinned)!;
    if (row.capable !== true) return { machineId: pinned, error: NOT_CAPABLE_ERROR };
    return usable(row) ? { machineId: pinned, repoPath: row.repo_path! } : { machineId: pinned, error: "Máy đã ghim chưa có repo của project" };
  }
  const ready = rows.filter(usable);
  if (ready.length === 0) return { machineId: null, error: "Project chưa có máy sẵn sàng" };
  const capable = ready.find((row) => row.capable === true);
  return capable ? { machineId: capable.machine_id, repoPath: capable.repo_path! } : { machineId: ready[0]!.machine_id, error: NOT_CAPABLE_ERROR };
}

/**
 * Khóa project trên Mac, theo thứ tự: lần thêm project của wizard; đường repo `~/crew-agents/<khóa>/repo`; tên agent
 * integrator của ticket (`<khóa>-integrator`, cách app 2P Crew và crew-mac đặt tên agent vai trò). Project dựng bằng
 * crew-mac hay repo nằm ngoài `~/crew-agents` chỉ có nguồn thứ ba.
 */
async function projectKeyOf(ctx: Ctx, companyId: string, projectId: string, repoPath: string, integratorId: string): Promise<string | null> {
  const rows = await ctx.db.query<{ project_key: string | null }>(`SELECT project_key FROM ${pluginNamespace(ctx)}.crew_setup_runs
    WHERE company_id = $1 AND project_id = $2 AND kind = 'add-project' AND project_key IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
  [companyId, checkedId(projectId)]);
  const known = rows[0]?.project_key ?? CHECKOUT_REPO.exec(repoPath)?.[1] ?? null;
  if (known && PROJECT_KEY.test(known)) return known;
  const agents = await ctx.db.query<{ name: string }>("SELECT name FROM public.agents WHERE id = $1 AND company_id = $2",
    [checkedId(integratorId), companyId]);
  const named = INTEGRATOR_NAME.exec(agents[0]?.name ?? "")?.[1] ?? null;
  return named && PROJECT_KEY.test(named) ? named : null;
}

async function baseBranchOf(ctx: Ctx, companyId: string, projectId: string): Promise<string> {
  const rows = await ctx.db.query<{ branch: string }>(`SELECT branch FROM ${pluginNamespace(ctx)}.project_repos
    WHERE company_id = $1 AND project_id = $2`, [companyId, checkedId(projectId)]);
  return rows[0]?.branch ?? "main";
}

export type EnqueueOutcome =
  | { run: BugFindingRun; created: boolean }
  | { run: null; reason: "not_bug_finding_root" | "pr_missing" | "runs_exhausted" };

/**
 * Xếp một lượt Bug Finding cho head PR hiện tại của ticket tổng `code-bf` (`crew-pr` mới nhất của integrator stage gộp):
 * - đã có lượt cho cùng vòng + head thì trả lượt đó; `retry` (reviewer xếp lại) chỉ xếp lượt mới khi lượt mới nhất của head
 *   đó hỏng (`failed`, `timeout`, `cancelled`);
 * - `run` = số lượt trong vòng + 1; vòng đã đủ 3 lượt thì không xếp;
 * - không có máy dùng được thì ghi lượt `failed` có lý do, không xếp việc máy.
 * Hai lần gọi đồng thời chỉ một lần ghi được (khóa duy nhất `(issue_id, approval_round, head_sha, run)`).
 */
export async function enqueueBugFinding(ctx: Ctx, issue: Issue, options: { retry?: boolean } = {}): Promise<EnqueueOutcome> {
  const roles = bugFindingRoles(issue);
  if (!roles) return { run: null, reason: "not_bug_finding_root" };
  const companyId = checkedId(issue.companyId);
  const comments = await ctx.issues.listComments(issue.id, companyId) as Comment[];
  const pr = latestCrewPr(comments, roles.integratorId);
  if (!pr) return { run: null, reason: "pr_missing" };
  const round = await approvalRound(ctx, companyId, issue.id);
  const runs = await listRuns(ctx, companyId, issue.id);
  const inRound = runs.filter((run) => run.approvalRound === round);
  const latestForHead = inRound.find((run) => run.headSha === pr.sha);
  if (latestForHead && !(options.retry && BROKEN_RUN_STATES.includes(latestForHead.state))) return { run: latestForHead, created: false };
  if (inRound.length >= MAX_RUNS) return { run: null, reason: "runs_exhausted" };

  const runNo = Math.max(0, ...inRound.map((run) => run.run)) + 1;
  const requestId = randomUUID();
  const machine = await chooseMachine(ctx, companyId, issue);
  const assistantId = jsonObject(jsonObject(issue.executionState)?.returnAssignee)?.agentId;
  const feedback = feedbackText(comments, typeof assistantId === "string" ? assistantId : null, runs[0]?.createdAt ?? null);

  let error = "error" in machine ? machine.error : null;
  let payload: JobPayload | string | null = null;
  if (!error && "repoPath" in machine) {
    const projectKey = await projectKeyOf(ctx, companyId, issue.projectId!, machine.repoPath, roles.integratorId);
    payload = projectKey
      ? validateJobPayload("bug-finding-review", {
        requestId, issueId: issue.id, identifier: issue.identifier, run: runNo, projectId: issue.projectId, projectKey,
        repoPath: machine.repoPath, provider: pr.provider, prNumber: pr.prNumber, prUrl: pr.prUrl, headSha: pr.sha,
        baseBranch: await baseBranchOf(ctx, companyId, issue.projectId!), ...(feedback ? { reviewerInputText: feedback } : {}),
      })
      : "Không xác định được khóa project trên máy";
    if (typeof payload === "string") error = cut(payload);
  }

  const { rowCount } = await ctx.db.execute(`INSERT INTO ${runsTable(ctx)} (company_id,issue_id,approval_round,run,request_id,machine_id,
      head_sha,pr_url,state,feedback_text,error,finished_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $9 = 'failed' THEN now() END)
    ON CONFLICT (issue_id, approval_round, head_sha, run) DO NOTHING`,
  [companyId, checkedId(issue.id), round, runNo, requestId, machine.machineId, pr.sha, pr.prUrl, error ? "failed" : "requested",
    feedback, error]);
  if (rowCount !== 1) {
    // Lần gọi khác vừa ghi cùng lượt: trả lượt đó.
    const winner = (await listRuns(ctx, companyId, issue.id)).find((run) => run.approvalRound === round && run.headSha === pr.sha);
    return winner ? { run: winner, created: false } : { run: null, reason: "runs_exhausted" };
  }
  if (!error && payload && typeof payload !== "string") {
    try {
      const job = await insertJob(ctx, { companyId, machineId: machine.machineId!, payload, setupRunId: null, createdByUserId: JOB_CREATOR });
      await ctx.db.execute(`UPDATE ${runsTable(ctx)} SET machine_job_id = $3, updated_at = now() WHERE company_id = $1 AND request_id = $2`,
        [companyId, requestId, job.id]);
    } catch (jobError) {
      ctx.logger.error("crew bug finding job insert failed", { issueId: issue.id, requestId, err: errText(jobError) });
      await ctx.db.execute(`UPDATE ${runsTable(ctx)} SET state = 'failed', error = $3, finished_at = now(), updated_at = now()
        WHERE company_id = $1 AND request_id = $2`, [companyId, requestId, "Không xếp được việc lên máy"]);
    }
  }
  ctx.logger.info("crew bug finding run requested", { issueId: issue.id, companyId, requestId, run: runNo, machineId: machine.machineId, error });
  return { run: (await getRunByRequest(ctx, companyId, requestId))!, created: true };
}

/**
 * Sự kiện `issue.updated`: ticket tổng `code-bf` vừa vào stage cầu nối thì xếp Bug Finding cho head PR (một lần cho mỗi vòng +
 * head). Lượt hỏng ngay khi xếp (máy chưa có app) thì báo và đánh thức reviewer.
 */
export async function handleIssueUpdated(ctx: Ctx, event: PluginEvent): Promise<void> {
  const companyId = event.companyId;
  const issueId = event.entityId;
  if (event.entityType !== "issue" || !companyId || !UUID.test(companyId) || !issueId || !UUID.test(issueId)) return;
  try {
    const issue = await ctx.issues.get(issueId, companyId);
    if (!issue || !bridgeStage(issue)) return;
    const outcome = await enqueueBugFinding(ctx, issue);
    if (outcome.run && outcome.created && outcome.run.state === "failed") await announceRun(ctx, issue, outcome.run);
  } catch (error) {
    ctx.logger.warn("crew bug finding enqueue failed", { companyId, issueId, err: errText(error) });
  }
}

export function registerBugFinding(ctx: PluginContext): void {
  ctx.events.on("issue.updated", (event) => handleIssueUpdated(ctx, event));
  ctx.jobs.register(BUG_FINDING_WATCHDOG_JOB_KEY, async () => { await runBugFindingWatchdog(ctx, new Date()); });
}
