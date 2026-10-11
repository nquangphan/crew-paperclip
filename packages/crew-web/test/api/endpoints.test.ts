// @vitest-environment jsdom
import { globSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { call, ENDPOINTS, type EndpointKey, endpointPath } from '@/api/endpoints';
import { liveSocketUrl } from '@/app/live/live-events';

const list = (pattern: string) => globSync(pattern, { cwd: process.cwd() }).sort();
const clientFiles = () => list('src/api/{paperclip,crew}/*.ts').filter((f) => !f.endsWith('/types.ts'));
const CALL_RE = /\bcall(?:<[^>]*>)?\(\s*'([\w.]+)'/g;

/** Khóa endpoint một file client gọi thật (quét mã nguồn). */
function calledKeys(file: string): string[] {
  return [...new Set([...readFileSync(file, 'utf8').matchAll(CALL_RE)].map((m) => m[1]))].sort();
}

async function declaredKeys(file: string): Promise<string[]> {
  const mod = (await import(/* @vite-ignore */ `${process.cwd()}/${file}`)) as { __endpoints?: string[] };
  return [...(mod.__endpoints ?? [])].sort();
}

afterEach(() => vi.restoreAllMocks());

describe('ENDPOINTS', () => {
  it('mỗi dòng có mã BA, method, path /api/…', () => {
    for (const [key, def] of Object.entries(ENDPOINTS)) {
      expect(def.ids.length, key).toBeGreaterThan(0);
      for (const id of def.ids) expect(id, key).toMatch(/^S\d+(?:\.\d+)?$/);
      expect(def.path, key).toMatch(/^\/api\//);
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(def.method);
    }
  });

  it('góp ý chờ duyệt có mã BA S20 và đi qua router Crew, không qua route lõi', () => {
    const keys = Object.keys(ENDPOINTS).filter((k) => k.startsWith('contribut') || k === 'access.get');
    expect(keys.sort()).toEqual([
      'access.get',
      'contributions.approve',
      'contributions.complete',
      'contributions.create',
      'contributions.get',
      'contributions.list',
      'contributions.reject',
      'contributions.summary',
      'contributors.list',
      'contributors.remove',
      'contributors.set',
    ]);
    for (const k of keys) {
      const def = ENDPOINTS[k as EndpointKey];
      expect(def.path, k).toMatch(/^\/api\/crew\/companies\/:companyId\//);
      for (const id of def.ids) expect(id, k).toMatch(/^S20\.[1-8]$/);
    }
  });

  it('không trùng (method, path)', () => {
    const seen = Object.values(ENDPOINTS).map((d) => `${d.method} ${d.path}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('mọi file client khai __endpoints đúng bằng các khóa nó gọi', async () => {
    const files = clientFiles();
    expect(files.length).toBeGreaterThanOrEqual(20);
    for (const f of files) expect(await declaredKeys(f), f).toEqual(calledKeys(f));
  });

  it('client dùng hết ENDPOINTS và không gọi khóa lạ', async () => {
    const used = new Set<string>();
    for (const f of clientFiles()) for (const k of await declaredKeys(f)) used.add(k);
    const callable = Object.entries(ENDPOINTS)
      .filter(([, d]) => !('noCall' in d && d.noCall))
      .map(([k]) => k);
    expect([...used].sort()).toEqual(callable.sort());
  });

  it('đường không qua call (link tải file, WebSocket) cũng có dòng và được dùng qua endpointPath', () => {
    const noCall = Object.entries(ENDPOINTS)
      .filter(([, d]) => 'noCall' in d && d.noCall)
      .map(([k]) => k)
      .sort();
    expect(noCall).toEqual(['attachments.content', 'live.events']);
    const src = list('src/**/*.{ts,tsx}')
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const k of noCall) expect(src, k).toContain(`endpointPath('${k}'`);
    expect(api.attachments.contentUrl('a 1')).toBe('/api/attachments/a%201/content');
    expect(liveSocketUrl('c1', { protocol: 'http:', host: 'h' })).toBe('ws://h/api/companies/c1/events/ws');
  });

  it('call từ chối khóa không qua call', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(() => call('attachments.content', { attachmentId: 'a1' })).toThrow(/attachments\.content/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ngoài lớp http không ai gọi fetch hay http() trực tiếp', () => {
    const bad = list('src/**/*.{ts,tsx}').filter((f) => {
      if (f === 'src/api/http.ts' || f === 'src/api/endpoints.ts') return false;
      const text = readFileSync(f, 'utf8');
      return /\bfetch\(/.test(text) || /\bhttp\(/.test(text);
    });
    expect(bad).toEqual([]);
  });

  it('bộ quét bắt được lời gọi (không xanh vì quét rỗng)', () => {
    expect(calledKeys('src/api/paperclip/issues.ts')).toContain('issues.update');
  });
});

describe('endpointPath / call', () => {
  it('thay tham số và mã hóa', () => {
    expect(endpointPath('issues.get', { id: 'TPS 1' })).toBe('/api/issues/TPS%201');
    expect(endpointPath('crew.data', { key: 'crew.roots' })).toBe('/api/plugins/crew.core/data/crew.roots');
  });

  it('thiếu tham số thì ném lỗi, không gọi mạng', () => {
    expect(() => endpointPath('issues.get', {} as { id: string })).toThrow(/id/);
  });

  it('call gửi đúng method và path của dòng ENDPOINTS', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const key: EndpointKey = 'issues.update';
    await call(key, { id: 'i1' }, { body: { status: 'done', comment: 'ok' } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/issues/i1');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
  });
});
