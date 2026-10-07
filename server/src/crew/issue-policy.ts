import { readFile } from "node:fs/promises";
import type { IssueExecutionPolicy } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";

/** Vòng review agent↔agent tối đa của mọi issue Crew; tới vòng này stage được giao cho owner. */
export const CREW_MAX_REVIEW_ROUNDS = 5;

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
  if (!Object.hasOwn(parsed.companies, companyId)) return { kind: "absent" };
  const entry = parsed.companies[companyId];
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

/** Template policy của Crew, đã normalize (có id stage/participant). */
export function buildCrewPolicy(
  kind: "root" | "child",
  roles: CrewRoles,
  ownerUserId: string | null = null,
): IssueExecutionPolicy {
  const reviewer = { type: "review", participants: [{ type: "agent", agentId: roles.reviewerAgentId }] };
  let stages: unknown[] = [reviewer];
  if (kind === "root") {
    if (!ownerUserId) throw new Error("buildCrewPolicy: root policy needs an owner user id");
    stages = [
      reviewer,
      { type: "review", participants: [{ type: "agent", agentId: roles.integratorAgentId }] },
      { type: "approval", participants: [{ type: "user", userId: ownerUserId }] },
    ];
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
