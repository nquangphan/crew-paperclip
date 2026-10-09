// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, http, loginRedirectPath, setUnauthorizedHandler } from '@/api/http';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
  setUnauthorizedHandler(null);
  window.history.replaceState(null, '', '/');
});

describe('http', () => {
  it('401 chuyển về /login?next= của trang đang mở và ném ApiError', async () => {
    window.history.replaceState(null, '', '/TPS/issues/TPS-12?tab=docs');
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 401 }));
    const nav = vi.fn();
    setUnauthorizedHandler(nav);
    await expect(http('GET', '/api/companies')).rejects.toMatchObject({ status: 401 });
    expect(nav).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
    expect(nav).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/TPS/issues/TPS-12?tab=docs')}`);
  });

  it('401 không chuyển trang khi gọi với skipUnauthorizedRedirect (đăng nhập sai)', async () => {
    globalThis.fetch = vi.fn(async () =>
      json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, 401),
    );
    const nav = vi.fn();
    setUnauthorizedHandler(nav);
    await expect(
      http('POST', '/api/auth/sign-in/email', { email: 'a', password: 'b' }, { skipUnauthorizedRedirect: true }),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' });
    expect(nav).not.toHaveBeenCalled();
  });

  it('đang ở /login thì 401 không chuyển vòng', () => {
    expect(loginRedirectPath({ pathname: '/login', search: '?next=%2FTPS' })).toBeNull();
    expect(loginRedirectPath({ pathname: '/TPS/dashboard', search: '' })).toBe('/login?next=%2FTPS%2Fdashboard');
  });

  it('4xx giữ nguyên message của server', async () => {
    globalThis.fetch = vi.fn(async () => json({ error: 'reviewer và integrator phải là hai agent khác nhau' }, 400));
    await expect(http('POST', '/api/plugins/crew.core/api/projects/x/roles', {})).rejects.toMatchObject({
      status: 400,
      message: 'reviewer và integrator phải là hai agent khác nhau',
    });
  });

  it('lỗi lồng { error: { code, message } } và lỗi không có body', async () => {
    globalThis.fetch = vi.fn(async () =>
      json({ error: { code: 'agent_cancel_forbidden', message: 'Agent không được hủy' } }, 422),
    );
    const err = await http('PATCH', '/api/issues/x', { status: 'cancelled' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'agent_cancel_forbidden', message: 'Agent không được hủy' });

    globalThis.fetch = vi.fn(async () => new Response('Bad gateway', { status: 502 }));
    await expect(http('GET', '/api/health')).rejects.toMatchObject({ status: 502, message: 'HTTP 502' });
  });

  it('mất mạng ném ApiError status 0, code network', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(http('GET', '/api/health')).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('gửi credentials include và JSON, trả JSON; 204 trả undefined', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(http('POST', '/api/issues/x/read', { a: 1 })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/issues/x/read');
    expect(init?.credentials).toBe('include');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe('{"a":1}');

    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(http('DELETE', '/api/issues/x/read')).resolves.toBeUndefined();
  });

  it('FormData đi nguyên, không đặt content-type; query nối vào URL', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ id: 'a1' }, 201));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.png');
    await http('POST', '/api/companies/c/issues/i/attachments', undefined, {
      form,
      query: { q: 'a b', n: 2, skip: undefined },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/companies/c/issues/i/attachments?q=a+b&n=2');
    expect(init?.body).toBe(form);
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
  });
});
