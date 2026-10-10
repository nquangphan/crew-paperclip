// Dữ liệu máy dùng chung cho trang Máy và trang Skills: bản tin (crew.machines) và hàng đợi việc (crew.machineJobs).
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';

/** Chu kỳ tự làm mới thẻ máy và hàng đợi (S15.1). */
export const MACHINE_REFRESH_MS = 30_000;

export function useCrewMachines(companyId: string) {
  return useQuery({
    queryKey: queryKeys.crew('crew.machines', { companyId }),
    queryFn: () => api.crew.machines(companyId),
    refetchInterval: MACHINE_REFRESH_MS,
  });
}

export function useMachineJobs(companyId: string) {
  return useQuery({
    queryKey: queryKeys.crew('crew.machineJobs', { companyId }),
    queryFn: () => api.crew.machineJobs(companyId),
    refetchInterval: MACHINE_REFRESH_MS,
  });
}

/** Công tắc runtime theo máy (I3). */
export function useRuntimeSwitches(companyId: string) {
  return useQuery({
    queryKey: queryKeys.runtimeSwitches(companyId),
    queryFn: () => api.runtimes.get(companyId),
    refetchInterval: MACHINE_REFRESH_MS,
  });
}
