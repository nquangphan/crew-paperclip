// Trạng thái gỡ của một project hay agent, đọc từ setup run gỡ mới nhất (`crew.setupRuns`). Trang project/agent dùng để
// hiện "Chạy tiếp" khi lần gỡ dở, bộ lọc "Đã gỡ" và ẩn agent đã gỡ khỏi hộp chọn.
import type { RemoveAgentInput, SetupRun } from '@/api';

export type RemovalStatus = 'none' | 'removing' | 'failed' | 'removed';

export interface RemovalState<R extends SetupRun = SetupRun> {
  status: RemovalStatus;
  /** Lần gỡ mới nhất (null khi chưa từng gỡ). */
  run: R | null;
}

export type RemovalTarget =
  | { projectId: string }
  /** `agentStatus`: agent đã gỡ mà owner chạy lại (không còn paused/terminated) thì coi như chưa gỡ. */
  | { agentId: string; agentStatus?: string };

const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

function matches(run: SetupRun, target: RemovalTarget): boolean {
  if ('projectId' in target) return run.kind === 'remove-project' && same(run.projectId, target.projectId);
  return run.kind === 'remove-agent' && same((run.input as RemoveAgentInput).agentId, target.agentId);
}

export function removalState<R extends SetupRun>(runs: readonly R[], target: RemovalTarget): RemovalState<R> {
  const run = runs.filter((r) => matches(r, target)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!run) return { status: 'none', run: null };
  if (run.status === 'running') return { status: 'removing', run };
  if (run.status === 'failed') return { status: 'failed', run };
  if (run.status !== 'done') return { status: 'none', run };
  if ('agentId' in target && target.agentStatus && !['paused', 'terminated'].includes(target.agentStatus)) {
    return { status: 'none', run };
  }
  return { status: 'removed', run };
}

/**
 * Agent cho hộp chọn agent: bỏ agent đã gỡ (spec: ẩn khỏi mọi hộp chọn), trừ các id trong `keep` (đang được chọn hay
 * đang giữ ô) để giá trị hiện tại vẫn hiện đúng tên.
 */
export function withoutRemovedAgents<A extends { id: string; status?: string | null }>(
  agents: readonly A[],
  runs: readonly SetupRun[],
  keep: readonly (string | null | undefined)[] = [],
): A[] {
  const kept = new Set(keep.filter((id): id is string => !!id));
  return agents.filter(
    (a) =>
      kept.has(a.id) || removalState(runs, { agentId: a.id, agentStatus: a.status ?? undefined }).status !== 'removed',
  );
}
