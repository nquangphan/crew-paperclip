// Điều kiện gỡ agent (S11.9, spec §4.5), tính ở web từ vai trò của mọi project chưa archive. Agent giữ vai trò bắt buộc
// (Trợ Lý, reviewer, integrator, executor duy nhất) không gỡ được: gỡ sẽ làm project fail closed.
import type { CrewRoleSlot, ProjectRoles } from '@/api';

export type RemoveAgentBlock = 'assistant' | 'reviewer' | 'integrator' | 'onlyExecutor';

export type RemoveAgentEligibility =
  /** Agent đã terminated: không có nút. */
  | { kind: 'hidden' }
  | { kind: 'ok'; projectId: string | null; role: CrewRoleSlot | null }
  | { kind: 'blocked'; reason: RemoveAgentBlock; projectId: string; role: CrewRoleSlot };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Ô vai trò agent đang giữ trong vai trò của một project; không giữ thì null. */
export function slotOfAgent(roles: ProjectRoles, agentId: string): CrewRoleSlot | null {
  if (same(roles.assistantAgentId, agentId)) return 'assistant';
  const i = roles.executorAgentIds.findIndex((id) => same(id, agentId));
  if (i === 0) return 'executor';
  if (i === 1) return 'executor-2';
  if (same(roles.reviewerAgentId, agentId)) return 'reviewer';
  if (same(roles.integratorAgentId, agentId)) return 'integrator';
  return null;
}

/** Lý do không gỡ được agent ở ô `slot`; gỡ được thì null. */
export function blockOf(roles: ProjectRoles, slot: CrewRoleSlot): RemoveAgentBlock | null {
  if (slot === 'assistant' || slot === 'reviewer' || slot === 'integrator') return slot;
  return roles.executorAgentIds.length < 2 ? 'onlyExecutor' : null;
}

/** Vai trò mới bỏ agent (executor-2 → bỏ; executor-1 → executor-2 lên executor-1). */
export function rolesWithout(roles: ProjectRoles, agentId: string): ProjectRoles {
  return { ...roles, executorAgentIds: roles.executorAgentIds.filter((id) => !same(id, agentId)) };
}

/**
 * `roles`: vai trò theo project chưa archive (null: project chưa có dòng vai trò). Một agent chỉ giữ vai trò ở một
 * project (route vai trò chặn chéo) nên dừng ở project đầu tiên thấy agent.
 */
export function removeAgentEligibility(
  agent: { id: string; status: string },
  roles: ReadonlyMap<string, ProjectRoles | null>,
): RemoveAgentEligibility {
  if (agent.status === 'terminated') return { kind: 'hidden' };
  for (const [projectId, projectRoles] of roles) {
    const role = projectRoles ? slotOfAgent(projectRoles, agent.id) : null;
    if (!projectRoles || !role) continue;
    const reason = blockOf(projectRoles, role);
    return reason ? { kind: 'blocked', reason, projectId, role } : { kind: 'ok', projectId, role };
  }
  return { kind: 'ok', projectId: null, role: null };
}
