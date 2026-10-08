import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { type Db, issues } from "@paperclipai/db";
import type { IssueExecutionPolicy } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { normalizeIssueExecutionPolicy, parseIssueExecutionState } from "../services/issue-execution-policy.js";

/** Vòng review agent↔agent tối đa của mọi issue Crew; tới vòng này stage được giao cho owner. */
export const CREW_MAX_REVIEW_ROUNDS = 5;
export const CREW_RESEARCH_LABEL = "research";

export interface CrewRoles {
  reviewerAgentId: string;
  integratorAgentId: string;
}

/** Env trỏ tới file JSON chỉ đọc cấu hình vai trò Crew theo company. */
export const CREW_POLICY_CONFIG_ENV = "CREW_POLICY_CONFIG";

/**
 * Cấu hình Crew của một company:
 * - `absent`: company không có trong file (hoặc không đặt env) → H2/H4 không áp gì, hành vi Paperclip gốc.
 * - `invalid`: company có mặt mà cấu hình lỗi (hoặc cả file không đọc/parse được) → fail closed.
 * - `ok`: vai trò và owner duyệt cuối.
 */
export type CrewCompanyConfig =
  | { kind: "absent" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; roles: CrewRoles; ownerUserId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Dạng file: `{ "companies": { "<companyId>": { reviewerAgentId, integratorAgentId, ownerUserId } } }`. */
export function parseCrewPolicyConfig(text: string, companyId: string): CrewCompanyConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid", reason: `JSON không hợp lệ: ${(error as Error).message}` };
  }
  if (!isRecord(parsed) || !isRecord(parsed.companies)) {
    return { kind: "invalid", reason: "thiếu object `companies`" };
  }
  // uuid company có thể được ghi hoa hoặc thường trong file; so khớp không phân biệt hoa thường.
  const wanted = companyId.toLowerCase();
  const keys = Object.keys(parsed.companies).filter((key) => key.toLowerCase() === wanted);
  if (keys.length === 0) return { kind: "absent" };
  if (keys.length > 1) return { kind: "invalid", reason: `companies có ${keys.length} key trùng ${companyId} khi bỏ hoa thường` };
  const entry = parsed.companies[keys[0] as string];
  if (!isRecord(entry)) return { kind: "invalid", reason: `companies.${companyId} không phải object` };
  const { reviewerAgentId, integratorAgentId, ownerUserId } = entry;
  if (typeof reviewerAgentId !== "string" || !UUID_RE.test(reviewerAgentId)) {
    return { kind: "invalid", reason: `companies.${companyId}.reviewerAgentId phải là uuid` };
  }
  if (typeof integratorAgentId !== "string" || !UUID_RE.test(integratorAgentId)) {
    return { kind: "invalid", reason: `companies.${companyId}.integratorAgentId phải là uuid` };
  }
  if (reviewerAgentId.toLowerCase() === integratorAgentId.toLowerCase()) {
    return { kind: "invalid", reason: `companies.${companyId}: reviewer và integrator phải là hai agent khác nhau` };
  }
  if (typeof ownerUserId !== "string" || ownerUserId.trim() === "") {
    return { kind: "invalid", reason: `companies.${companyId}.ownerUserId phải là chuỗi khác rỗng` };
  }
  return {
    kind: "ok",
    roles: { reviewerAgentId: reviewerAgentId.toLowerCase(), integratorAgentId: integratorAgentId.toLowerCase() },
    ownerUserId: ownerUserId.trim(),
  };
}

/**
 * Issue nội bộ do hệ thống Paperclip tự sinh (watchdog, recovery, evaluation): không gắn policy Crew khi tạo,
 * và agent được giao vẫn `done` được khi issue không có policy. Giá trị khớp `RECOVERY_ORIGIN_KINDS`,
 * `TASK_WATCHDOG_ORIGIN_KIND`, `TASK_WATCHDOG_PRODUCT_BUG_ORIGIN_KIND` (test kiểm khớp).
 */
export const CREW_HOUSEKEEPING_ORIGIN_KINDS: readonly string[] = [
  "harness_liveness_escalation",
  "issue_productivity_review",
  "stranded_issue_recovery",
  "stale_active_run_evaluation",
  "task_watchdog",
  "task_watchdog_product_bug",
];

export function isCrewHousekeepingOrigin(originKind: string | null | undefined): boolean {
  return typeof originKind === "string" && CREW_HOUSEKEEPING_ORIGIN_KINDS.includes(originKind);
}

/** Issue nội bộ của hệ thống: nguồn watchdog/recovery và không có người tạo (agent không tạo được loại này). */
export function isCrewHousekeepingIssue(issue: {
  originKind: string | null | undefined;
  createdByAgentId: string | null | undefined;
  createdByUserId: string | null | undefined;
}): boolean {
  return isCrewHousekeepingOrigin(issue.originKind) && !issue.createdByAgentId && !issue.createdByUserId;
}

/**
 * Issue nguồn của issue watchdog/recovery: `originId` (khi là uuid) trước, vì agent không PATCH được trường này;
 * chỉ rơi về `parentId` (agent đổi được) khi không có `originId`.
 */
export function housekeepingSourceIssueId(issue: {
  parentId?: string | null;
  originId?: string | null;
}): string | null {
  if (issue.originId && UUID_RE.test(issue.originId)) return issue.originId;
  return issue.parentId ?? null;
}

/**
 * Agent đang làm issue nguồn: assignee và `returnAssignee` (khi issue nguồn đang chờ review). Issue
 * watchdog/recovery giao cho chính những agent này không được miễn policy (không tự đẩy việc ra ngoài review).
 */
export async function loadSourceExecutorAgentIds(db: Db, sourceIssueId: string | null): Promise<string[]> {
  if (!sourceIssueId) return [];
  const [source] = await db
    .select({ assigneeAgentId: issues.assigneeAgentId, executionState: issues.executionState })
    .from(issues)
    .where(eq(issues.id, sourceIssueId))
    .limit(1);
  if (!source) return [];
  const returnAssignee = parseIssueExecutionState(source.executionState)?.returnAssignee;
  return [source.assigneeAgentId, returnAssignee?.type === "agent" ? returnAssignee.agentId : null].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

const loggedProblems = new Set<string>();

function logConfigProblem(file: string, companyId: string, reason: string): void {
  const key = `${file}\0${companyId}\0${reason}`;
  if (loggedProblems.has(key)) return;
  loggedProblems.add(key);
  logger.error({ file, companyId, reason }, "crew policy config invalid; Crew gates fail closed for this company");
}

/** Đọc lại file ở mỗi lần gọi (file nhỏ; sửa file có hiệu lực ngay, không cần cache). */
export async function loadCrewCompanyConfig(
  companyId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CrewCompanyConfig> {
  const file = env[CREW_POLICY_CONFIG_ENV]?.trim();
  if (!file) return { kind: "absent" };
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const reason = `không đọc được file: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`;
    logConfigProblem(file, companyId, reason);
    return { kind: "invalid", reason };
  }
  const config = parseCrewPolicyConfig(text, companyId);
  if (config.kind === "invalid") logConfigProblem(file, companyId, config.reason);
  return config;
}

/**
 * Template policy của Crew, đã normalize (có id stage/participant).
 * - con: `[review reviewer]`.
 * - gốc: `[review reviewer, review integrator (merge + docs), approval owner, review integrator (push)]`.
 * - research: `[review reviewer, approval owner]`.
 */
export function buildCrewPolicy(
  kind: "root" | "child" | "research",
  roles: CrewRoles,
  ownerUserId: string | null = null,
): IssueExecutionPolicy {
  const reviewer = { type: "review", participants: [{ type: "agent", agentId: roles.reviewerAgentId }] };
  let stages: unknown[] = [reviewer];
  if (kind !== "child") {
    if (!ownerUserId) throw new Error(`buildCrewPolicy: ${kind} policy needs an owner user id`);
    const owner = { type: "approval", participants: [{ type: "user", userId: ownerUserId }] };
    const integrator = { type: "review", participants: [{ type: "agent", agentId: roles.integratorAgentId }] };
    stages = kind === "root" ? [reviewer, integrator, owner, integrator] : [reviewer, owner];
  }
  const policy = normalizeIssueExecutionPolicy({ stages, maxReviewRounds: CREW_MAX_REVIEW_ROUNDS });
  if (!policy) throw new Error("buildCrewPolicy: template normalized to null");
  return policy;
}

type LooseStage = { id?: unknown; type?: unknown; participants?: unknown };
type LoosePrincipal = { type?: unknown; agentId?: unknown; userId?: unknown };

/**
 * Phần policy quyết định gate: id/type stage và principal participant. Không gồm monitor, id participant,
 * reviewPreset; `maxReviewRounds` được kiểm riêng ở `evaluateIssueGate`.
 */
export function policyGateFingerprint(policy: unknown): string {
  const stages = (policy as { stages?: unknown } | null)?.stages;
  if (!Array.isArray(stages) || stages.length === 0) return "none";
  return JSON.stringify(
    stages.map((raw) => {
      const stage = raw as LooseStage;
      const participants = Array.isArray(stage.participants) ? (stage.participants as LoosePrincipal[]) : [];
      return {
        id: typeof stage.id === "string" ? stage.id : null,
        type: typeof stage.type === "string" ? stage.type : null,
        participants: participants
          .map((p) => `${String(p.type)}:${String(p.type === "agent" ? p.agentId : p.userId)}`)
          .sort(),
      };
    }),
  );
}

export const CREW_MERGE_RE = /^crew-merge sha=([0-9a-f]{40}) branch=(\S+) pushed=yes$/;

export interface CrewMergeEvidence {
  sha: string;
  branch: string;
}

/** Báo push của integrator ở stage push: chỉ dòng đầu, `pushed=yes`. */
export function parseCrewMergeEvidence(body: string): CrewMergeEvidence | null {
  const first = body.split("\n", 1)[0]?.trim() ?? "";
  const match = CREW_MERGE_RE.exec(first);
  if (!match) return null;
  return { sha: match[1] as string, branch: match[2] as string };
}

export const CREW_DOCS_CHECK_RE =
  /^crew-docs-check commit=([0-9a-f]{40}) range=([0-9a-f]{7,40})\.\.([0-9a-f]{40}) exit=([0-3])$/;

export interface DocsCheckEvidence {
  commit: string;
  base: string;
  head: string;
  exit: 0 | 1 | 2 | 3;
}

/** Bằng chứng `crew-docs check` của integrator: chỉ dòng đầu, `commit` phải là đầu range (merged commit). */
export function parseDocsCheckEvidence(body: string): DocsCheckEvidence | null {
  const first = body.split("\n", 1)[0]?.trim() ?? "";
  const match = CREW_DOCS_CHECK_RE.exec(first);
  if (!match) return null;
  const [, commit, base, head, exit] = match as unknown as [string, string, string, string, string];
  if (commit !== head) return null;
  return { commit, base, head, exit: Number(exit) as DocsCheckEvidence["exit"] };
}

/** Báo một lần lúc nạp module (server khởi động) khi chưa đặt env: mọi gate Crew đang tắt. */
export function reportCrewPolicyConfigAtStartup(
  env: NodeJS.ProcessEnv = process.env,
  log: Pick<typeof logger, "warn" | "info"> = logger,
): boolean {
  const file = env[CREW_POLICY_CONFIG_ENV]?.trim();
  if (!file) {
    log.warn(
      { env: CREW_POLICY_CONFIG_ENV },
      `${CREW_POLICY_CONFIG_ENV} chưa đặt: gate Crew (review, integrator, owner, docs) tắt cho mọi company`,
    );
    return false;
  }
  log.info({ file }, "crew policy config enabled");
  return true;
}

reportCrewPolicyConfigAtStartup();
