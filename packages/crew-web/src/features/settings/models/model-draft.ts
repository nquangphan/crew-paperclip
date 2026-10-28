// Bản nháp của trang Cài đặt model: các phép sửa thuần trên `ModelSettings` (không đổi bản gốc) và cách khớp lỗi server
// với từng ô. Luật hợp lệ thật do server kiểm; ở đây chỉ giữ cho bản nháp luôn đúng dạng để ô nhập không vỡ.
import type {
  ModelCell,
  ModelComplexity,
  ModelEffort,
  ModelEffortKey,
  ModelRole,
  ModelRuntime,
  ModelSettings,
  ModelSettingsIssue,
} from '@/api';

export const RUNTIMES: readonly ModelRuntime[] = ['claude_local', 'codex_local', 'opencode_local'];
export const LEVELS: readonly ModelComplexity[] = ['trivial', 'small', 'medium', 'large'];
export const ROLES: readonly ModelRole[] = [
  'assistant',
  'executor',
  'reviewer',
  'integrator',
  'bmad',
  'designer',
  'executor-codex',
  'executor-opencode',
  'reviewer-codex',
  'reviewer-root',
];
export const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high'];
export const EFFORT_KEYS: readonly ModelEffortKey[] = ['effort', 'modelReasoningEffort', null];

/** Runtime cố định của từng vai (spec: `reviewer-root` là override của reviewer Claude nên chạy Claude). */
export const ROLE_RUNTIME: Readonly<Record<ModelRole, ModelRuntime>> = {
  assistant: 'claude_local',
  executor: 'claude_local',
  reviewer: 'claude_local',
  integrator: 'claude_local',
  bmad: 'claude_local',
  designer: 'claude_local',
  'executor-codex': 'codex_local',
  'executor-opencode': 'opencode_local',
  'reviewer-codex': 'codex_local',
  'reviewer-root': 'claude_local',
};

/** Vai luôn có effort (cấu hình agent Codex và override reviewer luôn mang effort). */
export const EFFORT_REQUIRED_ROLES: ReadonlySet<ModelRole> = new Set<ModelRole>([
  'executor-codex',
  'reviewer-codex',
  'reviewer-root',
]);

export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
export const MAX_MODELS = 20;

export const cloneSettings = (s: ModelSettings): ModelSettings => JSON.parse(JSON.stringify(s)) as ModelSettings;

/** JSON với khóa đối tượng đã sắp xếp (mảng giữ nguyên thứ tự): jsonb của Postgres trả khóa theo thứ tự riêng. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sameSettings = (a: ModelSettings, b: ModelSettings): boolean => canonical(a) === canonical(b);

/** Chỗ đang dùng một model trong bản nháp: ô bảng độ khó và vai. */
export interface ModelUsage {
  levels: ModelComplexity[];
  roles: ModelRole[];
}

export function modelUsage(s: ModelSettings, runtime: ModelRuntime, model: string): ModelUsage {
  return {
    levels: LEVELS.filter((level) => s.catalog[runtime].byComplexity[level]?.model === model),
    roles: ROLES.filter((role) => ROLE_RUNTIME[role] === runtime && s.roles[role].model === model),
  };
}

export const isUsed = (u: ModelUsage): boolean => u.levels.length + u.roles.length > 0;

/** Effort mặc định khi một ô phải có effort mà bản nháp chưa có. */
const FALLBACK_EFFORT: ModelEffort = 'medium';

function withRuntime(s: ModelSettings, runtime: ModelRuntime, patch: Partial<ModelSettings['catalog'][ModelRuntime]>) {
  return { ...s, catalog: { ...s.catalog, [runtime]: { ...s.catalog[runtime], ...patch } } } as ModelSettings;
}

export function addModel(s: ModelSettings, runtime: ModelRuntime, id: string, vision: boolean): ModelSettings {
  return withRuntime(s, runtime, { models: { ...s.catalog[runtime].models, [id]: { vision } } });
}

export function removeModel(s: ModelSettings, runtime: ModelRuntime, id: string): ModelSettings {
  const { [id]: _removed, ...rest } = s.catalog[runtime].models;
  return withRuntime(s, runtime, { models: rest });
}

export function setVision(s: ModelSettings, runtime: ModelRuntime, id: string, vision: boolean): ModelSettings {
  return withRuntime(s, runtime, { models: { ...s.catalog[runtime].models, [id]: { vision } } });
}

/**
 * Đổi key effort của runtime và chỉnh effort các ô cho khớp luật: không còn key thì mọi effort về `null`; có key thì ô
 * bảng độ khó và vai bắt buộc effort mà đang trống nhận `medium`.
 */
export function setEffortKey(s: ModelSettings, runtime: ModelRuntime, key: ModelEffortKey): ModelSettings {
  const byComplexity: Partial<Record<ModelComplexity, ModelCell>> = {};
  for (const level of LEVELS) {
    const cell = s.catalog[runtime].byComplexity[level];
    if (cell) byComplexity[level] = { ...cell, effort: key === null ? null : (cell.effort ?? FALLBACK_EFFORT) };
  }
  const next = withRuntime(s, runtime, { effortKey: key, byComplexity });
  const roles = { ...next.roles };
  for (const role of ROLES) {
    if (ROLE_RUNTIME[role] !== runtime) continue;
    const effort =
      key === null ? null : (roles[role].effort ?? (EFFORT_REQUIRED_ROLES.has(role) ? FALLBACK_EFFORT : null));
    roles[role] = { ...roles[role], effort };
  }
  return { ...next, roles };
}

/** Model đầu tiên của runtime (theo thứ tự catalog), dùng cho ô vừa bật. */
function firstModel(s: ModelSettings, runtime: ModelRuntime, needVision: boolean): string {
  const entries = Object.entries(s.catalog[runtime].models);
  return (entries.find(([, m]) => m.vision || !needVision) ?? entries[0])?.[0] ?? '';
}

/** Bật hoặc tắt một runtime ở một mức: bật thì thêm cuối thứ tự và dựng ô mặc định, tắt thì gỡ khỏi thứ tự và xóa ô. */
export function toggleRuntime(s: ModelSettings, level: ModelComplexity, runtime: ModelRuntime, on: boolean) {
  const order = s.order[level].filter((r) => r !== runtime);
  const byComplexity = { ...s.catalog[runtime].byComplexity };
  if (on) {
    order.push(runtime);
    byComplexity[level] = {
      model: firstModel(s, runtime, level === 'large'),
      effort: s.catalog[runtime].effortKey === null ? null : FALLBACK_EFFORT,
    };
  } else {
    delete byComplexity[level];
  }
  return { ...withRuntime(s, runtime, { byComplexity }), order: { ...s.order, [level]: order } } as ModelSettings;
}

export function moveRuntime(s: ModelSettings, level: ModelComplexity, runtime: ModelRuntime, step: -1 | 1) {
  const order = [...s.order[level]];
  const from = order.indexOf(runtime);
  const to = from + step;
  if (from < 0 || to < 0 || to >= order.length) return s;
  const moved = order[from] as ModelRuntime;
  order[from] = order[to] as ModelRuntime;
  order[to] = moved;
  return { ...s, order: { ...s.order, [level]: order } };
}

export function setCell(
  s: ModelSettings,
  runtime: ModelRuntime,
  level: ModelComplexity,
  patch: Partial<ModelCell>,
): ModelSettings {
  const cell = s.catalog[runtime].byComplexity[level];
  if (!cell) return s;
  return withRuntime(s, runtime, {
    byComplexity: { ...s.catalog[runtime].byComplexity, [level]: { ...cell, ...patch } },
  });
}

export function setRole(s: ModelSettings, role: ModelRole, patch: Partial<ModelCell>): ModelSettings {
  return { ...s, roles: { ...s.roles, [role]: { ...s.roles[role], ...patch } } };
}

/** Đường dẫn lỗi của server cho từng ô (id model giữ nguyên nên có thể chứa `.` và `/`). */
export const path = {
  effortKey: (r: ModelRuntime) => `catalog.${r}.effortKey`,
  models: (r: ModelRuntime) => `catalog.${r}.models`,
  model: (r: ModelRuntime, id: string) => `catalog.${r}.models.${id}`,
  order: (level: ModelComplexity) => `order.${level}`,
  cell: (r: ModelRuntime, level: ModelComplexity) => `catalog.${r}.byComplexity.${level}`,
  role: (role: ModelRole) => `roles.${role}`,
};

/**
 * Lỗi của server áp cho ô ở `at`: lỗi đúng ô, lỗi của ô cha (ví dụ `order.large` cho cả hàng) và, với `deep`, lỗi của ô
 * con (ví dụ `…models.<id>.vision` cho cả dòng model). Lỗi cả bảng (`path: ""`) không gắn vào ô nào.
 */
export function issuesAt(issues: readonly ModelSettingsIssue[], at: string, deep = false): ModelSettingsIssue[] {
  return issues.filter(
    (i) => i.path !== '' && (i.path === at || at.startsWith(`${i.path}.`) || (deep && i.path.startsWith(`${at}.`))),
  );
}

/** Câu lỗi của ô, nối bằng "; "; `undefined` khi không có lỗi. */
export function errorAt(issues: readonly ModelSettingsIssue[], at: string, deep = false): string | undefined {
  const found = issuesAt(issues, at, deep);
  return found.length > 0 ? found.map((i) => i.message).join('; ') : undefined;
}
