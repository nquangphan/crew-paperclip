import { jsonObject } from "./db.js";

/**
 * Loại policy Crew của yêu cầu gốc (server `buildCrewPolicy`): `code` (reviewer, integrator gộp + docs, owner,
 * integrator push), `code-bf` (integrator gộp + docs + PR, reviewer cầu nối Bug Finding, owner, integrator merge),
 * `research` (reviewer, owner).
 */
export type CrewPolicyKind = "code" | "code-bf" | "research";
type Stage = { type?: unknown; participants?: unknown };

function principal(stage: Stage, stageType: "review" | "approval", principalType: "agent" | "user"): string | null {
  if (stage.type !== stageType || !Array.isArray(stage.participants) || stage.participants.length !== 1) return null;
  const participant = jsonObject(stage.participants[0]);
  const id = participant?.[principalType === "agent" ? "agentId" : "userId"];
  return participant?.type === principalType && typeof id === "string" && id.length > 0 ? id : null;
}

export function crewPolicyKind(value: unknown): CrewPolicyKind | null {
  const policy = jsonObject(value);
  if (policy?.maxReviewRounds !== 5 || !Array.isArray(policy.stages)) return null;
  const stages = policy.stages.map(jsonObject);
  if (stages.some(stage => !stage)) return null;
  const first = principal(stages[0]!, "review", "agent");
  if (!first) return null;
  if (stages.length === 2) {
    return principal(stages[1]!, "approval", "user") ? "research" : null;
  }
  if (stages.length !== 4) return null;
  const second = principal(stages[1]!, "review", "agent");
  const last = principal(stages[3]!, "review", "agent");
  if (!second || !last || !principal(stages[2]!, "approval", "user")) return null;
  // Một agent ở mọi stage review (dữ liệu cũ, test) vẫn là `code` như trước.
  if (last === second) return "code";
  return last === first ? "code-bf" : null;
}

/** Agent của stage integrator gộp + kiểm docs: stage 0 của `code-bf`, stage review thứ hai trước owner của các loại khác. */
export function docsStageAgents(value: unknown): string[] {
  const policy = jsonObject(value);
  if (!Array.isArray(policy?.stages)) return [];
  if (crewPolicyKind(value) === "code-bf") return stageAgents(jsonObject(policy.stages[0]));
  const approval = policy.stages.findIndex((raw: unknown) => jsonObject(raw)?.type === "approval");
  const reviews = policy.stages.slice(0, approval < 0 ? undefined : approval)
    .map(jsonObject).filter((stage): stage is Record<string, unknown> => !!stage && stage.type === "review");
  if (reviews.length < 2) return [];
  return stageAgents(reviews[1]);
}

function stageAgents(stage: Record<string, unknown> | null | undefined): string[] {
  const participants = stage?.participants;
  return Array.isArray(participants)
    ? participants.flatMap(raw => {
      const p = jsonObject(raw);
      return p?.type === "agent" && typeof p.agentId === "string" ? [p.agentId] : [];
    }) : [];
}
