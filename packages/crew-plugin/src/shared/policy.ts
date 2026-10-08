import { jsonObject } from "./db.js";

export type CrewPolicyKind = "code" | "research";
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
  const reviewer = principal(stages[0]!, "review", "agent");
  if (!reviewer) return null;
  if (stages.length === 2) {
    return principal(stages[1]!, "approval", "user") ? "research" : null;
  }
  if (stages.length !== 4) return null;
  const integrator = principal(stages[1]!, "review", "agent");
  return integrator && principal(stages[2]!, "approval", "user")
    && principal(stages[3]!, "review", "agent") === integrator ? "code" : null;
}

export function docsStageAgents(value: unknown): string[] {
  const policy = jsonObject(value);
  if (!Array.isArray(policy?.stages)) return [];
  const approval = policy.stages.findIndex((raw: unknown) => jsonObject(raw)?.type === "approval");
  const reviews = policy.stages.slice(0, approval < 0 ? undefined : approval)
    .map(jsonObject).filter((stage): stage is Record<string, unknown> => !!stage && stage.type === "review");
  if (reviews.length < 2) return [];
  const participants = reviews[1]?.participants;
  return Array.isArray(participants)
    ? participants.flatMap(raw => {
      const p = jsonObject(raw);
      return p?.type === "agent" && typeof p.agentId === "string" ? [p.agentId] : [];
    }) : [];
}
