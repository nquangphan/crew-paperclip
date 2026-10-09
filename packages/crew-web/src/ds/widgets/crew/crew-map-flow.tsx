// crew: tự dựng

import type { CrewMapNode } from '@crew/paperclip-plugin/shared/map';
import { layoutHierarchy, projectCrewMap } from '@crew/paperclip-plugin/shared/map';
import {
  Background,
  BaseEdge,
  Controls,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useT } from '@/i18n';
import { cn } from '../../cn';
import { resolveStageKey } from '../stage-badge';
import type { CrewMapProps } from './crew-map';

type Viewport = { x: number; y: number; zoom: number };
type EdgeKind = 'parent' | 'dependency' | 'repair';

const EDGE_CLASS: Record<EdgeKind, string> = {
  parent: 'stroke-border! stroke-2',
  dependency: 'stroke-primary! stroke-2 [stroke-dasharray:5_4]',
  repair: 'stroke-chart-4! stroke-2 [stroke-dasharray:2_4]',
};

function readViewport(key: string): Viewport {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, unknown> | null;
    if (
      v &&
      [v.x, v.y, v.zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      (v.zoom as number) > 0 &&
      (v.zoom as number) <= 4
    ) {
      return v as unknown as Viewport;
    }
  } catch {
    // trình duyệt chặn lưu trữ: dùng viewport mặc định
  }
  return { x: 24, y: 180, zoom: 1 };
}

function saveViewport(key: string, viewport: Viewport) {
  try {
    localStorage.setItem(key, JSON.stringify(viewport));
  } catch {
    // không lưu được viewport thì thôi
  }
}

interface TicketData extends Record<string, unknown> {
  issue: CrewMapNode;
  current: boolean;
  onOpen: (issueId: string) => void;
}

function TicketNode({ data }: { data: TicketData }) {
  const { t } = useT();
  const { issue, current, onOpen } = data;
  const stage = issue.stage ? t(`stage.${resolveStageKey(issue.stage, issue.kind)}`) : t('stage.none');
  const meta = [
    t(`crewMap.kind.${issue.kind}`),
    t(`status.${issue.status}`, { defaultValue: issue.status }),
    t('crewMap.stageLine', { stage }),
  ].join(' · ');
  const owner = t('crewMap.assigneeLine', {
    name: issue.assignee?.name ?? t('crewMap.unassigned'),
    round: issue.reviewRounds,
    max: issue.maxReviewRounds,
  });
  const bundle = issue.bundle ? ` · ${t('crewMap.bundle', { id: issue.bundle.id, seq: issue.bundle.seq })}` : '';
  return (
    <div
      data-issue-id={issue.id}
      data-current={current}
      className={cn(
        'min-h-[88px] w-[280px] rounded-lg border bg-card text-card-foreground shadow-sm',
        current && 'outline-3 outline-offset-2 outline-primary',
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        onClick={() => onOpen(issue.id)}
        aria-label={`${issue.identifier}: ${issue.title}. ${meta}`}
        className="flex w-full cursor-pointer flex-col gap-1 px-3 py-2 text-left hover:underline"
      >
        <strong className="truncate">{`${issue.identifier} · ${issue.title}`}</strong>
        <span className="truncate text-xs text-muted-foreground">{meta}</span>
        <span className="truncate text-xs text-muted-foreground">{`${owner}${bundle}`}</span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

interface EdgeProps {
  source: string;
  target: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  markerEnd?: string;
}

function drawEdge(kind: EdgeKind, label: string, p: EdgeProps) {
  const path =
    p.source === p.target
      ? `M ${p.sourceX},${p.sourceY} C ${p.sourceX + 70},${p.sourceY - 70} ${p.targetX + 70},${p.targetY + 70} ${p.targetX},${p.targetY}`
      : getSmoothStepPath({
          sourceX: p.sourceX,
          sourceY: p.sourceY,
          targetX: p.targetX,
          targetY: p.targetY,
          sourcePosition: p.sourcePosition,
          targetPosition: p.targetPosition,
          borderRadius: 0,
        })[0];
  return (
    <BaseEdge
      path={path}
      markerEnd={p.markerEnd}
      className={EDGE_CLASS[kind]}
      interactionWidth={12}
      aria-label={label}
    />
  );
}

function makeEdge(kind: EdgeKind) {
  return function Edge(p: EdgeProps) {
    const { t } = useT();
    return drawEdge(kind, t(`crewMap.edge.${kind}`), p);
  };
}

const NODE_TYPES = { ticket: TicketNode };
const EDGE_TYPES = { parent: makeEdge('parent'), dependency: makeEdge('dependency'), repair: makeEdge('repair') };

function CrewMapFlow({ map, currentIssueId, onOpenIssue }: CrewMapProps) {
  const { t } = useT();
  const projection = projectCrewMap(map);
  const positions = layoutHierarchy(projection);
  const ids = new Set(map.nodes.map((n) => n.id));
  // Chẩn đoán của worker giữ nguyên; cạnh thiếu issue tự dịch vì projectCrewMap viết sẵn tiếng Việt.
  const diagnostics = [
    ...map.diagnostics,
    ...map.edges
      .filter((e) => !ids.has(e.from) || !ids.has(e.to))
      .map((e) => t('crewMap.missingIssue', { kind: t(`crewMap.edge.${e.kind}`), from: e.from, to: e.to })),
  ];
  const nodes = projection.nodes.map((issue) => ({
    id: issue.id,
    type: 'ticket',
    position: positions[issue.id] ?? { x: 0, y: 0 },
    data: { issue, current: issue.id === currentIssueId, onOpen: onOpenIssue } satisfies TicketData,
    draggable: false,
    selectable: false,
  }));
  const edges = projection.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.kind,
    markerEnd: edge.kind === 'parent' ? undefined : { type: MarkerType.ArrowClosed },
  }));
  const key = `crew-map-viewport:${map.root.id}`;
  return (
    <section aria-label={t('crewMap.label')} className="flex flex-col gap-2">
      <div className="h-[34rem] min-h-[25rem] w-full rounded-lg border bg-background">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultViewport={readViewport(key)}
          onMoveEnd={(_event, viewport) => saveViewport(key, viewport)}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          minZoom={0.3}
          maxZoom={2}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {diagnostics.length ? (
        <div role="status" className="text-xs text-muted-foreground">
          {diagnostics.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default CrewMapFlow;
