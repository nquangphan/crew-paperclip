// Playwright cho ca không cần server Paperclip thật: bật vite dev của crew-web (cổng 5185) và tắt khi xong; API do
// chính ca giả bằng page.route. Dùng khi không có stack T1: `pnpm exec playwright test -c playwright.fake.config.ts`.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['fake/**/*.spec.ts'],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  outputDir: './test-results',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5185',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5185 --strictPort',
    url: 'http://127.0.0.1:5185/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CREW_WEB_API: 'http://127.0.0.1:9' },
  },
});
