// Secret của company (wizard chọn environment SSH mẫu: chỉ nhận mẫu có secret thuộc đúng company).
// Nguồn: server/src/routes/secrets.ts `GET /companies/:companyId/secrets`.
import { call } from '../endpoints';

export interface CompanySecret {
  id: string;
  name?: string;
}

export const secretsApi = {
  list: (companyId: string): Promise<CompanySecret[]> => call('secrets.list', { companyId }),
};

export const __endpoints = ['secrets.list'];
