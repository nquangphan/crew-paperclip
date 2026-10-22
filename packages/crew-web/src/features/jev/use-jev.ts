// Dữ liệu Jev dùng chung cho các khối trên trang: cấu hình, số liệu, ca deny/escalate và ca lệch C3.
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type JevFeatureId,
  type JevGateEvent,
  type JevLabel,
  type JevSettings,
  type JevSettingsInput,
  queryKeys,
} from '@/api';
import { parseAttention, parseJudgmentStats, parseJudgments } from './judge-adapter';

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

/**
 * Tóm tắt Jev của một issue; chỉ chạy khi `enabled` (owner). Lỗi hay chưa tải thì khối tự ẩn, không chặn trang.
 * Chỉ làm tươi định kỳ khi issue đã có dữ liệu Jev (khối đang hiện); Jev tắt hay chưa có lệnh thì không poll.
 */
export function useJevIssueSummary(companyId: string, issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jev(companyId, 'issue', issueId),
    queryFn: () => api.jev.issueSummary(companyId, issueId),
    enabled,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.enabled && (data.calls > 0 || data.shadow.mismatch > 0) ? JEV_REFRESH_MS : false;
    },
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

export function useGateEvents(companyId: string, verdict: 'deny' | 'escalate' | 'error', enabled: boolean) {
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
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jev(companyId, 'events') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jev(companyId, 'issue') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jev(companyId, 'map') });
    },
  });
}

/**
 * Cấu hình đang lưu thành body PUT, rồi áp phần đổi. Mọi nơi lưu cấu hình đi qua đây để không làm rơi trường nào.
 * `features` chỉ có khi `patch` đổi chế độ: server gộp theo khóa (khóa không gửi giữ nguyên), nên lưu cấu hình gate hay
 * công tắc chung không đụng tới chế độ tính năng, kể cả khi tab khác vừa đổi chúng.
 */
export function settingsInput(s: JevSettings, patch: Partial<JevSettingsInput> = {}): JevSettingsInput {
  return {
    enabled: s.enabled,
    gateMode: s.gateMode,
    model: s.model,
    threshold: s.threshold,
    timeoutMs: s.timeoutMs,
    serverShadow: s.serverShadow,
    ...patch,
  };
}

/** Lưu cấu hình và cập nhật bản cache; dùng cho công tắc chung và chế độ từng tính năng. */
export function useSaveJevSettings(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: JevSettingsInput) => api.jev.setSettings(companyId, body),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.jev(companyId, 'settings'), next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jev(companyId, 'judgments') });
    },
  });
}

/** Số ngày của thống kê từng tính năng (mặc định của server). */
export const JUDGMENT_STATS_DAYS = 7;

/** Thống kê theo tính năng × chế độ. Lỗi hay sai dạng thì rỗng; trang vẫn dùng được. */
export function useJudgmentStats(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jev(companyId, 'judgments', 'stats'),
    queryFn: async () => parseJudgmentStats(await api.jev.judgmentStats(companyId, JUDGMENT_STATS_DAYS)),
    enabled,
    retry: false,
    refetchInterval: JEV_REFRESH_MS,
  });
}

/** Ca lệch (50 dòng mới nhất) của một tính năng. */
export function useMismatchJudgments(companyId: string, feature: JevFeatureId, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jev(companyId, 'judgments', 'mismatch', feature),
    queryFn: async () => parseJudgments(await api.jev.judgments(companyId, { feature, mismatch: true })),
    enabled,
    retry: false,
    refetchInterval: JEV_REFRESH_MS,
  });
}

/** Trần số issue mỗi lần hỏi (server từ chối nhiều hơn). */
const INBOX_ATTENTION_MAX = 200;

/** Chu kỳ làm tươi cờ "Cần Đại Ca để ý" của hộp duyệt. */
const ATTENTION_REFRESH_MS = 60_000;

/**
 * Cờ "Cần Đại Ca để ý" theo issue cho hộp duyệt; chỉ owner hỏi. Tính năng tắt, lỗi hay sai dạng đều ra bản đồ rỗng,
 * nên hộp duyệt giữ nguyên như cũ (không huy hiệu, không báo lỗi).
 */
export function useInboxAttention(companyId: string, issueIds: readonly string[], enabled: boolean) {
  const ids = issueIds.slice(0, INBOX_ATTENTION_MAX);
  return useQuery({
    queryKey: queryKeys.jev(companyId, 'attention', ids.join(',')),
    queryFn: async () => parseAttention(await api.jev.inboxAttention(companyId, ids)),
    enabled: enabled && ids.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
    refetchInterval: ATTENTION_REFRESH_MS,
  });
}
