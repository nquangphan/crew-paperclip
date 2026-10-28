// Chặn an toàn của harness e2e: câu SQL chỉ đọc không được gọi hàm có tác dụng phụ; địa chỉ không cục bộ là prod.

import type { APIRequestContext } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import { assertWriteAllowed } from '../e2e/support/api';
import { formatSql } from '../e2e/support/db';
import { CREW_E2E_PROD_COMPANY_ID, isProd, TPS_COMPANY_ID } from '../e2e/support/env';
import { instructionsOf } from '../e2e/support/guide-company';
import { agentsToTerminate, selectJunkProjects } from '../e2e/support/junk-projects';
import { renderInstructions } from '../src/lib/instructions';

describe('e2e/support/db formatSql', () => {
  it('nhận SELECT thường và tham số', () => {
    expect(formatSql('select id from issues where id = $1', ['a'])).toBe("select id from issues where id = 'a'");
  });
  it.each([
    'select pg_terminate_backend(pid) from pg_stat_activity',
    'select pg_catalog.pg_terminate_backend (1)',
    'select "pg_terminate_backend"(1)',
    "select set_config('a','b',false)",
    "select nextval('s')",
  ])('từ chối %s', (sql) => {
    expect(() => formatSql(sql)).toThrow(/từ chối hàm/);
  });
  it('cho phép tên bảng pg_* và chuỗi chứa tên hàm', () => {
    expect(() => formatSql('select * from pg_stat_activity')).not.toThrow();
    expect(() => formatSql("select 'pg_sleep(1)' as x")).not.toThrow();
  });
});

describe('e2e/support/env isProd', () => {
  const old = process.env.CREW_E2E_BASE_URL;
  afterEach(() => {
    if (old === undefined) delete process.env.CREW_E2E_BASE_URL;
    else process.env.CREW_E2E_BASE_URL = old;
  });
  it.each([
    ['https://crew.2p-solutions.com', true],
    ['https://crew.2p-solutions.com.', true],
    ['https://CREW.2p-solutions.com', true],
    ['http://203.0.113.5', true],
    ['http://127.0.0.1:5183', false],
    ['http://localhost:5183', false],
  ])('%s → %s', (url, expected) => {
    process.env.CREW_E2E_BASE_URL = url;
    expect(isProd()).toBe(expected);
  });
});

describe('e2e/support/api assertWriteAllowed (guard ghi prod)', () => {
  const old = process.env.CREW_E2E_BASE_URL;
  const E2E = CREW_E2E_PROD_COMPANY_ID;
  const ctx = { get: async () => ({ ok: () => false }) } as unknown as APIRequestContext;
  const run = (method: string, path: string, body?: unknown) => assertWriteAllowed(ctx, method, path, body);
  afterEach(() => {
    if (old === undefined) delete process.env.CREW_E2E_BASE_URL;
    else process.env.CREW_E2E_BASE_URL = old;
  });

  describe('trên prod', () => {
    it.each([
      ['POST', `/api/crew/companies/${E2E}/contributions`],
      ['POST', `/api/crew/companies/${E2E}/contributions/abc/approve`],
      ['PUT', `/api/crew/companies/${E2E}/contributors/u1`],
      ['POST', `/api/companies/${E2E}/issues`],
    ])('cho phép %s %s', async (method, path) => {
      process.env.CREW_E2E_BASE_URL = 'https://crew.2p-solutions.com';
      await expect(run(method, path, {})).resolves.toBeUndefined();
    });

    it.each([
      ['POST', `/api/crew/companies/${TPS_COMPANY_ID}/contributions`],
      ['POST', '/api/crew/companies/11111111-1111-1111-1111-111111111111/contributions'],
      ['POST', `/api/crew/companies/${E2E}x/contributions`],
      ['POST', `/api/crew/companies/${E2E}/../${TPS_COMPANY_ID}/contributions`],
      ['POST', `/api/crew/companies/${E2E}/%2e%2e/contributions`],
      ['POST', '/api/crew/companies'],
      ['PUT', `/api/crew/companies/${E2E}/contributors/${TPS_COMPANY_ID}`],
    ])('từ chối %s %s', async (method, path) => {
      process.env.CREW_E2E_BASE_URL = 'https://crew.2p-solutions.com';
      await expect(run(method, path, {})).rejects.toThrow(/Từ chối/);
    });

    it('từ chối khi thân lời gọi nhắc TPS', async () => {
      process.env.CREW_E2E_BASE_URL = 'https://crew.2p-solutions.com';
      await expect(run('POST', `/api/crew/companies/${E2E}/contributions`, { x: TPS_COMPANY_ID })).rejects.toThrow(
        /TPS/,
      );
    });
  });

  it('ngoài prod không chặn', async () => {
    process.env.CREW_E2E_BASE_URL = 'http://127.0.0.1:5183';
    await expect(run('POST', '/api/crew/companies/anything/contributions')).resolves.toBeUndefined();
  });
});

describe('e2e/support/junk-projects', () => {
  const runs = [
    { projectKey: 'e2e-base', projectId: 'p-base' },
    { projectKey: 'e2e-rm-abc1234', projectId: 'p-rm' },
  ];
  const projects = [
    { id: 'p-base', name: 'E2E base' },
    { id: 'p-old', name: 'E2E base 2' },
    { id: 'p-rm', name: 'E2E gỡ e2e-rm-abc1234' },
    { id: 'p-s4', name: 'PW-S4-2 s42abc' },
    { id: 'p-neg', name: 'e2e-neg-xyz' },
    { id: 'p-real', name: 'Dự án thật' },
  ];
  const ctx = { baseProjectId: 'p-base', baseKey: 'e2e-base', runs };

  it('chọn project rác theo tiền tố, giữ base hiện hành và project lạ', () => {
    const ids = selectJunkProjects(projects, ctx).map((j) => j.project.id);
    expect(ids).toEqual(['p-old', 'p-rm', 'p-s4', 'p-neg']);
  });
  it('không chọn project có khóa setup run là base dù tên giống rác', () => {
    const odd = [{ id: 'p-x', name: 'E2E base 3' }];
    const r = [{ projectKey: 'e2e-base', projectId: 'p-x' }];
    expect(selectJunkProjects(odd, { baseKey: 'e2e-base', runs: r })).toEqual([]);
  });
  it('lấy khóa từ setup run và từ tên project', () => {
    const [, rm] = selectJunkProjects(projects, ctx);
    expect(rm?.keys).toEqual(['e2e-rm-abc1234']);
    const named = selectJunkProjects([{ id: 'n', name: 'E2E gỡ e2e-rm-zzz9' }], { baseKey: 'e2e-base', runs: [] });
    expect(named[0]?.keys).toEqual(['e2e-rm-zzz9']);
  });
  it('chỉ terminate agent chưa terminated đúng khóa, không đụng khóa gần giống', () => {
    const agents = [
      { id: '1', name: 'e2e-rm-abc1234-assistant', status: 'paused' },
      { id: '2', name: 'e2e-rm-abc1234-executor-1', status: 'terminated' },
      { id: '3', name: 'e2e-rm-abc12345-assistant', status: 'idle' },
      { id: '4', name: 'e2e-base-assistant', status: 'idle' },
    ];
    expect(agentsToTerminate(agents, ['e2e-rm-abc1234']).map((a) => a.id)).toEqual(['1']);
  });
  it('khớp chính xác vai trò wizard tạo, không terminate agent của khóa là phần mở rộng của khóa khác', () => {
    const agents = [
      ...[
        'assistant',
        'executor',
        'executor-2',
        'executor-codex',
        'executor-opencode',
        'reviewer',
        'reviewer-codex',
        'integrator',
        'bmad',
      ].map((role, i) => ({ id: `ok${i}`, name: `e2e-base-${role}`, status: 'idle' })),
      { id: 'v2a', name: 'e2e-base-v2-assistant', status: 'idle' },
      { id: 'v2e', name: 'e2e-base-v2-executor-2', status: 'idle' },
      { id: 'x', name: 'e2e-base-assistant-extra', status: 'idle' },
      { id: 'y', name: 'e2e-base-other', status: 'idle' },
    ];
    expect(agentsToTerminate(agents, ['e2e-base']).map((a) => a.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `ok${i}`),
    );
    expect(agentsToTerminate(agents, ['e2e-base-v2']).map((a) => a.id)).toEqual(['v2a', 'v2e']);
  });
  it('không dọn project tạo trong 60 phút gần nhất (lượt E2E khác có thể đang dùng)', () => {
    const now = Date.parse('2026-10-19T10:00:00+07:00');
    const list = [
      { id: 'new', name: 'PW-S4-2 new', createdAt: '2026-10-19T09:30:00+07:00' },
      { id: 'edge', name: 'PW-S4-2 edge', createdAt: '2026-10-19T09:00:00+07:00' },
      { id: 'old', name: 'PW-S4-2 old', createdAt: '2026-10-19T08:59:59+07:00' },
      { id: 'none', name: 'PW-S4-2 none' },
    ];
    const ids = selectJunkProjects(list, { baseKey: 'e2e-base', runs: [], now }).map((j) => j.project.id);
    expect(ids).toEqual(['edge', 'old', 'none']);
  });
});

describe('e2e/support/guide-company instructionsOf', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const E1 = '22222222-2222-4222-8222-222222222222';
  it('AGENTS.md của Trợ Lý trùng từng byte bản render của web (có mục UIUX rỗng)', () => {
    const text = instructionsOf('assistant', [E1]);
    expect(text).toBe(renderInstructions('assistant', { agentId: A, executorIds: [E1] }));
    expect(text).toContain('\n## Agent UIUX của company\n\nKhông có. Không tạo con thiết kế; làm như cũ.\n');
  });
  it('vai khác là nguyên template', () => {
    expect(instructionsOf('reviewer', [])).toBe(renderInstructions('reviewer', { agentId: A }));
  });
});
