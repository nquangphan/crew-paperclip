import { eq } from "drizzle-orm";
import { agents, companies, type Db } from "@paperclipai/db";
import type { IssueExecutionPolicy } from "@paperclipai/shared";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";

/** Vòng review agent↔agent tối đa của mọi issue Crew; tới vòng này stage được giao cho owner. */
export const CREW_MAX_REVIEW_ROUNDS = 5;

export type CrewRole = "reviewer" | "integrator";

export interface CrewRoles {
  reviewerAgentId: string;
  integratorAgentId: string;
}

/** Vai trò Crew đặt ở `agents.metadata.crewRole`; executor và Trợ Lý không có vai trò. */
export function readCrewRole(metadata: unknown): CrewRole | null {
  if (!metadata || typeof metadata !== "object") return null;
  const role = (metadata as Record<string, unknown>).crewRole;
  return role === "reviewer" || role === "integrator" ? role : null;
}

/** Đúng một agent còn hoạt động cho mỗi vai trò, hai vai trò là hai agent khác nhau; ngược lại `null`. */
export function pickCrewRoles(
  rows: ReadonlyArray<{ id: string; status: string; metadata: unknown }>,
): CrewRoles | null {
  const only = (role: CrewRole): string | null => {
    const ids = rows.filter((r) => r.status !== "terminated" && readCrewRole(r.metadata) === role).map((r) => r.id);
    return ids.length === 1 ? (ids[0] as string) : null;
  };
  const reviewerAgentId = only("reviewer");
  const integratorAgentId = only("integrator");
  if (!reviewerAgentId || !integratorAgentId || reviewerAgentId === integratorAgentId) return null;
  return { reviewerAgentId, integratorAgentId };
}

export async function loadCrewRoles(db: Db, companyId: string): Promise<CrewRoles | null> {
  const rows = await db
    .select({ id: agents.id, status: agents.status, metadata: agents.metadata })
    .from(agents)
    .where(eq(agents.companyId, companyId));
  return pickCrewRoles(rows);
}

export async function loadCompanyOwnerUserId(db: Db, companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ owner: companies.defaultResponsibleUserId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.owner?.trim() || null;
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
