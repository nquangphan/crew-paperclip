// Biến môi trường của harness e2e. Mật khẩu chỉ đến từ run-e2e.sh (đọc .env VPS qua stdin), không có giá trị mặc định.
import os from 'node:os';
import path from 'node:path';

export type Tier = 't1' | 't2' | 't3';

/** Company Crew E2E trên prod (OP-2). Mọi ca ghi của T2/T3 chỉ chạy trong company này. */
export const CREW_E2E_PROD_COMPANY_ID = 'a7132a14-478e-4226-ae58-3dc03ce923e1';
/** Company thật của owner: ca e2e chỉ được đọc, không bao giờ ghi. */
export const TPS_COMPANY_ID = '5befeb1a-1578-4656-b913-267494592e53';
export const PROD_BASE_URL = 'https://crew.2p-solutions.com';
export const T1_BASE_URL = 'http://127.0.0.1:5183';
/** Project nền dựng một lần bằng wizard, dùng lại cho mọi ca. */
export const BASE_PROJECT_KEY = 'e2e-base';

export function tier(): Tier {
  const t = process.env.CREW_E2E_TIER ?? 't1';
  if (t !== 't1' && t !== 't2' && t !== 't3') throw new Error(`CREW_E2E_TIER không hợp lệ: ${t}`);
  return t;
}

export function baseUrl(): string {
  return process.env.CREW_E2E_BASE_URL ?? (tier() === 't1' ? T1_BASE_URL : PROD_BASE_URL);
}

export function isProd(): boolean {
  return new URL(baseUrl()).hostname === new URL(PROD_BASE_URL).hostname;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến ${name}: chạy qua e2e/support/run-e2e.sh`);
  return v;
}

export function email(): string {
  return required('CREW_E2E_EMAIL');
}

/** Đọc mật khẩu ngay lúc dùng, không lưu vào biến module, không đưa vào chuỗi lỗi. */
export function password(): string {
  return required('CREW_E2E_PASSWORD');
}

export function companyId(): string {
  const id = process.env.CREW_E2E_COMPANY_ID ?? (isProd() ? CREW_E2E_PROD_COMPANY_ID : '');
  if (!id) throw new Error('Thiếu CREW_E2E_COMPANY_ID');
  if (isProd() && id !== CREW_E2E_PROD_COMPANY_ID) {
    throw new Error('Trên prod, ca e2e chỉ chạy trong company Crew E2E');
  }
  return id;
}

/** Thư mục trạng thái tạm của một lượt chạy (storageState...), quyền 0700, run-e2e.sh tạo và xóa. */
export function stateDir(): string {
  return process.env.CREW_E2E_STATE_DIR ?? path.join(os.tmpdir(), 'crew-e2e-state');
}

export function storageStatePath(): string {
  return path.join(stateDir(), 'storage-state.json');
}

/** Gốc checkout agent trên Mac mini (Playwright chạy trên chính máy agent). */
export function agentsRoot(): string {
  return process.env.CREW_E2E_AGENTS_ROOT ?? path.join(os.homedir(), 'crew-agents');
}
