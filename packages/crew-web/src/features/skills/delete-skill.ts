// Xóa skill (S14.7), chạy trong trình duyệt bằng phiên owner. Thứ tự:
// 1. gỡ skill khỏi mọi agent đang khai (POST skills/sync mode replace);
// 2. bỏ chọn đường dẫn skill ở nguồn GitHub, để lần refresh nguồn sau không tạo lại skill;
// 3. DELETE skill;
// 4. xếp việc `skill-remove` cho mỗi máy đã có bản chép (app xóa ~/.crew/skills/<companyId>/<slug>).
// Mỗi bước ghi vào `progress`; chạy lại sau lỗi bỏ qua bước đã xong.
import type { SkillSource, SkillSourceSelectionRequest } from '@paperclipai/shared';
import { api } from '@/api';
import type { SkillSyncState } from '@/api/crew/types';
import { ApiError } from '@/api/http';

export interface DeleteSkillTarget {
  id: string;
  key: string;
  slug: string;
  /** Agent đang khai skill trong desiredSkills. */
  agentIds: string[];
  skillSourceId: string | null;
  skillSourcePath: string | null;
}

export interface DeleteSkillProgress {
  detached: string[];
  sourceDone: boolean;
  deleted: boolean;
  queued: string[];
}

export interface DeleteSkillDeps {
  agentSkills: (agentId: string) => Promise<{ desiredSkills: string[] }>;
  syncAgentSkills: (agentId: string, desired: string[]) => Promise<unknown>;
  getSource: (sourceId: string) => Promise<SkillSource>;
  selectSource: (sourceId: string, body: SkillSourceSelectionRequest) => Promise<unknown>;
  removeSkill: () => Promise<unknown>;
  queueRemove: (machineId: string) => Promise<unknown>;
}

export const newDeleteProgress = (): DeleteSkillProgress => ({
  detached: [],
  sourceDone: false,
  deleted: false,
  queued: [],
});

/** Deps thật: REST stock (phiên owner) và hàng đợi việc máy của plugin. */
export function deleteSkillDeps(companyId: string, skill: { id: string; slug: string }): DeleteSkillDeps {
  return {
    agentSkills: (agentId) => api.agents.skills(agentId, companyId),
    syncAgentSkills: (agentId, desired) => api.agents.syncSkills(agentId, desired, 'replace', companyId),
    getSource: (sourceId) => api.skillSources.get(companyId, sourceId),
    selectSource: (sourceId, body) => api.skillSources.select(companyId, sourceId, body),
    removeSkill: () => api.skills.remove(companyId, skill.id),
    queueRemove: (machineId) =>
      api.jobs.create({
        companyId,
        machineId,
        kind: 'skill-remove',
        payload: { kind: 'skill-remove', skillId: skill.id, slug: skill.slug },
      }),
  };
}

const isStatus = (error: unknown, status: number): error is ApiError =>
  error instanceof ApiError && error.status === status;

/** Id agent trong body 422 `usedByAgents` của DELETE skill. */
function usedByAgentIds(error: ApiError): string[] {
  const body = error.body as { details?: { usedByAgents?: unknown } } | null;
  const list = body?.details?.usedByAgents;
  if (!Array.isArray(list)) return [];
  return list.flatMap((a) => (a && typeof a === 'object' && typeof a.id === 'string' ? [a.id as string] : []));
}

async function detach(target: DeleteSkillTarget, agentId: string, deps: DeleteSkillDeps): Promise<void> {
  const snapshot = await deps.agentSkills(agentId);
  if (!snapshot.desiredSkills.includes(target.key)) return;
  await deps.syncAgentSkills(
    agentId,
    snapshot.desiredSkills.filter((k) => k !== target.key),
  );
}

async function deselectAtSource(sourceId: string, path: string, deps: DeleteSkillDeps): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    let source: SkillSource;
    try {
      source = await deps.getSource(sourceId);
    } catch (error) {
      if (isStatus(error, 404)) return; // nguồn đã bị gỡ: không còn gì tạo lại skill
      throw error;
    }
    const selected = source.entries.filter((e) => e.selection === 'selected').map((e) => e.path);
    if (!selected.includes(path)) return;
    try {
      await deps.selectSource(sourceId, {
        revision: source.revision,
        selectedPaths: selected.filter((p) => p !== path),
        excludedFolders: source.excludedFolders,
      });
      return;
    } catch (error) {
      if (isStatus(error, 409) && attempt === 0) continue; // nguồn đổi giữa chừng: đọc lại, thử một lần
      throw error;
    }
  }
}

async function removeSkill(target: DeleteSkillTarget, deps: DeleteSkillDeps): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.removeSkill();
      return;
    } catch (error) {
      if (isStatus(error, 404)) return; // đã xóa ở lần chạy trước
      if (isStatus(error, 422) && attempt === 0) {
        const again = usedByAgentIds(error);
        if (again.length === 0) throw error;
        for (const agentId of again) await detach(target, agentId, deps);
        continue;
      }
      throw error;
    }
  }
}

export async function runDeleteSkill(input: {
  target: DeleteSkillTarget;
  queueMachineIds: readonly string[];
  deps: DeleteSkillDeps;
  progress: DeleteSkillProgress;
}): Promise<DeleteSkillProgress> {
  const { target, deps, progress } = input;
  for (const agentId of target.agentIds) {
    if (progress.detached.includes(agentId)) continue;
    await detach(target, agentId, deps);
    progress.detached.push(agentId);
  }
  if (!progress.sourceDone) {
    if (target.skillSourceId && target.skillSourcePath) {
      await deselectAtSource(target.skillSourceId, target.skillSourcePath, deps);
    }
    progress.sourceDone = true;
  }
  if (!progress.deleted) {
    await removeSkill(target, deps);
    progress.deleted = true;
  }
  for (const machineId of input.queueMachineIds) {
    if (progress.queued.includes(machineId)) continue;
    await deps.queueRemove(machineId);
    progress.queued.push(machineId);
  }
  return progress;
}

export interface RemovalMachine {
  machineId: string;
  hostname: string;
  canQueue: boolean;
}

/**
 * Máy cần dọn bản chép của skill: mọi máy có trạng thái đồng bộ của skill (`hosts`). Trong đó máy có app nhận
 * việc thì xếp `skill-remove` (`queue`), trừ máy đã có việc gỡ đang chờ; máy chưa có app thì chờ (`waiting`).
 */
export function removalTargets(
  skillId: string,
  states: readonly Pick<SkillSyncState, 'skillId' | 'machineId' | 'kind' | 'status'>[],
  machines: readonly RemovalMachine[],
): { queue: string[]; waiting: string[]; hosts: string[] } {
  const queue: string[] = [];
  const waiting: string[] = [];
  const hosts: string[] = [];
  for (const machine of machines) {
    const state = states.find((s) => s.skillId === skillId && s.machineId === machine.machineId);
    if (!state) continue;
    hosts.push(machine.hostname);
    const removing = state.kind === 'skill-remove' && (state.status === 'queued' || state.status === 'claimed');
    if (removing) continue;
    if (machine.canQueue) queue.push(machine.machineId);
    else waiting.push(machine.hostname);
  }
  return { queue, waiting, hosts };
}
