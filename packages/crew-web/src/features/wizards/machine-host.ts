// Máy ↔ host SSH, và chỗ của project trên máy (máy, checkout, repo gốc) suy từ agent vai trò đang có. Dùng chung cho
// wizard thêm project, tạo agent (chọn environment mẫu đúng máy) và form tạo agent (điền sẵn máy và folder).

/** Phần của bản ghi máy (`crew.machines`) mà phần suy luận cần. */
export interface HostMachine {
  machineId: string;
  hostname?: string;
  latest?: { checkouts?: readonly ({ path?: unknown } | null)[] | null } | null;
  pairing?: { environmentId: string | null; tailscaleIp: string | null } | null;
}

/** Phần của environment mà phần suy luận cần. */
export interface HostEnvironment {
  id: string;
  config: Record<string, unknown>;
}

const hostOf = (env: HostEnvironment | undefined): string | null => {
  const host = env?.config.host;
  return typeof host === 'string' && host !== '' ? host : null;
};

const pathOf = (env: HostEnvironment | undefined): string | null => {
  const path = env?.config.remoteWorkspacePath;
  return typeof path === 'string' && path !== '' ? path : null;
};

const checkoutPaths = (machine: HostMachine): string[] =>
  (machine.latest?.checkouts ?? []).flatMap((c) => (typeof c?.path === 'string' ? [c.path] : []));

/** Host mà lần ghép cặp ghi cho máy: IP Tailscale, rồi host của environment ghép cặp. */
function pairedHost(machine: HostMachine, envs: readonly HostEnvironment[]): string | null {
  const ip = machine.pairing?.tailscaleIp;
  if (typeof ip === 'string' && ip !== '') return ip;
  const envId = machine.pairing?.environmentId;
  return envId ? hostOf(envs.find((env) => env.id === envId)) : null;
}

/**
 * Host SSH của máy. Ưu tiên lần ghép cặp (IP Tailscale, environment ghép cặp). Máy ghép tay thì lấy host mà đa số
 * environment trỏ checkout CHỈ máy này báo đang dùng (hai máy cùng tên user có cùng đường `~/crew-agents/...`, đường
 * cả hai cùng báo thì không tính), bỏ host đã thuộc lần ghép cặp của máy khác. Hòa phiếu hay không có gì: null.
 */
export function machineHost(
  machine: HostMachine,
  machines: readonly HostMachine[],
  envs: readonly HostEnvironment[],
): string | null {
  const paired = pairedHost(machine, envs);
  if (paired) return paired;
  const others = machines.filter((m) => m.machineId !== machine.machineId);
  const foreignHosts = new Set(others.flatMap((m) => pairedHost(m, envs) ?? []));
  const foreignPaths = new Set(others.flatMap(checkoutPaths));
  const own = new Set(checkoutPaths(machine).filter((p) => !foreignPaths.has(p)));
  const votes = new Map<string, number>();
  for (const env of envs) {
    const path = pathOf(env);
    const host = hostOf(env);
    if (!path || !host || !own.has(path) || foreignHosts.has(host)) continue;
    votes.set(host, (votes.get(host) ?? 0) + 1);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || (second && second[1] === first[1])) return null;
  return first[0];
}

/** Máy có host SSH `host` (đúng một máy), hoặc null. */
export function machineOfHost(
  host: string,
  machines: readonly HostMachine[],
  envs: readonly HostEnvironment[],
): HostMachine | null {
  const found = machines.filter((m) => machineHost(m, machines, envs) === host);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** Checkout của khóa trên máy: `<home>/crew-agents/<khóa>/<ô>`. */
export const CHECKOUT_RE = /\/crew-agents\/([a-z][a-z0-9-]{1,30})\/[^/]+$/;

export interface ProjectPlacementInput {
  /** Khóa project (đã suy); rỗng thì không suy được gì từ checkout. */
  key: string;
  /** Environment mặc định của các agent vai trò của project. */
  roleEnvs: readonly HostEnvironment[];
  machines: readonly HostMachine[];
  envs: readonly HostEnvironment[];
}

/**
 * Máy đang chạy agent vai trò của project: máy có host SSH của environment agent, rồi máy báo có checkout của
 * environment đó, rồi máy duy nhất báo có checkout của khóa. Các agent chỉ ra nhiều máy khác nhau thì không đoán ('').
 */
export function projectMachine({ key, roleEnvs, machines, envs }: ProjectPlacementInput): string {
  const found = new Set<string>();
  for (const env of roleEnvs) {
    const host = hostOf(env);
    const byHost = host ? machineOfHost(host, machines, envs) : null;
    const path = pathOf(env);
    const byPath = path ? machines.filter((m) => checkoutPaths(m).includes(path)) : [];
    const machine = byHost ?? (byPath.length === 1 ? byPath[0] : null);
    if (machine) found.add(machine.machineId);
  }
  if (found.size === 1) return [...found][0] as string;
  if (found.size > 1 || !key) return '';
  const under = `/crew-agents/${key}/`;
  const holders = machines.filter((m) => checkoutPaths(m).some((p) => p.includes(under)));
  return holders.length === 1 ? (holders[0]?.machineId ?? '') : '';
}

/**
 * Một checkout của project trên máy `machineId` để hỏi ra repo gốc: checkout của agent vai trò mà máy đó báo, rồi
 * checkout bất kỳ của khóa máy đó báo. Không có thì null.
 */
export function projectCheckoutOn(
  machineId: string,
  { key, roleEnvs, machines }: Omit<ProjectPlacementInput, 'envs'>,
): string | null {
  const machine = machines.find((m) => m.machineId === machineId);
  if (!machine || !key) return null;
  const reported = checkoutPaths(machine).filter((p) => CHECKOUT_RE.exec(p)?.[1] === key);
  const role = roleEnvs.map(pathOf).find((p): p is string => p !== null && reported.includes(p));
  return role ?? reported[0] ?? null;
}

/**
 * Repo gốc trong lỗi của app Mac khi kiểm folder là worktree phụ (`<path> là worktree phụ của repo <gốc>: ...`). App
 * hiện tại không trả gốc trong kết quả cho worktree phụ, chỉ báo trong câu lỗi này (`folder_not_git`).
 */
const LINKED_WORKTREE_RE = /là worktree phụ của repo (\/.+?): chọn thư mục repo chính/;

export function rootFromInspectError(errorText: string | null | undefined): string | null {
  const root = errorText ? LINKED_WORKTREE_RE.exec(errorText)?.[1] : undefined;
  return root && !isUnderCheckouts(root) ? root : null;
}

/** Đường nằm trong `~/crew-agents/`: là checkout của agent, không phải repo gốc của owner. */
export const isUnderCheckouts = (path: string): boolean => /\/crew-agents(\/|$)/.test(path);
