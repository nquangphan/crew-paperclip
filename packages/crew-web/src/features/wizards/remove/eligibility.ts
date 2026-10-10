// Điều kiện gỡ agent (S11.9, spec §4.5), tính ở web từ vai trò của mọi project chưa archive. Agent giữ vai trò bắt buộc
// (Trợ Lý, reviewer, integrator, executor duy nhất) không gỡ được: gỡ sẽ làm project fail closed. Ô runtime (executor
// Codex/OpenCode, reviewer Codex) là tùy chọn nên luôn gỡ được.
import type { CrewRoleSlot, ProjectRoles } from '@/api';
import { isRuntimeSlot, RUNTIME_SLOT_KEYS, slotOfAgent } from '@/lib/instructions';

export { slotOfAgent };

export type RemoveAgentBlock = 'assistant' | 'reviewer' | 'integrator' | 'onlyExecutor';

export type RemoveAgentEligibility =
  /** Agent đã terminated: không có nút. */
  | { kind: 'hidden' }
  | { kind: 'ok'; projectId: string | null; role: CrewRoleSlot | null }
  | { kind: 'blocked'; reason: RemoveAgentBlock; projectId: string; role: CrewRoleSlot };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Lý do không gỡ được agent ở ô `slot`; gỡ được thì null. */
export function blockOf(roles: ProjectRoles, slot: CrewRoleSlot): RemoveAgentBlock | null {
  if (isRuntimeSlot(slot)) return null;
  if (slot === 'assistant' || slot === 'reviewer' || slot === 'integrator') return slot;
  return roles.executorAgentIds.length < 2 ? 'onlyExecutor' : null;
}

/** Vai trò mới bỏ agent (executor-2 → bỏ; executor-1 → executor-2 lên executor-1; ô runtime → null). */
export function rolesWithout(roles: ProjectRoles, agentId: string): ProjectRoles {
  const next: ProjectRoles = { ...roles, executorAgentIds: roles.executorAgentIds.filter((id) => !same(id, agentId)) };
  for (const key of Object.values(RUNTIME_SLOT_KEYS)) {
    const id = next[key];
    if (id && same(id, agentId)) next[key] = null;
  }
  return next;
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
