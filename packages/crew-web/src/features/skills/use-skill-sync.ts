// Đồng bộ skill lên máy (S14.4): việc `skill-sync` mỗi máy một việc; trạng thái đọc từ data crew.skillSync.

import { type QueryClient, useQuery } from '@tanstack/react-query';
import type { CrewMachine, MachineJob } from '@/api';
import { api, queryKeys } from '@/api';

/** Chu kỳ làm mới trạng thái đồng bộ: nhanh hơn thẻ máy để thấy hash khớp trong vài chục giây. */
const SYNC_REFRESH_MS = 15_000;

export interface SyncSkill {
  id: string;
  slug: string;
  version: string;
}

export function useSkillSyncStates(companyId: string) {
  return useQuery({
    queryKey: queryKeys.crew('crew.skillSync', { companyId }),
    queryFn: () => api.crew.skillSync(companyId),
    refetchInterval: SYNC_REFRESH_MS,
  });
}

/** Chuỗi phiên bản hợp lệ với việc skill-sync (`[A-Za-z0-9._+-]{1,64}`). */
export function skillVersion(skill: { packageVersion?: string | null; currentVersionId?: string | null }): string {
  const raw = skill.packageVersion || skill.currentVersionId || '1';
  return raw.replace(/[^A-Za-z0-9._+-]/g, '-').slice(0, 64) || '1';
}

export const hasJobsAgent = (machine: CrewMachine): boolean => Boolean(machine.latest.jobsAgent);

/** Xếp một việc skill-sync lên một máy. */
export function queueSkillSync(companyId: string, machineId: string, skill: SyncSkill): Promise<MachineJob> {
  return api.jobs.create({
    companyId,
    machineId,
    kind: 'skill-sync',
    payload: { kind: 'skill-sync', skillId: skill.id, slug: skill.slug, version: skill.version },
  });
}

export interface QueueAllResult {
  queued: number;
  waitingApp: boolean;
  failures: string[];
}

/**
 * Xếp `skill-sync` bản mới nhất của skill lên mọi máy có app nhận việc (sau khi sửa nội dung, cập nhật từ nguồn,
 * tạo bản sửa được). Đọc lại máy và skill ngay lúc xếp để lấy phiên bản vừa ghi.
 */
export async function queueSyncOnAllMachines(
  queryClient: QueryClient,
  companyId: string,
  skillId: string,
): Promise<QueueAllResult> {
  const machines = await queryClient.fetchQuery({
    queryKey: queryKeys.crew('crew.machines', { companyId }),
    queryFn: () => api.crew.machines(companyId),
    staleTime: 0,
  });
  const targets = machines.filter(hasJobsAgent);
  if (targets.length === 0) return { queued: 0, waitingApp: true, failures: [] };
  const skill = await api.skills.get(companyId, skillId);
  const sync = { id: skillId, slug: skill.slug, version: skillVersion(skill) };
  const settled = await Promise.allSettled(targets.map((m) => queueSkillSync(companyId, m.machineId, sync)));
  const failures = settled.flatMap((r) =>
    r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : [],
  );
  return { queued: targets.length - failures.length, waitingApp: false, failures };
}

/** Làm mới skill (danh sách, chi tiết, file) và trạng thái đồng bộ sau một thao tác ghi. */
export function invalidateSkills(queryClient: QueryClient, companyId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.skills(companyId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.crew() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.machineJobs(companyId) });
}
