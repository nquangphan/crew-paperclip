// Playwright UI Crew. Chạy qua e2e/support/run-e2e.sh --project=t1|t2|t3 (nạp email/mật khẩu board từ .env VPS qua
// stdin, không echo). t1 = stack cục bộ ~/crew-r3-t1 (web 5183 → server 3199); t2 = prod company Crew E2E, chế độ
// stub (0 quota); t3 = prod Crew E2E chạy claude thật (chỉ các ca @t3).
import { defineConfig, devices } from '@playwright/test';
import { baseUrl, storageStatePath } from './e2e/support/env';

const chromium = { ...devices['Desktop Chrome'] };

export default defineConfig({
  testDir: './e2e',
  testMatch: ['specs/**/*.spec.ts', 'flows/**/*.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  fullyParallel: false,
  outputDir: './test-results',
  reporter: [['list']],
  globalSetup: './e2e/support/global-setup.ts',
  globalTeardown: './e2e/support/global-teardown.ts',
  use: {
    baseURL: baseUrl(),
    storageState: storageStatePath(),
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // T1: ca không cần Mac thật, không cần dữ liệu prod.
    { name: 't1', grep: /@t1\b/, use: chromium },
    // T2: mọi ca trừ @t3 và ca chỉ dành cho stack cục bộ (@t1-only).
    { name: 't2', grepInvert: /@t3\b|@t1-only\b/, use: chromium },
    { name: 't3', grep: /@t3\b/, use: chromium },
  ],
});
