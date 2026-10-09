// `test` dùng chung cho mọi spec: trang đã đăng nhập (storageState của global-setup), `api` board, `company` e2e,
// và tự hủy issue ca đã ghi bằng trackIssue khi ca kết thúc.
import { test as base, expect } from '@playwright/test';
import { type Api, boardApi } from './api';
import { cancelTrackedIssues } from './cleanup';
import { companyId } from './env';

export interface E2eCompany {
  id: string;
  name: string;
  issuePrefix: string;
  /** Đường trong company: `path('issues')` → `/CRE/issues`. */
  path(to?: string): string;
}

export const test = base.extend<{ api: Api; company: E2eCompany }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright đọc tham số fixture từ mẫu destructuring, không có fixture nào thì phải để rỗng.
  api: async ({}, use, info) => {
    const api = await boardApi();
    await use(api);
    try {
      await cancelTrackedIssues(api, info);
    } finally {
      await api.dispose();
    }
  },
  company: async ({ api }, use) => {
    const c = await api.get<{ id: string; name: string; issuePrefix: string }>(`/api/companies/${companyId()}`);
    await use({ ...c, path: (to = '') => `/${c.issuePrefix}${to ? `/${to.replace(/^\//, '')}` : ''}` });
  },
});

export { expect };
