// Đồng bộ skill lên máy (S14.4): việc `skill-sync` mỗi máy một việc; trạng thái đọc từ data crew.skillSync.

import { useQuery } from '@tanstack/react-query';
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
