// Mẫu widget Crew cho trang /ds (dữ liệu giả chỉ để xem giao diện).
import { useState } from 'react';
import type { CrewMachine, CrewMap as CrewMapData, CrewMapNode, IssueMapRuns, MapRun, MapRuns } from '@/api/crew/types';
import {
  CrewMap,
  CrewSummary,
  DocsCheckPanel,
  MachineCard,
  ReadinessBadge,
  RoadmapCanvas,
  type RoadmapLevel,
  roadmapRuns,
} from '@/ds';

const node = (id: string, identifier: string, title: string, over: Partial<CrewMapNode> = {}): CrewMapNode => ({
  id,
  identifier,
  title,
  status: 'todo',
  parentId: 'root',
  assignee: { id: 'a1', name: 'executor' },
  stage: null,
  reviewRounds: 0,
  maxReviewRounds: 5,
  kind: 'code',
  bundle: null,
  ...over,
});

const stage = (position: number | null, done = false): CrewMapNode['stage'] =>
  done
    ? { currentStageId: null, currentType: null, completed: ['s1'], position: null }
    : { currentStageId: 's1', currentType: 'review', completed: [], position };
const agent = (name: string) => ({ id: name, name });

// Cây ≥ 15 việc đủ trạng thái (đang làm, xong, bị chặn, cần làm, đang duyệt…) để xem bản đồ trên xuống và dây đang chạy.
const root = node('root', 'TPS-36', 'Trang đăng nhập và duyệt CLI', {
  parentId: null,
  status: 'in_progress',
  assignee: agent('assistant'),
  stage: stage(0),
});
const nodes = [
  root,
  node('a', 'TPS-37', 'Form đăng nhập', { status: 'done', stage: stage(null, true), reviewRounds: 1 }),
  node('a1', 'TPS-42', 'Kiểm tra mật khẩu', { parentId: 'a', status: 'done', stage: stage(null, true) }),
  node('a2', 'TPS-43', 'Nhớ đăng nhập', { parentId: 'a', status: 'done', stage: stage(null, true) }),
  node('b', 'TPS-38', 'Trang duyệt CLI', { status: 'in_progress', assignee: agent('executor-1'), stage: stage(0) }),
  node('b1', 'TPS-44', 'Gọi API duyệt phiên', {
    parentId: 'b',
    status: 'in_progress',
    assignee: agent('executor-2'),
    stage: stage(1),
    reviewRounds: 2,
  }),
  node('b2', 'TPS-45', 'Màn chờ xác nhận', { parentId: 'b', status: 'todo', stage: stage(0) }),
  node('b3', 'TPS-46', 'Hết hạn mã duyệt', {
    parentId: 'b',
    status: 'in_review',
    assignee: agent('reviewer'),
    stage: stage(0),
  }),
  node('c', 'TPS-39', 'Sửa lỗi chuyển hướng', { kind: 'fix', status: 'blocked', assignee: null, reviewRounds: 3 }),
  node('d', 'TPS-40', 'Kiểm thử e2e đăng nhập', { status: 'todo', assignee: agent('executor-3') }),
  node('d1', 'TPS-47', 'Kịch bản đăng nhập sai', { parentId: 'd', status: 'backlog', assignee: null }),
  node('d2', 'TPS-48', 'Kịch bản duyệt CLI', { parentId: 'd', status: 'todo' }),
  node('e', 'TPS-41', 'Viết docs đăng nhập', { status: 'in_review', assignee: agent('reviewer'), stage: stage(2) }),
  node('e1', 'TPS-49', 'Ảnh minh họa luồng', { parentId: 'e', status: 'in_progress', assignee: agent('executor-4') }),
  node('f', 'TPS-50', 'Đăng nhập bằng Google', { status: 'cancelled', assignee: null }),
  node('g', 'TPS-51', 'Giới hạn số lần thử', { status: 'todo', stage: stage(0) }),
];
// Run giả đủ trạng thái: TPS-44 có 6 run (một đang chạy), các việc khác vài run; mốc giờ tính lùi từ lúc mở trang.
const MINUTE = 60_000;
const opened = Date.now();
const run = (
  id: string,
  status: string,
  agentName: string,
  model: string | null,
  startAgo: number,
  minutes: number | null,
  costUsd: number | null,
): MapRun => {
  const start = opened - startAgo * MINUTE;
  return {
    id,
    status,
    agentName,
    model,
    createdAt: new Date(start).toISOString(),
    startedAt: status === 'queued' ? null : new Date(start).toISOString(),
    finishedAt: minutes === null ? null : new Date(start + minutes * MINUTE).toISOString(),
    costUsd,
    billingType: 'subscription_included',
  };
};
const runsOf = (list: MapRun[]): IssueMapRuns => {
  const costed = list.filter((r) => r.costUsd !== null);
  return {
    runs: list,
    count: list.length,
    costUsd: costed.length ? Math.round(costed.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) * 100) / 100 : null,
    subscription: true,
  };
};
const byIssue: Record<string, IssueMapRuns> = {
  root: runsOf([run('r-root-2', 'succeeded', 'crew-assistant', 'claude-opus-5', 90, 4, 0.31)]),
  a: runsOf([
    run('r-a-2', 'succeeded', 'crew-reviewer', 'claude-sonnet-5', 300, 6, 0.24),
    run('r-a-1', 'succeeded', 'crew-executor-1', 'claude-sonnet-5', 340, 38, 1.92),
  ]),
  b1: runsOf([
    run('r-b1-6', 'running', 'crew-executor-2', 'claude-sonnet-5-5', 12, null, null),
    run('r-b1-5', 'failed', 'crew-reviewer', 'claude-opus-5', 40, 3, 0.18),
    run('r-b1-4', 'succeeded', 'crew-executor-2', 'claude-sonnet-5-5', 110, 65, 2.47),
    run('r-b1-3', 'timed_out', 'crew-executor-2', 'claude-sonnet-5-5', 200, 60, 1.1),
    run('r-b1-2', 'cancelled', 'crew-executor-2', 'claude-sonnet-5', 260, 2, null),
    run('r-b1-1', 'succeeded', 'crew-executor-2', 'claude-haiku-4-5', 300, 1, 0.02),
  ]),
  b3: runsOf([run('r-b3-1', 'queued', 'crew-reviewer', 'claude-opus-5', 1, null, null)]),
  c: runsOf([run('r-c-1', 'failed', 'crew-executor-3', 'claude-sonnet-5', 30, 0.5, 0.05)]),
  e: runsOf([
    run('r-e-2', 'succeeded', 'crew-reviewer', 'claude-opus-5', 60, 9, 0.66),
    run('r-e-1', 'succeeded', 'crew-executor-4', 'claude-sonnet-5', 80, 18, 0.83),
  ]),
};
const all = Object.values(byIssue);
const mapRuns: MapRuns = {
  byIssue,
  tree: {
    count: all.reduce((sum, r) => sum + r.count, 0),
    costUsd: Math.round(all.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) * 100) / 100,
    subscription: true,
  },
};

const map: CrewMapData = {
  root,
  nodes,
  edges: [
    ...nodes.filter((n) => n.parentId).map((n) => ({ kind: 'parent' as const, from: n.parentId as string, to: n.id })),
    { kind: 'dependency', from: 'a', to: 'b' },
    { kind: 'dependency', from: 'b1', to: 'b2' },
    { kind: 'dependency', from: 'b', to: 'd' },
    { kind: 'repair', from: 'b3', to: 'c' },
    { kind: 'repair', from: 'a', to: 'a' },
  ],
  diagnostics: [],
  runs: mapRuns,
};

const report: CrewMachine['latest'] = {
  version: 1,
  companyId: 'c',
  machineId: 'm',
  hostname: 'mac-mini',
  sentAt: '2026-10-10T04:20:00.000Z',
  load1: 1.5,
  cpuCount: 8,
  memFreePct: 42,
  tccPending: [],
  claude: { version: '2.1.9', loggedIn: true, plan: 'max' },
  superpowers: { pinned: '5.2.0', ownerInstalled: '5.2.0' },
  checks: [{ id: 'C2', status: 'warn', title: 'Đĩa gần đầy' }],
};

const company: RoadmapLevel = {
  center: { id: 'co', kind: 'company', title: '2P Studio', total: 5, open: 18 },
  nodes: [
    { id: 'p1', kind: 'project', title: 'Crew', color: '#7c3aed', total: 12, open: 6 },
    { id: 'p2', kind: 'project', title: 'Paperclip', color: '#0891b2', total: 30, open: 9 },
    { id: 'p3', kind: 'project', title: 'Kidy School', color: '#059669', total: 8, open: 2 },
    { id: 'p4', kind: 'project', title: 'My Money', color: '#d97706', total: 4, open: 1 },
    { id: 'p5', kind: 'project', title: 'Landing', total: 0, open: 0 },
  ],
  edges: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, source: 'co', target: id, kind: 'parent' as const })),
  overflow: 0,
  layout: 'rings',
};

const roadmap: RoadmapLevel = {
  center: { id: 'p1', kind: 'project', title: 'Crew', color: '#7c3aed', total: 4, open: 3 },
  nodes: [
    { id: 'docs:p1', kind: 'docs', title: 'Docs', total: 12 },
    {
      id: 'r1',
      kind: 'request',
      title: 'Trang đăng nhập',
      identifier: 'TPS-36',
      status: 'in_progress',
      total: 3,
      done: 1,
    },
    { id: 'r2', kind: 'request', title: 'Bảng Kanban', identifier: 'TPS-40', status: 'in_review', total: 5, done: 4 },
    { id: 'r3', kind: 'request', title: 'Sidebar mobile', identifier: 'TPS-41', status: 'blocked', total: 0, done: 0 },
    { id: 'r4', kind: 'request', title: 'Quyền project', identifier: 'TPS-30', status: 'done', total: 6, done: 6 },
  ],
  edges: ['docs:p1', 'r1', 'r2', 'r3', 'r4'].map((id) => ({ id, source: 'p1', target: id, kind: 'parent' as const })),
  overflow: 0,
  layout: 'rings',
};

/** Tầng yêu cầu của trang Roadmap (cây trên xuống), dựng từ cùng cây việc với bản đồ Crew. */
const requestLevel: RoadmapLevel = {
  center: {
    id: root.id,
    kind: 'request',
    title: root.title,
    identifier: root.identifier,
    status: root.status,
    total: nodes.length - 1,
    done: nodes.filter((n) => n.status === 'done').length,
    runs: roadmapRuns(byIssue.root, mapRuns.tree),
  },
  nodes: nodes.slice(1).map((n) => ({
    id: n.id,
    kind: 'ticket' as const,
    title: n.title,
    identifier: n.identifier,
    status: n.status,
    parentId: n.parentId,
    children: nodes.filter((c) => c.parentId === n.id).length,
    assignee: n.assignee?.name ?? null,
    runs: roadmapRuns(byIssue[n.id]),
  })),
  edges: [
    ...nodes.slice(1).map((n) => ({
      id: `${n.parentId}->${n.id}`,
      source: n.parentId as string,
      target: n.id,
      kind: 'parent' as const,
    })),
    { id: 'a=>b', source: 'a', target: 'b', kind: 'blocks' as const },
    { id: 'b1=>b2', source: 'b1', target: 'b2', kind: 'blocks' as const },
  ],
  overflow: 0,
  layout: 'top-down',
};

export function CrewShowcase() {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <ReadinessBadge state="ready" failed={[]} />
        <ReadinessBadge state="not_ready" failed={[{ id: 'A5' }, { id: 'A2' }]} />
        <ReadinessBadge state="untracked" failed={[]} />
      </div>
      <CrewSummary
        map={map}
        issueId="b"
        docsCheck={{
          commit: '6e7268d3a1b2',
          range: '3ec54bf..6e7268d',
          exit: 0,
          at: '2026-10-10T04:20:00.000Z',
          author: 'integrator',
        }}
        expanded={expanded}
        onToggleMap={() => setExpanded((v) => !v)}
      />
      {/* Bản đồ Crew trong nửa bề ngang, gần bằng cột chính của trang chi tiết ticket. */}
      <div className="grid grid-cols-2 gap-4">
        <div data-slot="showcase-crew-map" className="min-w-0">
          {expanded ? <CrewMap map={map} currentIssueId="b1" onOpenIssue={() => {}} /> : null}
        </div>
      </div>
      <div data-slot="showcase-roadmap-request">
        <RoadmapCanvas
          level={requestLevel}
          levelKey="request"
          direction="in"
          onOpen={() => {}}
          labels={{ canvas: 'Roadmap yêu cầu', hint: 'Bấm một việc để mở' }}
        />
      </div>
      <div data-slot="showcase-roadmap-company">
        <RoadmapCanvas level={company} levelKey="co" direction="in" onOpen={() => {}} labels={{ canvas: 'Công ty' }} />
      </div>
      <RoadmapCanvas level={roadmap} levelKey="p1" direction="in" onOpen={() => {}} labels={{ canvas: 'Roadmap' }} />
      <DocsCheckPanel result={{ invalid: true, at: '2026-10-10T04:20:00.000Z', author: null }} />
      <MachineCard report={report} latestAt="2026-10-10T04:20:00.000Z" now={new Date('2026-10-10T04:21:00.000Z')} />
    </div>
  );
}
