// Lớp gọi mạng duy nhất của UI Crew: fetch cùng origin, gửi cookie phiên, lỗi thành ApiError.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export interface HttpOptions {
  /** Gửi multipart (upload file); bỏ qua `body`. */
  form?: FormData;
  query?: Query;
  /** 401 là kết quả bình thường (đăng nhập sai, đọc phiên) nên không chuyển về trang đăng nhập. */
  skipUnauthorizedRedirect?: boolean;
  signal?: AbortSignal;
}

/** Lỗi từ server hoặc mạng. `message` giữ nguyên văn câu server trả (không dịch). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: unknown;

  constructor(status: number, message: string, code: string | null = null, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

type UnauthorizedHandler = (to: string) => void;

const defaultUnauthorized: UnauthorizedHandler = (to) => window.location.assign(to);
let onUnauthorized: UnauthorizedHandler = defaultUnauthorized;

/** Router gắn hàm điều hướng SPA; null trả về mặc định (tải lại trang). */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler ?? defaultUnauthorized;
}

/** Đường về trang đăng nhập giữ trang đang mở; null nếu đang ở trang đăng nhập. */
export function loginRedirectPath(loc: { pathname: string; search: string }): string | null {
  if (loc.pathname === '/login') return null;
  return `/login?next=${encodeURIComponent(`${loc.pathname}${loc.search}`)}`;
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, String(v));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Lấy câu lỗi và mã lỗi từ các dạng body Paperclip, better-auth và plugin trả. */
function readError(status: number, body: unknown): { message: string; code: string | null } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const nested = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>) : {};
  const message = str(nested.message) ?? str(b.error) ?? str(b.message) ?? `HTTP ${status}`;
  const code = str(nested.code) ?? str(b.code);
  return { message, code };
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function http<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  opts: HttpOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  let payload: BodyInit | undefined;
  if (opts.form) payload = opts.form;
  else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }

  const res = await send(`${path}${buildQuery(opts.query)}`, {
    method,
    credentials: 'include',
    headers,
    body: payload,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const data = await readBody(res);
  if (!res.ok) throw failure(res.status, data, opts.skipUnauthorizedRedirect);
  return data as T;
}

/** fetch với lỗi mạng đổi thành ApiError (giữ nguyên AbortError để người gọi biết là đã hủy). */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, err instanceof Error ? err.message : String(err), 'network');
  }
}

/** ApiError cho phản hồi lỗi; 401 thì về trang đăng nhập (trừ khi được bảo bỏ qua). */
function failure(status: number, data: unknown, skipUnauthorizedRedirect?: boolean): ApiError {
  const { message, code } = readError(status, data);
  if (status === 401 && !skipUnauthorizedRedirect) {
    const to = loginRedirectPath(window.location);
    if (to) onUnauthorized(to);
  }
  return new ApiError(status, message, code, data);
}

/**
 * GET một đường cùng origin, trả nguyên văn body (không parse JSON) — dùng đọc nội dung file đính kèm dạng chữ.
 * Lỗi giống `http`: ApiError, 401 về trang đăng nhập.
 */
export async function httpText(path: string, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const res = await send(path, { method: 'GET', credentials: 'include', signal: opts.signal });
  if (!res.ok) throw failure(res.status, await readBody(res));
  return res.text();
}
