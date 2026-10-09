// Thông tin hệ thống (Cài đặt). Nguồn: server/src/routes/health.ts:232.
import { call } from '../endpoints';

export interface HealthStatus {
  status: 'ok' | 'starting';
  version?: string;
  commit?: string | null;
  [key: string]: unknown;
}

export const healthApi = {
  get: (): Promise<HealthStatus> => call('health.get', {}),
};

export const __endpoints = ['health.get'];
