// crew: tự dựng
// Dựng một tầng Roadmap từ bản đồ yêu cầu Crew: yêu cầu gốc ở tâm, mọi việc con (cả cháu chắt) tỏa quanh theo cây
// cha-con, cạnh phụ thuộc thành cạnh "chặn", cạnh vòng sửa giữ nguyên. Hàm thuần, không phụ thuộc thư viện vẽ.
import type { CrewMap, CrewMapNode } from '@crew/paperclip-plugin/shared/map';
import type { useT } from '@/i18n';
import type { RoadmapEdge, RoadmapEdgeKind, RoadmapLevel, RoadmapNode } from '../roadmap/roadmap-types';
import { resolveStageKey } from '../stage-badge';

type TFn = ReturnType<typeof useT>['t'];

export interface CrewMapLevel {
  level: RoadmapLevel;
  /** Chẩn đoán của worker và quan hệ trỏ tới issue không có trong bản đồ (đã dịch). */
  diagnostics: string[];
}

const EDGE_KIND = { parent: 'parent', dependency: 'blocks', repair: 'repair' } as const satisfies Record<
  CrewMap['edges'][number]['kind'],
  RoadmapEdgeKind
>;
/** Chú giải bản đồ Crew luôn có đủ ba loại cạnh, kể cả khi yêu cầu chưa có phụ thuộc hay vòng sửa. */
export const CREW_MAP_EDGE_KINDS: readonly RoadmapEdgeKind[] = ['parent', 'blocks', 'repair'];

const byIdentifier = (a: CrewMapNode, b: CrewMapNode) =>
  a.identifier.localeCompare(b.identifier, 'vi', { numeric: true }) || a.id.localeCompare(b.id);

function facts(t: TFn, issue: CrewMapNode, current: boolean) {
  const stage = issue.stage ? t(`stage.${resolveStageKey(issue.stage, issue.kind)}`) : t('stage.none');
  const rounds = t('crewMap.roundsShort', { round: issue.reviewRounds, max: issue.maxReviewRounds });
  const notes = [
    t(`crewMap.kind.${issue.kind}`),
    t('crewMap.stageLine', { stage }),
    t('crewMap.assigneeLine', {
      name: issue.assignee?.name ?? t('crewMap.unassigned'),
      round: issue.reviewRounds,
      max: issue.maxReviewRounds,
    }),
    issue.bundle ? t('crewMap.bundle', { id: issue.bundle.id, seq: issue.bundle.seq }) : null,
    current ? t('crewMap.current') : null,
  ].filter((v): v is string => !!v);
  // Thẻ hẹp: số vòng sửa (tín hiệu đáng chú ý) đứng trước giai đoạn, chỉ hiện khi đã có vòng sửa; tooltip luôn đủ.
  return { detail: issue.reviewRounds > 0 ? `${rounds} · ${stage}` : stage, notes };
}

/**
 * Bản đồ Crew → tầng Roadmap. Việc không nối được về gốc qua `parentId` (dữ liệu hỏng) vẫn được vẽ, treo thẳng dưới
 * gốc, để không mất thông tin. Cạnh trỏ tới issue không có trong bản đồ bị bỏ và ghi vào `diagnostics`.
 */
export function crewMapLevel(map: CrewMap, currentIssueId: string | undefined, t: TFn): CrewMapLevel {
  const rootId = map.root.id;
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  if (!byId.has(rootId)) byId.set(rootId, map.root);
  const root = byId.get(rootId) as CrewMapNode;
  const all = [...byId.values()].filter((n) => n.id !== rootId).sort(byIdentifier);

  // Cha hợp lệ: có trong bản đồ và không tạo vòng; không thì treo dưới gốc.
  const parentOf = new Map<string, string>();
  for (const issue of all) {
    parentOf.set(issue.id, issue.parentId && byId.has(issue.parentId) ? issue.parentId : rootId);
  }
  for (const issue of all) {
    const seen = new Set([issue.id]);
    let p = parentOf.get(issue.id);
    while (p && p !== rootId) {
      if (seen.has(p)) {
        parentOf.set(issue.id, rootId);
        break;
      }
      seen.add(p);
      p = parentOf.get(p);
    }
  }
  const childCount = new Map<string, number>();
  for (const p of parentOf.values()) childCount.set(p, (childCount.get(p) ?? 0) + 1);

  const nodes: RoadmapNode[] = all.map((issue) => {
    const current = issue.id === currentIssueId;
    return {
      id: issue.id,
      kind: 'ticket',
      title: issue.title,
      identifier: issue.identifier,
      status: issue.status,
      parentId: parentOf.get(issue.id),
      children: childCount.get(issue.id) ?? 0,
      assignee: issue.assignee?.name ?? null,
      current,
      ...facts(t, issue, current),
    };
  });
  const rootCurrent = rootId === currentIssueId;
  const center: RoadmapNode = {
    id: rootId,
    kind: 'request',
    title: root.title,
    identifier: root.identifier,
    status: root.status,
    total: all.length,
    done: all.filter((n) => n.status === 'done').length,
    current: rootCurrent,
    ...facts(t, root, rootCurrent),
  };

  // Cạnh cha-con theo cây đã dựng (luôn khớp bố cục); phụ thuộc và vòng sửa lấy từ worker.
  const edges: RoadmapEdge[] = all.map((issue) => {
    const source = parentOf.get(issue.id) as string;
    return { id: `parent:${source}:${issue.id}`, source, target: issue.id, kind: 'parent' };
  });
  const diagnostics = [...map.diagnostics];
  const seen = new Set(edges.map((e) => e.id));
  for (const edge of map.edges) {
    if (edge.kind === 'parent') continue;
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      diagnostics.push(
        t('crewMap.missingIssue', { kind: t(`crewMap.edge.${edge.kind}`), from: edge.from, to: edge.to }),
      );
      continue;
    }
    const kind = EDGE_KIND[edge.kind];
    let id = `${kind}:${edge.from}:${edge.to}`;
    for (let n = 1; seen.has(id); n++) id = `${kind}:${edge.from}:${edge.to}:${n}`;
    seen.add(id);
    edges.push({ id, source: edge.from, target: edge.to, kind });
  }
  return { level: { center, nodes, edges, overflow: 0, layout: 'spread-tree' }, diagnostics };
}
