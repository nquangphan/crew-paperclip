// Hoạt động gần đây của company (Tổng quan S2.5). Nguồn: server/src/routes/activity.ts, ui/src/api/activity.ts.
import type { ActivityEvent } from '@paperclipai/shared';
import { call } from '../endpoints';

export const activityApi = {
  list: (companyId: string, opts: { limit?: number } = {}): Promise<ActivityEvent[]> =>
    call('activity.list', { companyId }, { query: opts }),
};

export const __endpoints = ['activity.list'];
