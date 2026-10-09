// Tìm kiếm issue, bình luận, tài liệu (S19). Tham số theo server/src/routes/issues.ts:7731.
import type { CompanySearchResponse } from '@paperclipai/shared';
import { call } from '../endpoints';
import type { Query } from '../http';

export interface SearchParams {
  q: string;
  scope?: string;
  limit?: number;
  offset?: number;
  projectId?: string;
  [key: string]: Query[string];
}

export const searchApi = {
  query: (companyId: string, params: SearchParams): Promise<CompanySearchResponse> =>
    call('search.query', { companyId }, { query: params }),
};

export const __endpoints = ['search.query'];
