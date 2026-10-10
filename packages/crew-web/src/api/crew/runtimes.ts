// Công tắc runtime theo máy (I3, route board của plugin). Lỗi trả câu tiếng Việt của server, hiện nguyên văn:
// 403 chỉ board được gạt, 409 OpenCode chưa có vá chạy đúng worktree trên server.
import { call } from '../endpoints';
import type { CrewRuntime, MachineRuntimeSwitches, RuntimeSwitchState } from './types';

export const runtimesApi = {
  /** Mọi máy có bản tin trong company, kèm trạng thái ba công tắc (máy chưa có dòng nhận giá trị mặc định). */
  get: async (companyId: string): Promise<MachineRuntimeSwitches[]> => {
    const res: { machines: MachineRuntimeSwitches[] } = await call('runtimes.switches', {}, { query: { companyId } });
    return res.machines;
  },
  /** POST, không PUT: host không có method PUT cho route plugin. */
  set: (body: {
    companyId: string;
    machineId: string;
    runtime: CrewRuntime;
    enabled: boolean;
  }): Promise<{ ok: true; runtimes: Record<CrewRuntime, RuntimeSwitchState> }> =>
    call('runtimes.setSwitch', {}, { body }),
};

export const __endpoints = ['runtimes.setSwitch', 'runtimes.switches'];
