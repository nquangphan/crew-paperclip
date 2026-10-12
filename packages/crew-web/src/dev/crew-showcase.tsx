// Mẫu widget Crew cho trang /ds (dữ liệu giả chỉ để xem giao diện).
import { useState } from 'react';
import type { CrewMachine, CrewMap as CrewMapData, CrewMapNode } from '@/api/crew/types';
import {
  CrewMap,
  CrewSummary,
  DocsCheckPanel,
  MachineCard,
  ReadinessBadge,
  RoadmapCanvas,
  type RoadmapLevel,
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

const root = node('root', 'TPS-36', 'Trang đăng nhập và duyệt CLI', { parentId: null, status: 'in_progress' });
const nodes = [
  root,
  node('a', 'TPS-37', 'Form đăng nhập', { status: 'done' }),
  node('b', 'TPS-38', 'Trang duyệt CLI', {
    status: 'in_review',
    stage: { currentStageId: 's1', currentType: 'review', completed: [], position: 0 },
  }),
  node('c', 'TPS-39', 'Sửa lỗi chuyển hướng', { kind: 'fix', assignee: null }),
];
const map: CrewMapData = {
  root,
  nodes,
  edges: [
    { kind: 'parent', from: 'root', to: 'a' },
    { kind: 'parent', from: 'root', to: 'b' },
    { kind: 'parent', from: 'root', to: 'c' },
    { kind: 'dependency', from: 'a', to: 'b' },
    { kind: 'repair', from: 'b', to: 'c' },
  ],
  diagnostics: [],
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

const roadmap: RoadmapLevel = {
  center: { id: 'p1', kind: 'project', title: 'Crew', color: '#2b59c3', total: 4, open: 3 },
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

export function CrewShowcase() {
  const [expanded, setExpanded] = useState(false);
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
      {expanded ? <CrewMap map={map} currentIssueId="b" onOpenIssue={() => {}} /> : null}
      <RoadmapCanvas level={roadmap} levelKey="p1" direction="in" onOpen={() => {}} labels={{ canvas: 'Roadmap' }} />
      <DocsCheckPanel result={{ invalid: true, at: '2026-10-10T04:20:00.000Z', author: null }} />
      <MachineCard report={report} latestAt="2026-10-10T04:20:00.000Z" now={new Date('2026-10-10T04:21:00.000Z')} />
    </div>
  );
}
