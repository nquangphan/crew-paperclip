import type { PluginContext } from "@paperclipai/plugin-sdk";
import { parseCrewBundle, parseCrewCommit, parseCrewFixBase } from "../shared/markers.js";
import { jsonObject, checkedId } from "../shared/db.js";
import { crewPolicyKind } from "../shared/policy.js";

export interface CrewMapNode {
  id: string;
  identifier: string;
  title: string;
  status: string;
  parentId: string | null;
  assignee: { id: string; name: string } | null;
  stage: { currentStageId: string | null; currentType: string | null; completed: string[]; position: number | null } | null;
  reviewRounds: number;
  maxReviewRounds: number;
  kind: "code" | "research" | "fix";
  bundle: { id: string; seq: number } | null;
}

export interface CrewMap {
  root: CrewMapNode;
  nodes: CrewMapNode[];
  edges: Array<{ kind: "parent" | "dependency" | "repair"; from: string; to: string; label?: string }>;
  diagnostics: string[];
}

type LocationRow = { id: string; company_id: string; parent_id: string | null };
type IssueRow = LocationRow & {
  identifier: string | null;
  title: string;
  status: string;
  description: string | null;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  execution_policy: unknown;
  execution_state: unknown;
};
type RelationRow = { issue_id: string; related_issue_id: string };
type CommentRow = { issue_id: string; body: string };

function nodeFrom(row: IssueRow): CrewMapNode {
  const state = jsonObject(row.execution_state);
  const policy = jsonObject(row.execution_policy);
  const completed = Array.isArray(state?.completedStageIds)
    ? state.completedStageIds.filter((id): id is string => typeof id === "string") : [];
  const rounds = state?.changesRequestedCount;
  const maxRounds = policy?.maxReviewRounds;
  const policyStages = Array.isArray(policy?.stages) ? policy.stages : [];
  const position = policyStages.findIndex(stage => jsonObject(stage)?.id === state?.currentStageId);
  return {
    id: row.id,
    identifier: row.identifier ?? row.id,
    title: row.title,
    status: row.status,
    parentId: row.parent_id,
    assignee: row.assignee_agent_id && row.assignee_name
      ? { id: row.assignee_agent_id, name: row.assignee_name } : null,
    stage: state ? {
      currentStageId: typeof state.currentStageId === "string" ? state.currentStageId : null,
      currentType: typeof state.currentStageType === "string" ? state.currentStageType : null,
      completed,
      position: position >= 0 ? position : null,
    } : null,
    reviewRounds: typeof rounds === "number" && Number.isInteger(rounds) && rounds >= 0 ? rounds : 0,
    // Matches resolveMaxReviewRounds in the host execution-policy service.
    maxReviewRounds: typeof maxRounds === "number" && Number.isInteger(maxRounds) && maxRounds > 0 ? maxRounds : 3,
    kind: parseCrewFixBase(row.description) ? "fix"
      : crewPolicyKind(row.execution_policy) === "research" ? "research" : "code",
    bundle: parseCrewBundle(row.description),
  };
}

export function isCrewRoot(row: Pick<IssueRow, "execution_policy">): boolean {
  return crewPolicyKind(row.execution_policy) !== null;
}

export async function loadCrewMap(ctx: Pick<PluginContext, "db">, issueId: string, requestedCompanyId: string): Promise<CrewMap> {
  checkedId(issueId);
  const location = await ctx.db.query<LocationRow>(
    "SELECT id, company_id, parent_id FROM public.issues WHERE id = $1", [issueId],
  );
  if (!location[0]) throw new Error("Không tìm thấy issue");
  const companyId = location[0].company_id;
  if (!requestedCompanyId || companyId !== requestedCompanyId) throw new Error("Issue không thuộc company hiện tại");
  let rootId = issueId;
  let parentId = location[0].parent_id;
  const visited = new Set([issueId]);
  while (parentId) {
    if (visited.has(parentId)) throw new Error("Cây issue có vòng lặp");
    visited.add(parentId);
    const parent = await ctx.db.query<LocationRow>(
      "SELECT id, company_id, parent_id FROM public.issues WHERE id = $1 AND company_id = $2",
      [parentId, companyId],
    );
    if (!parent[0]) throw new Error("Issue cha không cùng company");
    rootId = parent[0].id;
    parentId = parent[0].parent_id;
  }

  const rows = await ctx.db.query<IssueRow>(`
    WITH RECURSIVE tree AS (
      SELECT i.id, i.company_id, i.parent_id, i.identifier, i.title, i.status,
             i.description, i.assignee_agent_id, i.execution_policy, i.execution_state
      FROM public.issues i WHERE i.id = $1 AND i.company_id = $2
      UNION ALL
      SELECT i.id, i.company_id, i.parent_id, i.identifier, i.title, i.status,
             i.description, i.assignee_agent_id, i.execution_policy, i.execution_state
      FROM public.issues i JOIN tree t ON i.parent_id = t.id
      WHERE i.company_id = $2
    )
    SELECT tree.*, a.name AS assignee_name
    FROM tree LEFT JOIN public.agents a ON a.id = tree.assignee_agent_id AND a.company_id = $2
    ORDER BY tree.identifier NULLS LAST, tree.id
  `, [rootId, companyId]);
  const rootRow = rows.find((row) => row.id === rootId);
  if (!rootRow) throw new Error("Không tìm thấy issue gốc");
  const root = nodeFrom(rootRow);
  const diagnostics: string[] = [];
  if (!isCrewRoot(rootRow)) return { root, nodes: [], edges: [], diagnostics: ["not_crew_root"] };

  const nodes = rows.map(nodeFrom);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: CrewMap["edges"] = rows.flatMap((row) =>
    row.parent_id && nodeIds.has(row.parent_id)
      ? [{ kind: "parent" as const, from: row.parent_id, to: row.id }] : [],
  );
  const relations = await ctx.db.query<RelationRow>(
    "SELECT issue_id, related_issue_id FROM public.issue_relations WHERE company_id = $1 AND type = 'blocks' AND issue_id = ANY($2::uuid[]) AND related_issue_id = ANY($2::uuid[])",
    [companyId, [...nodeIds]],
  );
  for (const relation of relations) {
    edges.push({ kind: "dependency", from: relation.issue_id, to: relation.related_issue_id });
  }

  const fixes = rows.filter((row) => parseCrewFixBase(row.description));
  if (fixes.length > 0) {
    const comments = await ctx.db.query<CommentRow>(
      "SELECT issue_id, body FROM public.issue_comments WHERE company_id = $1 AND issue_id = ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY created_at DESC, id DESC",
      [companyId, [...nodeIds]],
    );
    const commitsByIssue = new Map<string, Set<string>>();
    for (const comment of comments) {
      const sha = parseCrewCommit(comment.body);
      if (!sha) continue;
      const commits = commitsByIssue.get(comment.issue_id) ?? new Set<string>();
      commits.add(sha);
      commitsByIssue.set(comment.issue_id, commits);
    }
    for (const fix of fixes) {
      const base = parseCrewFixBase(fix.description);
      const repaired = rows.find((row) => row.id !== fix.id
        && row.parent_id === fix.parent_id && !!base && commitsByIssue.get(row.id)?.has(base));
      if (repaired) edges.push({ kind: "repair", from: repaired.id, to: fix.id });
      else diagnostics.push(`Không xác định được issue được sửa bởi ${fix.identifier ?? fix.id}`);
    }
  }
  for (const node of nodes) {
    if (node.reviewRounds > 0) {
      edges.push({ kind: "repair", from: node.id, to: node.id, label: `${node.reviewRounds} vòng sửa` });
    }
  }
  return { root, nodes, edges, diagnostics };
}

export function registerMapFeature(ctx: PluginContext): void {
  ctx.data.register("crew.map", async (params) => loadCrewMap(ctx, String(params.issueId ?? ""), String(params.companyId ?? "")));
}
