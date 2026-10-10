// Environment riêng của các agent bị gỡ: chỉ những environment này được archive (PATCH status, không bao giờ DELETE:
// xóa kéo theo secret SSH dùng chung). Environment mẫu và environment còn agent khác dùng thì giữ.
import type { CrewRoleSlot } from '@/api';

export interface EnvironmentLike {
  id: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
}

export interface AgentEnvironmentLike {
  id: string;
  status: string;
  defaultEnvironmentId?: string | null;
}

const SLOTS: readonly CrewRoleSlot[] = ['assistant', 'executor', 'executor-2', 'reviewer', 'integrator'];
const CHECKOUT_RE = /\/crew-agents\/([a-z][a-z0-9-]{1,30})\/([a-z0-9-]+)$/;

/**
 * Environment checkout của một ô do wizard hay app 2P Crew tạo: tên `<khóa>-<ô>` và chạy trong
 * `~/crew-agents/<khóa>/<ô>`. Environment mẫu (tên máy, giữ secret SSH) không khớp nên không bao giờ bị chạm.
 * `projectKey` khác null thì khóa phải đúng project.
 */
function isCheckoutEnvironment(env: EnvironmentLike, projectKey: string | null): boolean {
  const path = env.config.remoteWorkspacePath;
  const match = typeof path === 'string' ? CHECKOUT_RE.exec(path) : null;
  if (!match) return false;
  const [, key, slot] = match;
  if (!(SLOTS as readonly string[]).includes(slot)) return false;
  if (projectKey !== null && key !== projectKey) return false;
  return env.name === `${key}-${slot}`;
}

/**
 * Environment được archive khi gỡ các agent `scope`: là environment mặc định của agent trong phạm vi, đang `active`, là
 * environment checkout (xem trên), và không agent nào ngoài phạm vi (chưa terminated) còn trỏ tới. Mỗi environment một
 * lần, theo thứ tự `scope`.
 */
export function exclusiveEnvironments(input: {
  environments: readonly EnvironmentLike[];
  agents: readonly AgentEnvironmentLike[];
  scope: readonly string[];
  projectKey: string | null;
}): { agentId: string; environmentId: string }[] {
  const inScope = new Set(input.scope.map((id) => id.toLowerCase()));
  const usedOutside = new Set(
    input.agents
      .filter((a) => !inScope.has(a.id.toLowerCase()) && a.status !== 'terminated' && a.defaultEnvironmentId)
      .map((a) => a.defaultEnvironmentId as string),
  );
  const out: { agentId: string; environmentId: string }[] = [];
  const seen = new Set<string>();
  for (const agentId of input.scope) {
    const agent = input.agents.find((a) => a.id.toLowerCase() === agentId.toLowerCase());
    const envId = agent?.defaultEnvironmentId;
    if (!envId || seen.has(envId) || usedOutside.has(envId)) continue;
    const env = input.environments.find((e) => e.id === envId);
    if (env?.status !== 'active' || !isCheckoutEnvironment(env, input.projectKey)) continue;
    seen.add(envId);
    out.push({ agentId, environmentId: envId });
  }
  return out;
}
