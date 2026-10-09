// Environment mặc định của agent và máy chạy nó (S11.1, S11.4). Máy là máy báo có checkout đúng thư mục làm việc của
// environment; company chỉ có một máy thì lấy máy đó (cùng cách readiness chọn máy).
import type { Agent, Environment } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, type CrewMachine, queryKeys } from '@/api';

export interface AgentEnvironment {
  environment: Environment | null;
  machine: CrewMachine | null;
  isLoading: boolean;
}

export function useAgentEnvironment(agent: Pick<Agent, 'defaultEnvironmentId'>, companyId: string): AgentEnvironment {
  const environments = useQuery({
    queryKey: queryKeys.environments(companyId),
    queryFn: () => api.environments.list(companyId),
  });
  const machines = useQuery({
    queryKey: queryKeys.crew('crew.machines', { companyId }),
    queryFn: () => api.crew.machines(companyId),
  });
  const environment = (environments.data ?? []).find((e) => e.id === agent.defaultEnvironmentId) ?? null;
  const workspace = environment?.config?.remoteWorkspacePath;
  const list = machines.data ?? [];
  const machine =
    (workspace ? list.find((m) => m.latest?.checkouts?.some((c) => c?.path === workspace)) : undefined) ??
    (list.length === 1 ? (list[0] ?? null) : null);
  return { environment, machine, isLoading: environments.isLoading || machines.isLoading };
}

/** Dòng mô tả environment: tên và host SSH. */
export function environmentLabel(environment: Environment): string {
  const host = environment.config?.host;
  return typeof host === 'string' && host !== '' ? `${environment.name} · ${host}` : environment.name;
}
