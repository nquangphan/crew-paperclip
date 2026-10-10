// Khóa TanStack Query dùng chung. Cập nhật trực tiếp (app/live/live-events.ts) invalidate theo các khóa này,
// nên feature phải dùng đúng hàm ở đây. Khóa danh sách đặt companyId ở vị trí 2 để invalidate theo tiền tố.

type Filters = Record<string, unknown>;

export const queryKeys = {
  session: ['auth', 'session'] as const,
  companies: ['companies'] as const,
  health: ['health'] as const,
  sidebarBadges: (companyId: string) => ['sidebar-badges', companyId] as const,
  sidebarPreferences: (companyId: string) => ['sidebar-preferences', companyId] as const,
  dashboard: (companyId: string) => ['dashboard', companyId] as const,
  activity: (companyId: string, filters?: Filters) =>
    (filters ? ['activity', companyId, filters] : ['activity', companyId]) as readonly unknown[],
  search: (companyId: string, q: string) => ['search', companyId, q] as const,

  /** Danh sách issue; `issues(c)` là tiền tố của mọi bộ lọc. */
  issues: (companyId: string, filters?: Filters) =>
    (filters ? ['issues', companyId, filters] : ['issues', companyId]) as readonly unknown[],
  labels: (companyId: string) => ['labels', companyId] as const,

  /** Chi tiết issue theo uuid hoặc mã (TPS-12); sự kiện trực tiếp invalidate cả hai nếu biết. */
  issue: (idOrRef: string) => ['issue', idOrRef] as const,
  comments: (issueId: string) => ['issue', issueId, 'comments'] as const,
  attachments: (issueId: string) => ['issue', issueId, 'attachments'] as const,
  documents: (issueId: string) => ['issue', issueId, 'documents'] as const,
  document: (issueId: string, key: string) => ['issue', issueId, 'documents', key] as const,
  interactions: (issueId: string) => ['issue', issueId, 'interactions'] as const,
  issueRuns: (issueId: string) => ['issue', issueId, 'runs'] as const,
  issueLiveRuns: (issueId: string) => ['issue', issueId, 'live-runs'] as const,

  runs: (companyId: string, filters?: Filters) =>
    (filters ? ['runs', companyId, filters] : ['runs', companyId]) as readonly unknown[],
  liveRuns: (companyId: string) => ['live-runs', companyId] as const,
  run: (runId: string) => ['run', runId] as const,
  runEvents: (runId: string) => ['run', runId, 'events'] as const,
  runLog: (runId: string) => ['run', runId, 'log'] as const,
  runIssues: (runId: string) => ['run', runId, 'issues'] as const,

  projects: (companyId: string) => ['projects', companyId] as const,
  project: (id: string) => ['project', id] as const,
  roles: (projectId: string) => ['project', projectId, 'roles'] as const,

  agents: (companyId: string) => ['agents', companyId] as const,
  agent: (id: string) => ['agent', id] as const,
  agentInstructions: (id: string, path = 'AGENTS.md') => ['agent', id, 'instructions', path] as const,
  agentSkills: (id: string) => ['agent', id, 'skills'] as const,

  environments: (companyId: string) => ['environments', companyId] as const,
  skills: (companyId: string) => ['skills', companyId] as const,
  skill: (companyId: string, skillId: string) => ['skills', companyId, skillId] as const,

  /** Data plugin; `crew()` là tiền tố của mọi data plugin. */
  crew: (key?: string, params?: Filters) =>
    (key ? (params ? ['crew', key, params] : ['crew', key]) : ['crew']) as readonly unknown[],
  crewCompanies: ['crew', 'crew.companies'] as const,
  machineJobs: (companyId: string, filters?: Filters) =>
    (filters ? ['machine-jobs', companyId, filters] : ['machine-jobs', companyId]) as readonly unknown[],
  setupRun: (id: string) => ['setup-run', id] as const,
};
