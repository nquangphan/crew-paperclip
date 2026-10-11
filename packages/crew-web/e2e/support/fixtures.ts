// `test` dùng chung cho mọi spec: trang đã đăng nhập (storageState của global-setup), `api` board, `company` e2e,
// và tự hủy issue ca đã ghi bằng trackIssue khi ca kết thúc.
import { test as base, expect, type Page } from '@playwright/test';
import { type Api, boardApi } from './api';
import { cancelTrackedIssues } from './cleanup';
import { baseUrl, companyId, contributorStorageStatePath, hasContributor } from './env';

export interface E2eCompany {
  id: string;
  name: string;
  issuePrefix: string;
  /** Đường trong company: `path('issues')` → `/CRE/issues`. */
  path(to?: string): string;
}

interface Fixtures {
  api: Api;
  company: E2eCompany;
  /** Trang đã đăng nhập bằng tài khoản khách góp ý (context riêng). Không có tài khoản thì ca tự bỏ qua. */
  contributorPage: Page;
  /** REST bằng phiên của khách góp ý. */
  contributorApi: Api;
}

export const test = base.extend<Fixtures>({
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
  // biome-ignore lint/correctness/noEmptyPattern: Playwright đọc tham số fixture từ mẫu destructuring, không có fixture nào thì phải để rỗng.
  contributorApi: async ({}, use) => {
    base.skip(!hasContributor(), 'Cần tài khoản khách góp ý (CREW_E2E_CONTRIBUTOR_EMAIL/_PASSWORD)');
    const api = await boardApi(contributorStorageStatePath());
    try {
      await use(api);
    } finally {
      await api.dispose();
    }
  },
  contributorPage: async ({ browser }, use) => {
    base.skip(!hasContributor(), 'Cần tài khoản khách góp ý (CREW_E2E_CONTRIBUTOR_EMAIL/_PASSWORD)');
    const context = await browser.newContext({
      baseURL: baseUrl(),
      storageState: contributorStorageStatePath(),
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
  company: async ({ api }, use) => {
    const c = await api.get<{ id: string; name: string; issuePrefix: string }>(`/api/companies/${companyId()}`);
    await use({ ...c, path: (to = '') => `/${c.issuePrefix}${to ? `/${to.replace(/^\//, '')}` : ''}` });
  },
});

export { expect };
