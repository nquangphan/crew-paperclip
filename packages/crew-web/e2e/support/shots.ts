// Ảnh chụp các trang cho trang Hướng dẫn (OR-4 chép từ e2e/shots/ sang src/features/guide/img/). e2e/shots/ không
// vào git. Chỉ đọc: mở trang, chờ mạng yên, chụp.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export const SHOTS_DIR = path.resolve(import.meta.dirname, '..', 'shots');

/** Trang chụp: tên ảnh → đường dưới /:companyPrefix/. */
export const SHOT_PAGES: Record<string, string> = {
  dashboard: 'dashboard',
  inbox: 'inbox',
  issues: 'issues',
  'new-request': 'issues?new=1',
  projects: 'projects',
  'add-project': 'projects/new',
  agents: 'agents',
  'add-agent': 'agents/new',
  skills: 'skills',
  machines: 'machines',
  docs: 'docs',
  settings: 'settings',
};

export async function shoot(page: Page, name: string): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Tên ảnh không hợp lệ: ${name}`);
  mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
