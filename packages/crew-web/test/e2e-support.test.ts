// Chặn an toàn của harness e2e: câu SQL chỉ đọc không được gọi hàm có tác dụng phụ; địa chỉ không cục bộ là prod.
import { afterEach, describe, expect, it } from 'vitest';
import { formatSql } from '../e2e/support/db';
import { isProd } from '../e2e/support/env';

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
