// Dữ liệu và kiểm tra dùng chung cho spec R3X: Ép Done, sửa/xóa skill, gỡ project/agent, ca âm bằng token agent.
// Mọi thứ nằm trong company e2e; spec dọn bản ghi của mình ở cuối ca (skill xóa, key agent thu hồi, issue hủy).
import type { Page } from '@playwright/test';
import type { Api } from './api';
import { trackIssue } from './cleanup';
import { createIssue, ensurePlaceholderAgent, type IssueLite, meId, trackingProject } from './data';

export interface ActivityRow {
  id?: string;
  action: string;
  actorType: string;
  actorId?: string | null;
  createdAt: string;
  details: Record<string, unknown> | null;
}

/** Lịch sử hoạt động của issue (mới nhất trước), đúng nguồn khối "Lịch sử" trên UI. */
export function issueActivity(api: Api, issueId: string): Promise<ActivityRow[]> {
  return api.get<ActivityRow[]>(`/api/issues/${issueId}/activity`);
}

export function actionsOf(rows: ActivityRow[], action: string): ActivityRow[] {
  return rows.filter((r) => r.action === action);
}

export interface RunLite {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
}

/** Run của agent (mọi issue). Dùng để chắc chắn Ép Done không sinh run mới của reviewer. */
export function agentRuns(api: Api, companyId: string, agentId: string): Promise<RunLite[]> {
  return api.get<RunLite[]>(`/api/companies/${companyId}/heartbeat-runs?agentId=${agentId}&limit=100`);
}

export interface CommentLite {
  id: string;
  body: string;
  authorType?: string;
  authorUserId?: string | null;
  authorAgentId?: string | null;
}

export function issueComments(api: Api, issueId: string): Promise<CommentLite[]> {
  return api.get<CommentLite[]>(`/api/issues/${issueId}/comments`);
}

/** Project để dựng issue ca Ép Done: project theo dõi của T1; ở T2 là project nền `e2e-base`. null khi không có. */
export async function gateProjectId(api: Api, companyId: string): Promise<string | null> {
  const tracking = await trackingProject(api, companyId);
  return tracking?.id ?? process.env.CREW_E2E_BASE_PROJECT_ID ?? null;
}

export type GateKind = 'agent-review' | 'owner-approval' | 'no-stage';

export interface GateAgents {
  workerId: string;
  reviewerId: string;
}

/** Hai agent giữ chỗ (adapter `process` lệnh `true`, không tự đánh thức) làm người làm và reviewer. */
export async function gateAgents(api: Api, companyId: string): Promise<GateAgents> {
  const worker = await ensurePlaceholderAgent(api, companyId, 'crew-e2e-worker', { wake: false });
  const reviewer = await ensurePlaceholderAgent(api, companyId, 'crew-e2e-reviewer', { wake: false });
  return { workerId: worker.id, reviewerId: reviewer.id };
}

/**
 * Dựng issue ở một trong ba trạng thái AX1: chờ stage review của agent, chờ stage approval của chính owner,
 * hoặc `in_progress` chưa vào stage nào. Stage dựng bằng `executionPolicy` của Paperclip, nên cần project không
 * bị gate Crew chặn (project theo dõi). Trả null khi company không có project như vậy.
 */
export async function createGateIssue(
  api: Api,
  companyId: string,
  kind: GateKind,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<IssueLite | null> {
  const projectId = await gateProjectId(api, companyId);
  if (!projectId) return null;
  const { workerId, reviewerId } = await gateAgents(api, companyId);
  const stage =
    kind === 'agent-review'
      ? { type: 'review', approvalsNeeded: 1, participants: [{ type: 'agent', agentId: reviewerId }] }
      : kind === 'owner-approval'
        ? { type: 'approval', approvalsNeeded: 1, participants: [{ type: 'user', userId: await meId(api) }] }
        : null;
  const issue = await createIssue(api, companyId, {
    title,
    projectId,
    assigneeAgentId: workerId,
    status: 'todo',
    ...(stage
      ? { executionPolicy: { mode: 'normal', commentRequired: true, maxReviewRounds: 5, stages: [stage] } }
      : {}),
    ...extra,
  });
  await api.patch(`/api/issues/${issue.id}`, { status: 'in_progress' });
  if (!stage) return api.get<IssueLite>(`/api/issues/${issue.id}`);
  const moved = await api.patch<IssueLite>(`/api/issues/${issue.id}`, {
    status: 'done',
    comment: 'Dựng sẵn cho ca e2e.',
  });
  if (moved.status !== 'in_review') throw new Error(`Issue ${issue.identifier} không vào in_review: ${moved.status}`);
  return moved;
}

/** Issue con của `parentId`, giao cho người làm giữ chỗ, đang `in_progress`. */
export async function createChild(
  api: Api,
  companyId: string,
  parentId: string,
  title: string,
  assigneeAgentId: string,
): Promise<IssueLite> {
  const projectId = await gateProjectId(api, companyId);
  const child = await createIssue(api, companyId, { title, parentId, assigneeAgentId, projectId, status: 'todo' });
  await api.patch(`/api/issues/${child.id}`, { status: 'in_progress' });
  return child;
}

export { trackIssue };

// --- Skill ---

export interface SkillLite {
  id: string;
  key: string;
  slug: string;
  name: string;
  sourceType: string;
  editable?: boolean;
  forkedFromSkillId?: string | null;
}

export function skillMarkdown(slug: string, body: string): string {
  return `---\nname: ${slug}\ndescription: Skill thử của ca e2e\n---\n\n${body}\n`;
}

/** Skill tạo trên Paperclip (sửa được). Gọi `dropSkill` ở cuối ca. */
export function createSkill(api: Api, companyId: string, slug: string, body = 'Nội dung thử'): Promise<SkillLite> {
  return api.post<SkillLite>(`/api/companies/${companyId}/skills`, {
    name: slug,
    slug,
    markdown: skillMarkdown(slug, body),
  });
}

/** Xóa skill thử bằng API (bỏ qua nếu đã mất), gỡ khỏi agent trước để server không từ chối. */
export async function dropSkill(api: Api, companyId: string, skillId: string, agentIds: string[] = []): Promise<void> {
  for (const agentId of agentIds) await setAgentSkills(api, agentId, []).catch(() => undefined);
  const res = await api.raw('DELETE', `/api/companies/${companyId}/skills/${skillId}`);
  if (res.status >= 400 && res.status !== 404) throw new Error(`Không xóa được skill thử ${skillId}: ${res.status}`);
}

/**
 * Dọn skill thử bằng đúng luồng xóa của UI (trang skill → "Xóa skill" → gõ slug), để plugin xếp việc máy
 * `skill-remove` và bản chép trên máy mất. Nếu UI không xóa được thì dùng `dropSkill` (API) làm dự phòng.
 * Dùng ở T2/T3 sau khi việc `skill-sync` đã xong (xóa trước khi app tải xong sinh `skill-sync failed`).
 */
export async function removeSkillViaUi(
  page: Page,
  api: Api,
  company: { id: string; path(to?: string): string },
  skill: { id: string; slug: string },
  agentIds: string[] = [],
): Promise<void> {
  try {
    for (const agentId of agentIds) await setAgentSkills(api, agentId, []).catch(() => undefined);
    if ((await api.raw('GET', `/api/companies/${company.id}/skills/${skill.id}`)).status === 404) return;
    await page.goto(company.path(`skills/${skill.id}`));
    await page.getByRole('button', { name: 'Xóa skill', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('textbox').fill(skill.slug);
    await dialog.getByRole('button', { name: 'Xóa skill', exact: true }).click();
    await page.getByText(`Đã xóa skill ${skill.slug}`).waitFor({ timeout: 15_000 });
  } catch {
    await dropSkill(api, company.id, skill.id, agentIds);
  }
}

/**
 * Agent giữ chỗ giữ được skill: adapter `claude_local` (adapter `process` không hỗ trợ đồng bộ skill). Heartbeat tắt,
 * không tự đánh thức, nên không bao giờ sinh run. Không xóa sau ca (agent có thể đã có lịch sử), chỉ trả skill về cũ.
 */
export async function skillAgent(api: Api, companyId: string): Promise<{ id: string }> {
  const agents = await api.get<{ id: string; name: string; status: string }[]>(`/api/companies/${companyId}/agents`);
  const found = agents.find((a) => a.name === 'crew-e2e-skill-agent' && a.status !== 'terminated');
  if (found) return found;
  return api.post<{ id: string }>(`/api/companies/${companyId}/agents`, {
    name: 'crew-e2e-skill-agent',
    role: 'engineer',
    adapterType: 'claude_local',
    adapterConfig: {},
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
  });
}

interface AgentSkillSnapshot {
  desiredSkills?: string[];
}

export function agentSkills(api: Api, agentId: string): Promise<AgentSkillSnapshot> {
  return api.get<AgentSkillSnapshot>(`/api/agents/${agentId}/skills`);
}

export async function setAgentSkills(api: Api, agentId: string, desiredSkills: string[]): Promise<void> {
  await api.post(`/api/agents/${agentId}/skills/sync`, { desiredSkills, mode: 'replace' });
}

/**
 * Rule chặn agent ghi skill (`skills.*`) như `crew/ops/agent-permissions.sh` đặt cho company Crew trên prod. Stack T1
 * chưa có nên thêm vào (ghi chỉ trên T1); trên prod chỉ kiểm có rule, không bao giờ ghi.
 */
export const SKILL_DENY_RULE = {
  id: 'crew-deny-agent-skill-writes',
  priority: -1_000_000,
  effect: 'deny',
  subject: { type: 'all_agents' },
  actions: [
    'skills.create',
    'skills.import',
    'skills.install',
    'skills.edit',
    'skills.update',
    'skills.test',
    'skills.reset',
    'skills.remove',
  ],
} as const;

export async function ensureSkillDenyRule(api: Api, companyId: string, canWrite: boolean): Promise<void> {
  const policy = await api.get<{
    defaultEffect: string;
    revision: number;
    rules: { id: string }[];
  }>(`/api/companies/${companyId}/skill-policy`);
  if (policy.rules.some((r) => r.id === SKILL_DENY_RULE.id)) return;
  if (!canWrite) throw new Error('Company e2e trên prod chưa có rule chặn agent ghi skill (chạy agent-permissions.sh)');
  await api.call('PUT', `/api/companies/${companyId}/skill-policy`, {
    schemaVersion: 1,
    defaultEffect: policy.defaultEffect,
    rules: [...policy.rules, SKILL_DENY_RULE],
    expectedRevision: policy.revision,
  });
}

/** Mã gốc ngắn gọn để dựng slug duy nhất cho skill thử. */
export function skillSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
