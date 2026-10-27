// Bảng cài đặt model hiện hành của stack đang thử. Spec dựng agent bằng `crewAgentCreateBody` cần bảng này để chọn model
// và effort đúng với catalog của stack, không ghi cứng id model.
import type { ModelSettings } from '../../src/api/crew/model-settings';
import type { Api } from './api';

export async function loadModelSettings(api: Api): Promise<ModelSettings> {
  return (await api.get<{ settings: ModelSettings }>('/api/crew/model-settings')).settings;
}
