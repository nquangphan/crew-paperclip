// Không nút chết: mọi route trong company (gom từ src/features/*/routes.tsx như router) được mở bằng dữ liệu thật.
// - `a` phải có href thật; `button`/`[role=menuitem]`/`[role=tab]` bị disabled phải có lý do (title hoặc
//   aria-describedby có chữ), hoặc hết disabled trong 10 giây.
// - Bấm thử từng `button` (bỏ nút `data-destructive`, nút submit, nút đăng xuất): trong 2 giây phải đổi DOM, đổi URL
//   hoặc gửi request. Lựa chọn đang được chọn (aria-pressed/aria-selected/aria-current, data-state on|active) được bỏ. Trong lúc quét, mọi request ghi (không phải GET, trừ data plugin chỉ đọc) bị chặn ở trình duyệt,
//   nên quét không ghi gì lên server; request bị chặn vẫn tính là nút có tác dụng.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import type { Api } from '../support/api';
import { type E2eCompany, expect, test } from '../support/fixtures';

const FEATURES_DIR = path.resolve(import.meta.dirname, '../../src/features');
const CONTROLS = 'button, a, [role="menuitem"], [role="tab"]';
const SKIP_TEXT = /đăng xuất|sign out|log out/i;

/** Đường route của các feature, đọc từ mã nguồn giống router (import.meta.glob '../features/*\/routes.tsx'). */
function featureRoutePaths(dir = FEATURES_DIR): string[] {
  const paths = new Set<string>();
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (!f.isDirectory()) continue;
    let src: string;
    try {
      src = readFileSync(path.join(dir, f.name, 'routes.tsx'), 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(/\bpath:\s*['"`]([^'"`]+)['"`]/g)) paths.add(m[1].replace(/^\//, ''));
  }
  return [...paths].sort();
}

interface Refs {
  issueRef?: string;
  projectRef?: string;
  agentRef?: string;
  runId?: string;
}

async function first<T>(api: Api, url: string): Promise<T | undefined> {
  const res = await api.get<T[] | { items?: T[] }>(url);
  return (Array.isArray(res) ? res : (res?.items ?? []))[0];
}

/** Tham số route lấy từ dữ liệu company e2e (ưu tiên project nền e2e-base). */
async function resolveRefs(api: Api, company: E2eCompany): Promise<Refs> {
  const c = company.id;
  const refs: Refs = {};
  const issue = await first<{ identifier?: string; id: string }>(api, `/api/companies/${c}/issues?limit=1`);
  if (issue) refs.issueRef = issue.identifier ?? issue.id;
  refs.projectRef =
    process.env.CREW_E2E_BASE_PROJECT_ID ?? (await first<{ id: string }>(api, `/api/companies/${c}/projects`))?.id;
  const agent = await first<{ id: string }>(api, `/api/companies/${c}/agents`);
  if (agent) {
    refs.agentRef = agent.id;
    refs.runId = (
      await first<{ id: string }>(api, `/api/companies/${c}/heartbeat-runs?agentId=${agent.id}&limit=1`)
    )?.id;
  }
  return refs;
}

function fillParams(route: string, refs: Refs): string | null {
  let missing = false;
  const out = route.replace(/:([A-Za-z]+)/g, (_, name: keyof Refs) => {
    const v = refs[name];
    if (!v) missing = true;
    return encodeURIComponent(v ?? '');
  });
  return missing ? null : out;
}

function isReadOnly(method: string, url: string): boolean {
  return method === 'GET' || method === 'HEAD' || new URL(url).pathname.startsWith('/api/plugins/crew.core/data/');
}

async function blockWrites(page: Page): Promise<{ blocked: string[] }> {
  const state = { blocked: [] as string[] };
  await page.route('**/api/**', (route: Route) => {
    const req = route.request();
    if (isReadOnly(req.method(), req.url())) return route.continue();
    state.blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return route.abort('blockedbyclient');
  });
  return state;
}

interface ControlInfo {
  index: number;
  tag: string;
  role: string | null;
  label: string;
  href: string | null;
  disabled: boolean;
  reason: string;
  destructive: boolean;
  submit: boolean;
  /** Lựa chọn đang được chọn (toggle/tab/đường hiện tại): bấm lại không đổi gì là đúng. */
  selected: boolean;
  visible: boolean;
}

async function listControls(page: Page): Promise<ControlInfo[]> {
  return page.locator(CONTROLS).evaluateAll((els) =>
    els.map((el, index) => {
      const h = el as HTMLElement;
      const r = h.getBoundingClientRect();
      const style = getComputedStyle(h);
      const describedBy = (h.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ');
      return {
        index,
        tag: h.tagName.toLowerCase(),
        role: h.getAttribute('role'),
        label: (h.getAttribute('aria-label') ?? h.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        href: h.tagName === 'A' ? h.getAttribute('href') : null,
        disabled: (h as HTMLButtonElement).disabled === true || h.getAttribute('aria-disabled') === 'true',
        reason: `${h.getAttribute('title') ?? ''} ${describedBy}`.trim(),
        destructive: h.closest('[data-destructive]') !== null,
        submit: h.tagName === 'BUTTON' && (h as HTMLButtonElement).type === 'submit' && h.closest('form') !== null,
        selected:
          h.getAttribute('aria-pressed') === 'true' ||
          h.getAttribute('aria-selected') === 'true' ||
          (h.getAttribute('aria-current') ?? 'false') !== 'false' ||
          ['on', 'active', 'checked'].includes(h.getAttribute('data-state') ?? ''),
        visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      };
    }),
  );
}

function deadLinks(controls: ControlInfo[]): string[] {
  return controls
    .filter((c) => c.visible && c.tag === 'a')
    .filter((c) => !c.href || c.href === '#' || c.href.startsWith('javascript:'))
    .map((c) => `a "${c.label}" href=${c.href ?? '(không có)'}`);
}

function disabledWithoutReason(controls: ControlInfo[]): ControlInfo[] {
  return controls.filter((c) => c.visible && c.tag !== 'a' && c.disabled && !c.reason);
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

/** Bấm nút thứ `index` và chờ tối đa 2 giây xem có đổi DOM, URL hoặc request nào không. */
async function clickHasEffect(page: Page, index: number): Promise<boolean> {
  await page.evaluate(() => {
    const w = window as unknown as { __crewMut: number; __crewObs?: MutationObserver };
    w.__crewObs?.disconnect();
    w.__crewMut = 0;
    w.__crewObs = new MutationObserver((m) => {
      w.__crewMut += m.length;
    });
    w.__crewObs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
  const urlBefore = page.url();
  let requests = 0;
  const onReq = () => {
    requests++;
  };
  page.on('request', onReq);
  try {
    await page.locator(CONTROLS).nth(index).click({ timeout: 5_000 });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const muts = await page.evaluate(() => (window as unknown as { __crewMut: number }).__crewMut).catch(() => 1);
      if (muts > 0 || requests > 0 || page.url() !== urlBefore) return true;
      await page.waitForTimeout(100);
    }
    return false;
  } finally {
    page.off('request', onReq);
  }
}

// '' = trang gốc company (khung shell: sidebar, chọn company, ngôn ngữ, tài khoản) — luôn có.
const routes = ['', ...featureRoutePaths()];

test.describe('không nút chết', () => {
  for (const route of routes) {
    test(`AC5 không nút chết: /${route || '(shell)'} @t1`, async ({ page, api, company }) => {
      test.setTimeout(10 * 60_000);
      const url = fillParams(route, await resolveRefs(api, company));
      test.skip(url === null, `Company e2e chưa có dữ liệu cho tham số của ${route}`);
      const target = company.path(url as string);
      const writes = await blockWrites(page);
      await open(page, target);
      await expect(page.locator('body')).not.toBeEmpty();

      let controls = await listControls(page);
      expect(deadLinks(controls), `link chết ở ${target}`).toEqual([]);
      if (disabledWithoutReason(controls).length) {
        await page.waitForTimeout(10_000);
        controls = await listControls(page);
      }
      expect(
        disabledWithoutReason(controls).map((c) => `${c.tag} "${c.label}"`),
        `control disabled không lý do ở ${target}`,
      ).toEqual([]);

      const clickable = controls.filter(
        (c) =>
          c.visible &&
          c.tag === 'button' &&
          !c.disabled &&
          !c.destructive &&
          !c.submit &&
          !c.selected &&
          !SKIP_TEXT.test(c.label),
      );
      const dead: string[] = [];
      for (const c of clickable) {
        await open(page, target);
        const now = await listControls(page);
        const same = now[c.index];
        if (!same || same.label !== c.label || !same.visible || same.disabled) continue; // trang đổi bố cục: bỏ qua
        if (!(await clickHasEffect(page, c.index))) dead.push(`button "${c.label}" (#${c.index})`);
      }
      test.info().annotations.push({ type: 'crew-e2e-blocked-writes', description: writes.blocked.join(', ') });
      expect(dead, `nút không có tác dụng ở ${target}`).toEqual([]);
    });
  }
});
