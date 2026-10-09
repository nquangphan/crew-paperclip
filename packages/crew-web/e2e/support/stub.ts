// Bật/tắt chế độ stub cho checkout agent E2E trên Mac mini: tệp đánh dấu `crew-e2e-stub` trong git dir của checkout
// (dòng đầu = số giây stub ngủ). Wrapper crew-claude-run chỉ chạy stub khi checkout nằm dưới ~/crew-agents/e2e-*
// và có tệp này, nên stub không bao giờ lọt sang project thật.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { agentsRoot } from './env';

export const STUB_MARKER = 'crew-e2e-stub';
const KEY_RE = /^e2e-[a-z0-9][a-z0-9-]{0,62}$/;

export interface StubCheckout {
  role: string;
  checkout: string;
  gitDir: string;
}

function assertE2eKey(projectKey: string): void {
  if (!KEY_RE.test(projectKey)) throw new Error(`stub chỉ dùng cho project khóa e2e-*: ${projectKey}`);
}

/** Mọi checkout git trực tiếp dưới ~/crew-agents/<projectKey>/ (đường thật phải vẫn nằm dưới thư mục project). */
export function e2eCheckouts(projectKey: string, role?: string): StubCheckout[] {
  assertE2eKey(projectKey);
  const root = path.join(agentsRoot(), projectKey);
  if (!existsSync(root)) return [];
  const realRoot = realpathSync(root);
  // Thư mục project phải còn nằm dưới realpath(agentsRoot)/e2e-*: symlink e2e-x trỏ sang checkout thật thì bỏ.
  if (path.dirname(realRoot) !== realpathSync(agentsRoot()) || !path.basename(realRoot).startsWith('e2e-')) return [];
  const out: StubCheckout[] = [];
  for (const name of readdirSync(root).sort()) {
    if (role && name !== role) continue;
    const checkout = path.join(root, name);
    if (!statSync(checkout).isDirectory() || !existsSync(path.join(checkout, '.git'))) continue;
    const real = realpathSync(checkout);
    if (!real.startsWith(`${realRoot}${path.sep}`)) continue; // symlink trỏ ra ngoài: bỏ
    const gitDir = execFileSync('git', ['-C', real, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
    out.push({ role: name, checkout: real, gitDir });
  }
  return out;
}

export const stub = {
  /** Đặt marker cho mọi checkout (hoặc đúng vai trò `role`) của project; stub ngủ `seconds` giây (0–900). */
  on(projectKey: string, seconds = 5, role?: string): StubCheckout[] {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 900) throw new Error('seconds phải là số nguyên 0–900');
    const list = e2eCheckouts(projectKey, role);
    for (const c of list) writeFileSync(path.join(c.gitDir, STUB_MARKER), `${seconds}\n`, { mode: 0o644 });
    return list;
  },
  /** Gỡ marker; trả các checkout đã gỡ. */
  off(projectKey: string, role?: string): StubCheckout[] {
    const list = e2eCheckouts(projectKey, role);
    for (const c of list) rmSync(path.join(c.gitDir, STUB_MARKER), { force: true });
    return list;
  },
  isOn(c: StubCheckout): boolean {
    return existsSync(path.join(c.gitDir, STUB_MARKER));
  },
  /** Gỡ marker của mọi project e2e-* đang có checkout; trả các checkout đã gỡ. */
  offAll(): StubCheckout[] {
    return this.projectKeys().flatMap((key) => this.off(key));
  },
  /** Các checkout e2e-* còn marker (rỗng = sạch). */
  stillOn(): StubCheckout[] {
    return this.projectKeys()
      .flatMap((key) => e2eCheckouts(key))
      .filter((c) => this.isOn(c));
  },
  /** Mọi project e2e-* đang có checkout dưới ~/crew-agents. */
  projectKeys(): string[] {
    const root = agentsRoot();
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((n) => KEY_RE.test(n))
      .sort();
  },
};
