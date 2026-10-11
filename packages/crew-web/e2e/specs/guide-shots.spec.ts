// Ảnh cho trang Hướng dẫn, chụp thật trên stack T1 theo từng vai trò và từng ngôn ngữ, ghi thẳng vào
// src/features/guide/img/<lang>/. Chỉ chạy khi gọi rõ (đổi dữ liệu mẫu của T1):
//   pnpm --filter @crew/paperclip-web guide:shots
// Chỉ chụp lại vài ảnh: thêm CREW_GUIDE_SHOTS_ONLY=machines,inbox.
// Cần trong board.env của T1: tài khoản owner, khách góp ý (Phòng Marketing) và CREW_GUIDE_PASSWORD (tài khoản
// guide-operator và guide-viewer tự dựng ở lượt đầu, xem support/guide-users.ts). Ca này chỉ đọc màn hình, mở hộp thoại
// rồi đóng; không bấm nút xác nhận nào.
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { GUIDE_SHOTS } from '../../src/features/guide/shots';
import { baseUrl, storageStatePath } from '../support/env';
import { expect, test } from '../support/fixtures';
import {
  ensureGuideCompany,
  GUIDE_DEMO,
  GUIDE_PROJECTS,
  type GuideCompany,
  seedGuideCompany,
} from '../support/guide-company';
import { ensureGuideMembers, GUIDE_ACCOUNTS, GUIDE_OWNER_NAME, guideAccountApi } from '../support/guide-users';
import { login } from '../support/login';
import {
  annotate,
  clearMarks,
  type Mark,
  prepareContext,
  SHOT_VIEWPORT,
  type ShotLang,
  saveShot,
} from '../support/shots';

type Role = 'owner' | 'operator' | 'viewer' | 'contributor';
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

test.skip(process.env.CREW_GUIDE_SHOTS !== '1', 'Chỉ chụp khi CREW_GUIDE_SHOTS=1');
test.describe.configure({ mode: 'serial' });
// Đăng nhập tài khoản ảnh bằng mật khẩu thật: không ghi trace.
test.use({ trace: 'off', screenshot: 'off' });

interface ShotCtx {
  page: Page;
  lang: ShotLang;
  role: Role;
  company: GuideCompany;
  /** Chữ theo ngôn ngữ đang chụp. */
  L: (vi: string, en: string) => string;
}

interface Recipe {
  id: string;
  /** Vai trò chụp. Ảnh có `roles` trong GUIDE_SHOTS thì chụp đủ các vai trò đó; còn lại chụp một lần bằng vai trò đầu. */
  as: Role[];
  /** `main`: chỉ vùng nội dung (bỏ thanh bên). `viewport`: cả màn hình (thanh bên, hộp thoại, cửa sổ nổi). */
  frame: 'main' | 'viewport';
  /** Mở màn hình cần chụp, trả các chỗ cần đánh dấu. */
  open: (c: ShotCtx) => Promise<Mark[]>;
  /** Đóng hộp thoại sau khi chụp (không bấm xác nhận). */
  close?: (c: ShotCtx) => Promise<void>;
}

const ALL: Role[] = ['owner', 'operator', 'viewer', 'contributor'];
const EMPTY_STATE: StorageState = { cookies: [], origins: [] };
/** `CREW_GUIDE_SHOTS_ONLY=machines,inbox`: chỉ chụp lại các ảnh này. */
const ONLY = process.env.CREW_GUIDE_SHOTS_ONLY
  ? new Set(process.env.CREW_GUIDE_SHOTS_ONLY.split(',').map((s) => s.trim()))
  : null;

/** Chờ trang dựng xong: hết vòng xoay và khung chờ, phông đã tải, thêm một nhịp cho hiệu ứng. */
const settle = async (page: Page) => {
  await page.waitForLoadState('load');
  await expect(page.locator('[data-slot="spinner"][role="status"], [data-slot="skeleton"]')).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
};

const go = async (c: ShotCtx, to: string) => {
  await c.page.goto(c.company.path(to));
  await settle(c.page);
};

const m = (target: Locator, label: string | number): Mark => ({ target, label: String(label) });
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole('button', { name }).first();
const link = (scope: Page | Locator, name: string | RegExp) => scope.getByRole('link', { name }).first();
const main = (page: Page) => page.locator('main');
const aside = (page: Page) => page.locator('aside');
const pressEscape = async (c: ShotCtx) => {
  await c.page.keyboard.press('Escape');
  await c.page.waitForTimeout(200);
};

/** Mở cửa sổ nổi của yêu cầu mẫu. */
async function openDemoPopup(c: ShotCtx): Promise<Locator> {
  await go(c, `issues?issue=${c.company.ownerIssue.identifier}`);
  const popup = c.page.getByTestId('issue-popup');
  await expect(popup).toBeVisible();
  await settle(c.page);
  return popup;
}

const RECIPES: Recipe[] = [
  {
    id: 'login',
    as: ['owner'],
    frame: 'viewport',
    open: async (c) => {
      await c.page.goto('/login');
      await settle(c.page);
      const form = c.page.locator('form');
      return [
        m(form.locator('input[type="email"]'), 1),
        m(form.locator('input[type="password"]'), 2),
        m(form.locator('button[type="submit"]'), 3),
      ];
    },
  },
  {
    id: 'shell',
    as: ALL,
    frame: 'viewport',
    open: async (c) => {
      await go(c, 'dashboard');
      const side = aside(c.page);
      return [
        m(side.locator('button[aria-haspopup="menu"]').first(), 1),
        m(btn(side, c.L('Tìm nhanh', 'Quick search')), 2),
        m(link(side, c.L('Yêu cầu mới', 'New request')), 3),
        m(link(side, c.L('Hướng dẫn', 'Guide')), 4),
        m(side.locator('fieldset'), 5),
      ];
    },
  },
  {
    id: 'dashboard',
    as: ALL,
    frame: 'main',
    open: async (c) => {
      await go(c, 'dashboard');
      const body = main(c.page);
      return [
        m(body.getByText(c.L('Agent đang bật', 'Agents enabled')).locator('xpath=ancestor::*[@data-slot][1]'), 1),
        m(
          body.getByText(c.L('Chờ bạn duyệt', 'Awaiting your approval')).locator('xpath=ancestor::*[@data-slot][1]'),
          2,
        ),
        m(
          body
            .getByText(c.L('Góp ý chờ duyệt', 'Contributions to approve'))
            .locator('xpath=ancestor::*[@data-slot][1]'),
          3,
        ),
      ];
    },
  },
  {
    id: 'palette',
    as: ['owner'],
    frame: 'viewport',
    open: async (c) => {
      await go(c, 'dashboard');
      await c.page.keyboard.press('ControlOrMeta+k');
      const dialog = c.page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await c.page.keyboard.type(c.company.ownerIssue.identifier);
      await settle(c.page);
      return [m(dialog.locator('input').first(), 1)];
    },
    close: pressEscape,
  },
  {
    id: 'issues-list',
    as: ALL,
    frame: 'main',
    open: async (c) => {
      await go(c, 'issues');
      const body = main(c.page);
      return [
        m(btn(body, c.L('Yêu cầu mới', 'New request')), 1),
        m(body.getByPlaceholder(c.L('Tìm yêu cầu', 'Search requests')), 2),
        m(btn(body, new RegExp(c.L('^Chờ duyệt \\(', '^Pending approval \\('))), 3),
        m(btn(body, new RegExp(`^${c.L('Cột', 'Columns')}`)), 4),
        m(btn(body, new RegExp(`^${c.L('Lọc', 'Filter')}`)), 5),
        m(btn(body, new RegExp(`^${c.L('Sắp xếp', 'Sort')}`)), 6),
        m(btn(body, new RegExp(`^${c.L('Nhóm', 'Group')}`)), 7),
      ];
    },
  },
  {
    id: 'issues-filter',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'issues');
      await btn(main(c.page), new RegExp(`^${c.L('Lọc', 'Filter')}`)).click();
      const panel = c.page.getByRole('dialog', { name: c.L('Bộ lọc', 'Filters') });
      await expect(panel).toBeVisible();
      return [m(panel, 1)];
    },
    close: pressEscape,
  },
  {
    id: 'issues-columns',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'issues');
      await btn(main(c.page), new RegExp(`^${c.L('Cột', 'Columns')}`)).click();
      // Menu nổi của Radix (popover hay dropdown) nằm trong lớp bọc popper.
      const panel = c.page.locator('[data-radix-popper-content-wrapper]').last();
      await expect(panel).toBeVisible();
      return [m(panel, 1)];
    },
    close: pressEscape,
  },
  {
    id: 'issue-popup',
    as: ALL,
    frame: 'viewport',
    open: async (c) => {
      const popup = await openDemoPopup(c);
      return [
        m(link(popup, c.L('Mở toàn trang', 'Open full page')), 1),
        m(popup.getByTestId('issue-detail-header'), 2),
        m(popup.getByTestId('properties-panel'), 3),
      ];
    },
    close: pressEscape,
  },
  {
    id: 'issue-gate',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, `issues/${c.company.ownerIssue.identifier}`);
      const body = main(c.page);
      return [
        m(btn(body, c.L('Duyệt', 'Approve')), 1),
        m(btn(body, c.L('Yêu cầu sửa', 'Request changes')), 2),
        m(btn(body, c.L('Hủy yêu cầu', 'Cancel request')), 3),
        m(btn(body, c.L('Ép Done', 'Force Done')), 4),
      ];
    },
  },
  {
    id: 'force-done',
    as: ['owner'],
    frame: 'viewport',
    open: async (c) => {
      await go(c, `issues/${c.company.ownerIssue.identifier}`);
      await btn(main(c.page), c.L('Ép Done', 'Force Done')).click();
      const dialog = c.page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await settle(c.page);
      return [m(dialog.getByLabel(c.L('Lý do', 'Reason')), 1)];
    },
    close: pressEscape,
  },
  {
    id: 'new-request',
    as: ['owner'],
    frame: 'viewport',
    open: async (c) => {
      await go(c, 'issues?new=1');
      const dialog = c.page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // Điền như một yêu cầu thật nhưng không bấm Tạo.
      await dialog.getByRole('combobox', { name: 'Project' }).click();
      await c.page.getByRole('option', { name: GUIDE_PROJECTS[0].name, exact: true }).click();
      await dialog
        .getByLabel(c.L('Tiêu đề', 'Title'))
        .fill(c.L('Thêm mã giảm giá cho đơn hàng đầu tiên', 'Add a discount code for the first order'));
      await dialog
        .getByLabel(c.L('Mô tả', 'Description'))
        .fill(
          c.L(
            'Khách mới nhập mã CHAOBAN được giảm 10%. Không áp dụng chung với khuyến mãi khác.',
            'New customers enter CHAOBAN for 10% off. It does not stack with other promotions.',
          ),
        );
      return [
        m(dialog.getByRole('combobox', { name: 'Project' }), 1),
        m(dialog.getByRole('combobox').filter({ hasText: /Code|Bug|Nghiên cứu|Research/ }), 2),
        m(dialog.getByLabel(c.L('Tiêu đề', 'Title')), 3),
        m(dialog.getByLabel(c.L('Mô tả', 'Description')), 4),
        m(btn(dialog, c.L('Lưu nháp (chưa chạy)', 'Save draft (does not run)')), 5),
        m(btn(dialog, new RegExp(`^${c.L('Tạo', 'Create')}$`)), 6),
      ];
    },
    close: pressEscape,
  },
  {
    id: 'inbox',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'inbox');
      return [
        m(main(c.page).getByRole('button', { name: new RegExp(c.L('Chờ tôi duyệt', 'Awaiting my approval')) }), 1),
      ];
    },
  },
  {
    id: 'contribution-new',
    as: ['contributor'],
    frame: 'viewport',
    open: async (c) => {
      await go(c, 'issues?new=1');
      const dialog = c.page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox', { name: 'Project' }).click();
      await c.page.getByRole('option', { name: GUIDE_PROJECTS[0].name, exact: true }).click();
      await dialog
        .getByLabel(c.L('Tiêu đề', 'Title'))
        .fill(c.L('Đổi màu nút Mua ngay sang cam', 'Change the Buy now button to orange'));
      await dialog
        .getByLabel(c.L('Mô tả', 'Description'))
        .fill(c.L('Theo bộ nhận diện mới của chiến dịch.', 'To match the new campaign branding.'));
      return [
        m(dialog.getByRole('combobox', { name: 'Project' }), 1),
        m(dialog.getByLabel(c.L('Tiêu đề', 'Title')), 2),
        m(btn(dialog, c.L('Gửi để owner duyệt', 'Send for approval')), 3),
      ];
    },
    close: pressEscape,
  },
  {
    id: 'contribution-comment',
    as: ['contributor'],
    frame: 'viewport',
    open: async (c) => {
      const popup = await openDemoPopup(c);
      const pending = popup.getByTestId('pending-comment').first();
      await expect(pending).toBeVisible();
      // Ô soạn dính ở đáy cửa sổ: cuộn khung chứa tới cuối để bình luận chờ hiện ngay trên ô soạn.
      await pending.evaluate((el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p);
          if (/(auto|scroll)/.test(style.overflowY) && p.scrollHeight > p.clientHeight) {
            p.scrollTop = p.scrollHeight;
            return;
          }
        }
      });
      await settle(c.page);
      return [m(pending, 1), m(btn(popup, c.L('Gửi để owner duyệt', 'Send for approval')), 2)];
    },
    close: pressEscape,
  },
  {
    id: 'contributions-mine',
    as: ['contributor'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'contributions');
      return [m(main(c.page).getByRole('tablist'), 1)];
    },
  },
  {
    id: 'contributions-owner',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'contributions');
      const row = c.page.getByTestId('contribution-row').filter({ hasText: GUIDE_DEMO.requestTitle }).first();
      return [
        m(main(c.page).getByRole('tablist'), 1),
        m(btn(row, new RegExp(`^${c.L('Duyệt', 'Approve')}`)), 2),
        m(btn(row, new RegExp(`^${c.L('Từ chối', 'Reject')}`)), 3),
      ];
    },
  },
  {
    id: 'contribution-approve',
    as: ['owner'],
    frame: 'viewport',
    open: async (c) => {
      await go(c, 'contributions');
      const row = c.page.getByTestId('contribution-row').filter({ hasText: GUIDE_DEMO.requestTitle }).first();
      await btn(row, new RegExp(`^${c.L('Duyệt', 'Approve')}`)).click();
      const dialog = c.page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await settle(c.page);
      return [];
    },
    close: pressEscape,
  },
  {
    id: 'projects',
    as: ['owner', 'viewer'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'projects');
      const body = main(c.page);
      return [
        m(link(body, c.L('Thêm project', 'Add project')).or(btn(body, c.L('Thêm project', 'Add project'))), 1),
        m(body.getByRole('columnheader', { name: c.L('Sẵn sàng', 'Ready') }), 2),
        m(btn(body, c.L('Đang dùng', 'In use')), 3),
      ];
    },
  },
  {
    id: 'project-roles',
    as: ['owner', 'viewer'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'projects');
      await link(main(c.page), GUIDE_PROJECTS[0].name).click();
      await settle(c.page);
      const body = main(c.page);
      await body.getByRole('tab', { name: c.L('Vai trò', 'Roles') }).click();
      await settle(c.page);
      return [
        m(body.getByRole('tablist'), 1),
        m(btn(body, c.L('Sửa vai trò', 'Edit roles')), 2),
        m(btn(body, c.L('Gỡ project', 'Remove project')).or(link(body, c.L('Gỡ project', 'Remove project'))), 3),
      ];
    },
  },
  {
    id: 'add-project',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'projects/new');
      return [];
    },
  },
  {
    id: 'agents',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'agents');
      const body = main(c.page);
      return [
        m(link(body, c.L('Tạo agent', 'Create agent')).or(btn(body, c.L('Tạo agent', 'Create agent'))), 1),
        m(btn(body, c.L('Đang chạy', 'Running')), 2),
      ];
    },
  },
  {
    id: 'agent-detail',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'agents');
      await link(main(c.page), GUIDE_DEMO.agentName).click();
      await settle(c.page);
      const body = main(c.page);
      return [
        m(body.getByRole('tablist'), 1),
        m(btn(body, c.L('Gỡ agent', 'Remove agent')).or(link(body, c.L('Gỡ agent', 'Remove agent'))), 2),
      ];
    },
  },
  {
    id: 'add-agent',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'agents/new');
      return [];
    },
  },
  {
    id: 'skills',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'skills');
      return [m(btn(main(c.page), c.L('Thêm skill', 'Add skill')), 1)];
    },
  },
  {
    id: 'machines',
    as: ['owner', 'operator'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'machines');
      // Thẻ máy chưa gỡ (có nút Gỡ máy với owner) để ảnh có đủ nhãn ghép, nút gỡ và khối Runtime.
      const card = main(c.page)
        .locator('[data-online]')
        .filter({ hasNotText: new RegExp(c.L('Đã gỡ \\d', 'Unpaired \\d')) })
        .first();
      await card.scrollIntoViewIfNeeded();
      await c.page.evaluate(() => document.querySelector('main')?.scrollBy(0, -16));
      await settle(c.page);
      return [
        m(btn(card, c.L('Gỡ máy', 'Unpair machine')), 1),
        m(card.getByText(new RegExp(c.L('^Đã (ghép|gỡ) ', '^(Paired|Unpaired) '))), 2),
        m(card.getByText(/^Runtime /), 3),
        m(card.getByText(new RegExp(c.L('^(Trực tuyến|Mất liên lạc)$', '^(Online|Offline)$'))), 4),
      ];
    },
  },
  {
    id: 'machine-unpair',
    as: ['owner'],
    frame: 'viewport',
    open: async (c) => {
      await go(c, 'machines');
      const unpair = btn(main(c.page), c.L('Gỡ máy', 'Unpair machine'));
      await unpair.scrollIntoViewIfNeeded();
      await unpair.click();
      const dialog = c.page.getByRole('alertdialog').or(c.page.getByRole('dialog'));
      await expect(dialog.first()).toBeVisible();
      await settle(c.page);
      return [];
    },
    close: pressEscape,
  },
  {
    id: 'docs',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'docs');
      const body = main(c.page);
      const page = body.getByText(/Phí vận chuyển$/).first();
      await page.click();
      await settle(c.page);
      return [m(page, 1), m(body.getByLabel(c.L('Tìm trong tài liệu', 'Search the docs')), 2)];
    },
  },
  {
    id: 'members',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'members');
      const body = main(c.page);
      return [
        m(btn(body, c.L('Mời Phòng Marketing', 'Invite Marketing')), 1),
        m(btn(body, new RegExp(c.L('(Đặt|Gỡ) Phòng Marketing', '(Set|Remove) Marketing'))), 2),
      ];
    },
  },
  {
    id: 'project-access',
    as: ['owner'],
    frame: 'viewport',
    open: async (c) => {
      await go(c, 'members');
      const row = main(c.page).getByTestId('member-row').filter({ hasText: GUIDE_ACCOUNTS.viewer.name });
      const trigger = row.getByTestId('project-access-trigger');
      await trigger.click();
      const editor = c.page.getByTestId('project-access-editor');
      await expect(editor).toBeVisible();
      await settle(c.page);
      return [
        m(trigger, 1),
        m(editor.getByRole('checkbox').first(), 2),
        m(btn(editor, c.L('Lưu', 'Save')), 3),
      ];
    },
    close: pressEscape,
  },
  {
    id: 'settings',
    as: ['owner'],
    frame: 'main',
    open: async (c) => {
      await go(c, 'settings');
      return [];
    },
  },
  {
    id: 'stock-ui',
    as: ['owner'],
    frame: 'viewport',
    open: async (c) => {
      await go(c, 'dashboard');
      return [m(link(aside(c.page), c.L('Mở giao diện Paperclip gốc', 'Open original Paperclip UI')), 1)];
    },
  },
];

/** Mỗi vai trò một phiên đăng nhập, dùng lại cho cả hai ngôn ngữ (Better Auth giới hạn số lần đăng nhập mỗi phút). */
async function sessions(browser: Browser): Promise<Record<Role, StorageState | string>> {
  const out: Partial<Record<Role, StorageState | string>> = { owner: storageStatePath() };
  for (const role of ['operator', 'viewer', 'contributor'] as const) {
    process.stdout.write(`  đăng nhập ${role}\n`);
    // Context trong ca nhận `use` của config (phiên owner), nên phải bỏ phiên đi mới vào được form đăng nhập.
    const ctx = await browser.newContext({ storageState: EMPTY_STATE });
    try {
      const page = await ctx.newPage();
      await login(page, { emailValue: GUIDE_ACCOUNTS[role].email(), passwordValue: GUIDE_ACCOUNTS[role].password() });
      // Tên hiển thị ở chân thanh bên: đặt lại theo GUIDE_ACCOUNTS (tài khoản dựng ở lượt trước có thể mang tên cũ).
      const renamed = await page.request.post('/api/auth/update-user', {
        data: { name: GUIDE_ACCOUNTS[role].name },
        headers: { Origin: new URL(baseUrl()).origin },
      });
      if (!renamed.ok()) throw new Error(`Không đổi được tên ${role}: HTTP ${renamed.status()}`);
      out[role] = await ctx.storageState();
    } finally {
      await ctx.close();
    }
  }
  return out as Record<Role, StorageState | string>;
}

function fileName(id: string, role: Role): string {
  const entry = GUIDE_SHOTS.find((s) => s.id === id);
  if (entry?.kind !== 'shot') throw new Error(`Ảnh ${id} không có trong GUIDE_SHOTS`);
  return entry.roles ? `${id}.${role}` : id;
}

test('mỗi ảnh trong GUIDE_SHOTS có cách chụp @t1 @t1-only @guide-shots', () => {
  const ids = GUIDE_SHOTS.filter((s) => s.kind === 'shot').map((s) => s.id);
  expect(RECIPES.map((r) => r.id).sort()).toEqual([...ids].sort());
  for (const r of RECIPES) {
    const roles = GUIDE_SHOTS.find((s) => s.id === r.id)?.roles;
    if (roles) expect(r.as.sort(), r.id).toEqual([...roles].sort());
    else expect(r.as, r.id).toHaveLength(1);
  }
});

for (const lang of ['vi', 'en'] as const) {
  test(`chụp ảnh hướng dẫn (${lang}) @t1 @t1-only @guide-shots`, async ({ browser, api }) => {
    test.setTimeout(15 * 60_000);
    process.stdout.write('  dựng tài khoản và dữ liệu mẫu\n');
    const base = await ensureGuideCompany(api);
    await ensureGuideMembers(api, base.id);
    await api.post('/api/auth/update-user', { name: GUIDE_OWNER_NAME });
    const guest = await guideAccountApi('contributor');
    const company = await seedGuideCompany(api, guest, base).finally(() => guest.dispose());
    process.stdout.write(
      `  company ${company.name} (${company.issuePrefix}), yêu cầu mẫu ${company.ownerIssue.identifier}\n`,
    );
    const states = await sessions(browser);
    const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
    const contexts = new Map<Role, BrowserContext>();
    try {
      for (const recipe of RECIPES.filter((r) => !ONLY || ONLY.has(r.id))) {
        for (const role of recipe.as) {
          let context = contexts.get(role);
          if (!context) {
            context = await browser.newContext({
              storageState: recipe.id === 'login' ? EMPTY_STATE : states[role],
              viewport: SHOT_VIEWPORT,
              locale: lang === 'vi' ? 'vi-VN' : 'en-US',
              timezoneId: 'Asia/Ho_Chi_Minh',
              colorScheme: 'light',
            });
            await prepareContext(context, lang);
            if (recipe.id !== 'login') contexts.set(role, context);
          }
          const page = await context.newPage();
          page.setDefaultTimeout(20_000);
          process.stdout.write(`  ${lang} ${recipe.id} (${role})\n`);
          try {
            const c: ShotCtx = { page, lang, role, company, L };
            const marks = await recipe.open(c);
            await annotate(page, marks);
            await saveShot(page, lang, fileName(recipe.id, role), recipe.frame === 'main' ? main(page) : undefined);
            await clearMarks(page);
            await recipe.close?.(c);
          } finally {
            await page.close();
            if (recipe.id === 'login') await context.close();
          }
        }
      }
    } finally {
      for (const ctx of contexts.values()) await ctx.close();
    }
  });
}
