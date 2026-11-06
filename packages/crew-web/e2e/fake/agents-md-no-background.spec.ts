// Luật "không chạy nền rồi kết thúc lượt" (TPS-741) hiện trên web: template crew/agents/*.md được nhúng nguyên văn
// (`?raw`) vào crew-web; owner mở tab Hướng dẫn của agent, bấm "Render lại theo vai trò", web render template rồi PUT
// AGENTS.md và hiện lại nội dung. API do ca giả (không có stack T1 ở máy chạy); trình duyệt, bundle và render là thật.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, type Route, test } from '@playwright/test';

const ROOT = join(import.meta.dirname, '../../../..');
const COMPANY = { id: 'c-tps', name: '2P Solutions', issuePrefix: 'TPS' };
const ID = {
  assistant: 'a1111111-1111-4111-8111-111111111111',
  executor: 'e2222222-2222-4222-8222-222222222222',
  reviewer: 'b4444444-4444-4444-8444-444444444444',
  integrator: 'c5555555-5555-4555-8555-555555555555',
};
const ROLES = [
  { role: 'assistant', name: 'Trợ Lý' },
  { role: 'executor', name: 'Executor' },
  { role: 'reviewer', name: 'Reviewer' },
  { role: 'integrator', name: 'Integrator' },
] as const;
// bmad và designer cố ý ngoài phạm vi E2E này: tab Hướng dẫn chỉ có "Render lại theo vai trò" cho agent giữ một ô vai trò
// của project (assistant, executor*, reviewer*, integrator; `HeldRole` ở features/agents/use-agent-roles.ts). Hai vai này
// không có ô vai trò trong project nên web không có đường render AGENTS.md cho agent bmad/designer. Luật của chúng vẫn được
// khóa ở chỗ khác: instructions.test.mjs (đoạn luật giống hệt ở 6 template) và render.test.ts (web render khớp từng byte
// fixture bmad.md, designer.md). Test cuối file giữ 4 + 2 vai này đúng bằng số template trong crew/agents.
const ROLES_OUT_OF_SCOPE = ['bmad', 'designer'] as const;
const SESSION = {
  session: { id: 's1', userId: 'u1' },
  user: { id: 'u1', email: 'owner@example.com', name: 'Owner', image: null },
  sentryDsn: null,
};
const PIN_DIR = '/Users/e2e/.crew/workflows/superpowers/5.0.7';
const RULE_START = 'Chạy lệnh ở chế độ nền rồi kết thúc lượt';

const agentOf = (role: string, name: string) => ({
  id: ID[role as keyof typeof ID],
  companyId: COMPANY.id,
  name,
  urlKey: role,
  icon: null,
  status: 'idle',
  adapterType: 'claude_local',
  adapterConfig: { engine: 'cli', model: 'claude-sonnet-5-5', extraArgs: ['--plugin-dir', PIN_DIR], env: {} },
  runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
  defaultEnvironmentId: null,
  lastHeartbeatAt: null,
  permissions: { canCreateAgents: false, canCreateSkills: false },
});

/** Đoạn luật trong template gốc của repo (nguồn sự thật): đoạn bắt đầu bằng RULE_START. */
function ruleParagraph(role: string): string {
  const text = readFileSync(join(ROOT, 'crew/agents', `${role}.md`), 'utf8');
  const para = text.split('\n\n').find((p) => p.startsWith(RULE_START));
  if (!para) throw new Error(`crew/agents/${role}.md thiếu đoạn luật`);
  return para;
}

interface Fake {
  puts: { agent: string; content: string; baseHash: string | null }[];
  unhandled: string[];
}

async function installFakeApi(page: Page): Promise<Fake> {
  const fake: Fake = { puts: [], unhandled: [] };
  const files = new Map<string, { content: string; contentHash: string }>();
  for (const id of Object.values(ID)) files.set(id, { content: '# Hướng dẫn cũ\n', contentHash: 'h-cu' });
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(
    (u) => u.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      const method = req.method();
      if (path === '/api/auth/get-session') return json(route, SESSION);
      if (path === '/api/companies') return json(route, [COMPANY]);
      if (path === `/api/companies/${COMPANY.id}/projects`)
        return json(route, [{ id: 'p1', companyId: COMPANY.id, urlKey: 'alpha', name: 'Alpha', archivedAt: null }]);
      if (path === '/api/plugins/crew.core/api/projects/p1/roles') {
        return json(route, {
          roles: {
            assistantAgentId: ID.assistant,
            executorAgentIds: [ID.executor],
            reviewerAgentId: ID.reviewer,
            integratorAgentId: ID.integrator,
          },
        });
      }
      if (path.startsWith('/api/plugins/crew.core/data/')) {
        const key = path.slice('/api/plugins/crew.core/data/'.length);
        if (key === 'crew.companies') return json(route, { data: [{ id: COMPANY.id }] });
        return json(route, { data: [] });
      }
      if (/^\/api\/crew\/companies\/[^/]+\/access$/.test(path)) {
        return json(route, { userId: 'u1', membershipRole: 'owner', contributor: false, canApprove: true });
      }
      if (/^\/api\/crew\/companies\/[^/]+\/project-access\/me$/.test(path))
        return json(route, { all: true, projectIds: [] });
      const agentMatch = /^\/api\/agents\/([^/]+)(\/instructions-bundle\/file)?$/.exec(path);
      if (agentMatch) {
        const ref = agentMatch[1] as string;
        const entry = ROLES.find((r) => r.role === ref || ID[r.role] === ref);
        if (!entry) return json(route, { error: 'not found' }, 404);
        if (!agentMatch[2]) return json(route, agentOf(entry.role, entry.name));
        const id = ID[entry.role];
        if (method === 'PUT') {
          const body = req.postDataJSON() as { content: string; baseHash: string | null };
          fake.puts.push({ agent: entry.role, content: body.content, baseHash: body.baseHash });
          files.set(id, { content: body.content, contentHash: `h-${fake.puts.length}` });
        }
        const file = files.get(id);
        return json(route, { path: 'AGENTS.md', ...file });
      }
      fake.unhandled.push(`${method} ${path}`);
      return json(route, { error: `no fake ${method} ${path}` }, 404);
    },
  );
  return fake;
}

test.describe('AGENTS.md trên crew-web có luật không chạy nền', () => {
  for (const { role, name } of ROLES) {
    test(`vai ${role}: Render lại theo vai trò hiện luật trong mục Không bao giờ @t1`, async ({ page }) => {
      const fake = await installFakeApi(page);
      const rule = ruleParagraph(role);
      await page.goto(`/${COMPANY.issuePrefix}/agents/${role}?tab=instructions`);
      await expect(page.getByRole('heading', { name: 'Hướng dẫn cũ' })).toBeVisible();
      await expect(page.getByText(RULE_START)).toHaveCount(0);

      const button = page.getByRole('button', { name: 'Render lại theo vai trò' });
      await expect(button).toBeEnabled();
      await button.click();
      await expect(page.getByText('Đã render lại hướng dẫn theo vai trò.')).toBeVisible();

      // Web gửi đúng bản render: chứa nguyên văn đoạn luật của template gốc, nằm sau mục "Không bao giờ".
      expect(fake.puts).toHaveLength(1);
      const put = fake.puts[0];
      expect(put?.agent).toBe(role);
      expect(put?.baseHash).toBe('h-cu');
      const content = put?.content ?? '';
      expect(content).toContain(rule);
      const never = content.indexOf('## Không bao giờ');
      expect(never).toBeGreaterThanOrEqual(0);
      expect(content.indexOf(rule)).toBeGreaterThan(never);

      // Và nội dung hiện trên web sau khi tải lại: tiêu đề mục, câu luật, các ý chính của luật.
      await expect(page.getByRole('heading', { name: 'Không bao giờ' })).toBeVisible();
      const para = page.getByText(RULE_START);
      await expect(para).toBeVisible();
      // Một cách hiểu thống nhất (TPS-757): chỉ cấm bỏ lệnh nền của run; chờ server đánh thức theo luồng của vai vẫn hợp lệ.
      await expect(para).not.toContainText('không có thông báo đánh thức lại');
      await expect(para).toContainText('lệnh nền của chính run');
      await expect(para).toContainText('chờ server đánh thức theo luồng của vai vẫn hợp lệ');
      await expect(para).toContainText('bằng & trong lượt, ghi $!');
      await expect(para).toContainText('Job do server xếp hàng chạy riêng ngoài run');
      await expect(para).toContainText('không thuộc luật này');
      await expect(para).toContainText('Một lệnh tối đa 10 phút');
      await expect(para).toContainText('không kết thúc lượt để "chờ thông báo"');
      await expect(para.locator('code', { hasText: 'run_in_background' })).toBeVisible();
      // Chỉ phần vỏ (sidebar, issue, agent khác) không được giả; mọi lời gọi của tab Hướng dẫn đều có trả lời.
      expect(fake.unhandled.filter((r) => /instructions-bundle|\/api\/agents\/[^/]+$|roles|projects/.test(r))).toEqual(
        [],
      );
      await page.screenshot({ path: `test-results/agents-md-${role}-${name}.png`, fullPage: true });
    });
  }
});

test('mọi template vai trò hoặc có ca E2E ở trên hoặc được ghi chú loại trừ', () => {
  const templates = readdirSync(join(ROOT, 'crew/agents'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -'.md'.length))
    .sort();
  const covered = [...ROLES.map((r) => r.role), ...ROLES_OUT_OF_SCOPE].sort();
  expect(covered).toEqual(templates);
});
