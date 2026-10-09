// Danh sách company người dùng vào được (switcher lọc tiếp theo crew.companies).
import type { Company } from '@paperclipai/shared';
import { call } from '../endpoints';

export const companiesApi = {
  list: (): Promise<Company[]> => call('companies.list', {}, { query: { scope: 'accessible' } }),
};

export const __endpoints = ['companies.list'];
