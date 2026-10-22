// Dữ liệu Jev dùng chung cho các khối trên trang: cấu hình, số liệu, ca deny/escalate và ca lệch C3.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type JevGateEvent, type JevLabel, queryKeys } from '@/api';

/** Chu kỳ tự làm mới số liệu và danh sách ca. */
export const JEV_REFRESH_MS = 30_000;

export function useJevSettings(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jev(companyId, 'settings'),
    queryFn: () => api.jev.settings(companyId),
    enabled,
    refetchInterval: JEV_REFRESH_MS,
  });
}

export function useJevStats(companyId: string, days: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jev(companyId, 'stats', days),
    queryFn: () => api.jev.stats(companyId, days),
    enabled,
    refetchInterval: JEV_REFRESH_MS,
  });
}

export function useGateEvents(companyId: string, verdict: 'deny' | 'escalate', enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.jev(companyId, 'events', verdict),
    queryFn: ({ pageParam }) => api.jev.events(companyId, verdict, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled,
    refetchInterval: JEV_REFRESH_MS,
  });
}

export function useShadowItems(companyId: string, kind: 'liveness' | 'runtime', enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.jev(companyId, 'shadow', kind),
    queryFn: ({ pageParam }) => api.jev.shadow(companyId, kind, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled,
    refetchInterval: JEV_REFRESH_MS,
  });
}

/** Gắn nhãn Đúng/Nhầm; bấm lại đúng nhãn đang có thì bỏ nhãn. */
export function useLabelEvent(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { event: JevGateEvent; label: JevLabel }) =>
      api.jev.label(companyId, v.event.id, v.event.ownerLabel === v.label ? null : v.label),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.jev(companyId, 'events') }),
  });
}
