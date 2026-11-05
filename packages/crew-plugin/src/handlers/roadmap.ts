import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, uuidArray } from "../shared/db.js";
import { parseCrewFixBase } from "../shared/markers.js";
import {
  type CommentRow,
  type CrewMap,
  type CrewMapNode,
  crewRepairEdges,
  type IssueRow,
  nodeFrom,
  reviewRoundEdges,
} from "./map.js";

/**
 * Data key `crew.roadmap`: cây việc con của MỌI yêu cầu (issue gốc do người tạo) mà người xem được thấy, trong một lần
 * tải, cho trang Roadmap một trang. Số query cố định (tối đa 3: cây, quan hệ chặn, comment `crew-commit` khi có việc
 * sửa), không tăng theo số yêu cầu. Run và tiền không có ở đây: tải lười theo yêu cầu bằng `crew.runs`.
 *
 * Quyền xem: worker không biết ai đang xem, nên `viewer` do server Crew tính từ phiên người gọi và ghi đè vào params
 * (`server/src/crew/plugin-data-scope.ts` → `crewRoadmapViewerScope`). Owner (`all: true`) thấy mọi project và yêu cầu
 * không thuộc project; người khác chỉ thấy issue thuộc project được cấp (cả việc con: nhánh nằm ở project không được cấp
 * bị cắt). Thiếu hay sai `viewer` thì trả rỗng (đóng khi lỗi).
 */
export type RoadmapViewer = { all: true } | { all: false; projectIds: string[] };

export interface CrewRoadmapNode extends CrewMapNode {
  /** Yêu cầu gốc chứa việc này (chính nó với nút gốc). */
  rootId: string;
  projectId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrewRoadmap {
  /** Id các yêu cầu gốc, cùng thứ tự với `nodes`. */
  requests: string[];
  /** Gốc và mọi hậu duệ thấy được, phẳng; cạnh cha-con nằm trong `edges` và `parentId`. */
  nodes: CrewRoadmapNode[];
  edges: CrewMap["edges"];
  diagnostics: string[];
  /**
   * Vượt `ROADMAP_NODE_LIMIT` nút: phần còn lại bị cắt theo cây (yêu cầu mới trước), nên các yêu cầu cũ nhất vắng hẳn,
   * nhiều nhất một cây bị cắt dở (giữ gốc và các tầng trên), không việc nào mất gốc hay mất cha.
   */
  truncated: boolean;
}

/** Trần số nút một lần tải (company thật 2026-11: ~700 issue). */
export const ROADMAP_NODE_LIMIT = 5000;

const EMPTY: CrewRoadmap = { requests: [], nodes: [], edges: [], diagnostics: [], truncated: false };

export function parseRoadmapViewer(value: unknown): RoadmapViewer | null {
  if (!value || typeof value !== "object") return null;
  const viewer = value as { all?: unknown; projectIds?: unknown };
  if (viewer.all === true) return { all: true };
  if (viewer.all !== false || !Array.isArray(viewer.projectIds)) return null;
  const projectIds = viewer.projectIds;
  try {
    for (const projectId of projectIds) checkedId(projectId);
  } catch {
    return null;
  }
  return { all: false, projectIds: projectIds as string[] };
}

type RoadmapRow = IssueRow & {
  root_id: string;
  project_id: string | null;
  created_by_user_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};
type RelationRow = { issue_id: string; related_issue_id: string };

const iso = (value: string | Date) => new Date(value).toISOString();

export async function loadCrewRoadmap(
  ctx: Pick<PluginContext, "db">,
  companyId: string,
  viewerParam: unknown,
  /** Trần số nút; chỉ test hạ xuống để thử nhánh cắt. */
  limit = ROADMAP_NODE_LIMIT,
): Promise<CrewRoadmap> {
  checkedId(companyId);
  const viewer = parseRoadmapViewer(viewerParam);
  if (!viewer || (!viewer.all && viewer.projectIds.length === 0)) return { ...EMPTY };
  const all = viewer.all;
  const projects = uuidArray(viewer.all ? [] : viewer.projectIds);

  // Q1: một truy vấn đệ quy từ mọi yêu cầu gốc thấy được; mỗi bước lọc project nên nhánh không được cấp bị cắt cả cây.
  // Sắp theo cây (yêu cầu mới trước) rồi theo tầng, nên khi vượt trần chỉ cây cuối bị cắt dở và cha luôn đứng trước con.
  const fetched = await ctx.db.query<RoadmapRow>(`
    WITH RECURSIVE tree AS (
      SELECT i.id, i.id AS root_id, 0 AS depth
      FROM public.issues i
      WHERE i.company_id = $1 AND i.parent_id IS NULL AND btrim(coalesce(i.created_by_user_id, '')) <> ''
        AND ($2::boolean OR i.project_id = ANY($3::uuid[]))
      UNION ALL
      SELECT c.id, t.root_id, t.depth + 1
      FROM public.issues c JOIN tree t ON c.parent_id = t.id
      WHERE c.company_id = $1 AND ($2::boolean OR c.project_id = ANY($3::uuid[]))
    )
    SELECT tree.root_id, i.id, i.company_id, i.parent_id, i.identifier, i.title, i.status, i.description,
           i.project_id, i.created_by_user_id, i.created_at, i.updated_at,
           i.assignee_agent_id, a.name AS assignee_name, i.execution_policy, i.execution_state
    FROM tree
    JOIN public.issues i ON i.id = tree.id
    JOIN public.issues r ON r.id = tree.root_id
    LEFT JOIN public.agents a ON a.id = i.assignee_agent_id AND a.company_id = $1
    ORDER BY r.created_at DESC, tree.root_id, tree.depth, i.identifier NULLS LAST, i.id
    LIMIT $4
  `, [companyId, all, projects, limit + 1]);
  const truncated = fetched.length > limit;
  const rows = truncated ? fetched.slice(0, limit) : fetched;
  if (rows.length === 0) return { ...EMPTY };

  const nodes: CrewRoadmapNode[] = rows.map((row) => ({
    ...nodeFrom(row),
    rootId: row.root_id,
    projectId: row.project_id ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const ids = uuidArray([...nodeIds]);
  const edges: CrewMap["edges"] = rows.flatMap((row) =>
    row.parent_id && nodeIds.has(row.parent_id) ? [{ kind: "parent" as const, from: row.parent_id, to: row.id }] : [],
  );

  // Q2: quan hệ chặn giữa hai issue cùng nằm trong tập thấy được.
  const relations = await ctx.db.query<RelationRow>(
    `SELECT issue_id, related_issue_id FROM public.issue_relations
     WHERE company_id = $1 AND type = 'blocks' AND issue_id = ANY($2::uuid[]) AND related_issue_id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  for (const relation of relations) {
    edges.push({ kind: "dependency", from: relation.issue_id, to: relation.related_issue_id });
  }

  // Q3 (chỉ khi có việc sửa): comment `crew-commit` của các việc anh em cùng cha với việc sửa.
  const diagnostics: string[] = [];
  const fixParents = new Set(rows.filter((row) => row.parent_id && parseCrewFixBase(row.description)).map((row) => row.parent_id));
  if (fixParents.size > 0) {
    const siblings = rows.filter((row) => row.parent_id && fixParents.has(row.parent_id));
    const comments = await ctx.db.query<CommentRow>(
      `SELECT issue_id, body FROM public.issue_comments
       WHERE company_id = $1 AND issue_id = ANY($2::uuid[]) AND deleted_at IS NULL AND body ~ '(^|\\n)crew-commit sha='`,
      [companyId, uuidArray(siblings.map((row) => row.id))],
    );
    const repair = crewRepairEdges(siblings, comments);
    edges.push(...repair.edges);
    diagnostics.push(...repair.diagnostics);
  }
  edges.push(...reviewRoundEdges(nodes));

  return {
    requests: rows.filter((row) => row.parent_id === null).map((row) => row.id),
    nodes,
    edges,
    diagnostics,
    truncated,
  };
}

export function registerRoadmapFeature(ctx: PluginContext): void {
  ctx.data.register("crew.roadmap", async (params) =>
    loadCrewRoadmap(ctx, String(params.companyId ?? ""), params.viewer));
}
