import type { DashboardSummary } from '@paperclipai/shared';
import { call } from '../endpoints';

export const dashboardApi = {
  summary: (companyId: string): Promise<DashboardSummary> => call('dashboard.summary', { companyId }),
};

export const __endpoints = ['dashboard.summary'];
