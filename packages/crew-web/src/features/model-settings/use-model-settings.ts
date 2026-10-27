// Bảng cài đặt model hiện hành (S18.4) cho wizard, ô chọn model và trang Cài đặt model. Một query dùng chung toàn app:
// lưu hay nâng hàng loạt xong thì gọi `invalidateModelSettings` để mọi nơi đọc lại, kèm các query agent vì model của
// agent có thể đã đổi.
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { api, type ModelSettingsView, queryKeys } from '@/api';

export const MODEL_SETTINGS_STALE_MS = 30_000;

/** Đọc `GET /api/crew/model-settings`; lỗi tải thì để người gọi hiện `ErrorState` (không dùng giá trị chép tay). */
export function useModelSettings() {
  return useQuery<ModelSettingsView, Error>({
    queryKey: queryKeys.modelSettings,
    queryFn: () => api.modelSettings.get(),
    staleTime: MODEL_SETTINGS_STALE_MS,
  });
}

/** Sau khi lưu hay nâng hàng loạt thành công: bảng và mọi query agent đọc lại. */
export function invalidateModelSettings(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.modelSettings }),
    queryClient.invalidateQueries({ queryKey: ['agent'] }),
    queryClient.invalidateQueries({ queryKey: ['agents'] }),
    queryClient.invalidateQueries({ queryKey: ['crew', 'readiness'] }),
  ]);
}
