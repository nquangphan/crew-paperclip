// Chặn an toàn của harness e2e: câu SQL chỉ đọc không được gọi hàm có tác dụng phụ; địa chỉ không cục bộ là prod.

import type { APIRequestContext } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import { assertWriteAllowed } from '../e2e/support/api';
import { formatSql } from '../e2e/support/db';
import { CREW_E2E_PROD_COMPANY_ID, isProd, TPS_COMPANY_ID } from '../e2e/support/env';

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
