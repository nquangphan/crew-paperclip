// Gọi REST Paperclip và plugin crew.core bằng phiên của lần đăng nhập form (storageState). Dùng để dựng trạng thái
// và kiểm tác dụng thật sau khi bấm trên UI.
import { type APIRequestContext, type APIResponse, request } from '@playwright/test';
import { baseUrl, isProd, storageStatePath, TPS_COMPANY_ID } from './env';

export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 600));
  }
}

const PLUGIN = '/api/plugins/crew.core';

/** Chặn ghi chéo: trên prod mọi lời gọi ghi có nhắc tới TPS trong đường dẫn hoặc body đều bị từ chối. */
function assertWriteAllowed(method: string, path: string, body: unknown): void {
  if (method === 'GET' || !isProd()) return;
  if (path.startsWith(`${PLUGIN}/data/`)) return; // data plugin chỉ đọc
  const text = `${path} ${body === undefined ? '' : JSON.stringify(body)}`;
  if (text.includes(TPS_COMPANY_ID)) throw new Error(`Từ chối ghi vào TPS: ${method} ${path}`);
}

async function parse(res: APIResponse): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class Api {
  constructor(readonly ctx: APIRequestContext) {}

  /** Gửi một lời gọi, trả `{status, body}` (không ném) — dùng cho ca âm. */
  async raw(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
    assertWriteAllowed(method, path, body);
    const res = await this.ctx.fetch(path, {
      method,
      ...(body === undefined ? {} : { data: body }),
      ...(headers ? { headers } : {}),
    });
    return { status: res.status(), body: await parse(res) };
  }

  async call<T = unknown>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const r = await this.raw(method, path, body, headers);
    if (r.status >= 400) throw new ApiError(method, path, r.status, r.body);
    return r.body as T;
  }

  get<T = unknown>(path: string) {
    return this.call<T>('GET', path);
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.call<T>('POST', path, body ?? {});
  }
  patch<T = unknown>(path: string, body: unknown) {
    return this.call<T>('PATCH', path, body);
  }
  put<T = unknown>(path: string, body: unknown) {
    return this.call<T>('PUT', path, body);
  }
  delete<T = unknown>(path: string) {
    return this.call<T>('DELETE', path);
  }

  /** Data plugin: POST /api/plugins/crew.core/data/<key> → `data`. */
  async crewData<T = unknown>(key: string, companyId: string | null, params: Record<string, unknown> = {}) {
    const p = { ...(companyId ? { companyId } : {}), ...params };
    const res = await this.post<{ data: T }>(`${PLUGIN}/data/${key}`, {
      ...(companyId ? { companyId } : {}),
      params: p,
    });
    return res.data;
  }

  /** Route plugin: /api/plugins/crew.core/api/<path>. */
  crewRoute<T = unknown>(method: string, path: string, body?: unknown) {
    return this.call<T>(method, `${PLUGIN}/api${path}`, body);
  }

  dispose() {
    return this.ctx.dispose();
  }
}

/** Context REST dùng phiên đăng nhập form đã lưu. Header Origin cần cho board mutation guard. */
export async function boardApi(statePath = storageStatePath()): Promise<Api> {
  const url = baseUrl();
  const ctx = await request.newContext({
    baseURL: url,
    storageState: statePath,
    extraHTTPHeaders: { Origin: new URL(url).origin },
  });
  return new Api(ctx);
}

/** Context REST bằng bearer token (key agent tạm của ca âm); không mang cookie board. */
export async function bearerApi(token: string): Promise<Api> {
  const url = baseUrl();
  const ctx = await request.newContext({
    baseURL: url,
    extraHTTPHeaders: { Authorization: `Bearer ${token}`, Origin: new URL(url).origin },
  });
  return new Api(ctx);
}
