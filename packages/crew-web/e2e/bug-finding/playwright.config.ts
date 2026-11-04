// Playwright cho luồng ticket tổng root-bf (Bug Finding) của UI Crew: chạy trên web dev (vite, cổng 5193) với toàn bộ
// `/api/*` được giả bằng `page.route` (stub.ts), nên không cần stack Paperclip, tài khoản hay Mac thật.
// Chạy từ packages/crew-web: `pnpm exec playwright test -c e2e/bug-finding/playwright.config.ts`.
// `CREW_E2E_CHROMIUM`: đường dẫn trình duyệt Chromium có sẵn (bỏ trống thì dùng bản Playwright tải).
import { defineConfig, devices } from '@playwright/test';

const PORT = 5193;

export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  outputDir: '../../test-results/bug-finding',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1280, height: 1100 },
    launchOptions: { executablePath: process.env.CREW_E2E_CHROMIUM || undefined },
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { CREW_WEB_API: 'http://127.0.0.1:1' },
  },
});
