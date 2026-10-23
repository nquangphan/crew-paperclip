import { UUID } from "../shared/db.js";
import { maskUrlUserinfo, sanitizeJobError } from "./sanitize.js";
import {
  CREW_ROLE_SLOTS, type CrewRoleSlot, type JobPayload, type JobResult, KEPT_CHECKOUT_REASONS, type KeptCheckoutReason, MACHINE_JOB_KINDS,
  type MachineJobKind,
} from "./types.js";

/** Same rule as the app's project key. */
const PROJECT_KEY = /^[a-z][a-z0-9-]{1,30}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is rejected
const CONTROL = /[\x00-\x1f\x7f]/;
const REQUIRED_ROLES: readonly CrewRoleSlot[] = ["assistant", "executor", "reviewer", "integrator"];
/** Origin repo cho `ensure-project`: https/ssh/file URL hoặc dạng `user@host:path`. */
const ORIGIN = /^(?:(?:https|ssh|file):\/\/\S+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+)$/;
/** Tên thư mục checkout trên máy (`executor-1` của app, `executor` của wizard web); `repo` để dành cho bản clone. */
const CHECKOUT_NAME = /^[a-z][a-z0-9-]{0,30}$/;
const COMPANION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_ENSURE_ROLES = 8;
const MAX_COMPANIONS = 5;

const KEYS: Record<MachineJobKind, readonly string[]> = {
  "inspect-folder": ["folder"],
  "prepare-checkouts": ["projectKey", "folder", "roles"],
  "agent-workspace": ["projectKey", "folder", "role", "branch"],
  "skill-sync": ["skillId", "slug", "version"],
  check: ["projectKey"],
  "remove-checkouts": ["projectId", "projectKey", "roles", "removeStatusRepo"],
  "skill-remove": ["skillId", "slug"],
  "runtimes-setup": [],
  "ensure-project": ["projectKey", "projectId", "originUrl", "branch", "roles", "companions"],
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** First key outside the allowed list, as the fixed error sentence. */
export function unknownKeyError(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  const key = Object.keys(value).find((name) => !allowed.includes(name));
  return key === undefined ? null : `trường ${key} không được hỗ trợ`;
}

export function folderError(folder: unknown): string | null {
  if (typeof folder !== "string" || !folder.startsWith("/")) return "folder phải là đường tuyệt đối";
  if (folder.length > 4096) return "folder quá dài";
  if (folder.includes("..")) return "folder không được chứa ..";
  if (CONTROL.test(folder)) return "folder có ký tự điều khiển";
  return null;
}

const projectKeyError = (key: unknown) => typeof key === "string" && PROJECT_KEY.test(key) ? null : "projectKey không hợp lệ";
const roleError = (role: unknown) => CREW_ROLE_SLOTS.includes(role as CrewRoleSlot) ? null : "role không hợp lệ";
const branchError = (branch: unknown) =>
  typeof branch === "string" && BRANCH.test(branch) && !branch.startsWith("-") ? null : "branch không hợp lệ";

function rolesError(roles: unknown): string | null {
  if (!Array.isArray(roles)) return "roles phải là mảng";
  for (const item of roles) {
    if (!isObject(item)) return "mỗi phần tử roles phải là object";
    const error = unknownKeyError(item, ["role", "branch"]) ?? roleError(item.role) ?? branchError(item.branch);
    if (error) return error;
  }
  if (roles.length < 4 || roles.length > 5) return "roles phải có 4 hoặc 5 vai trò";
  const seen = new Set<string>();
  for (const { role } of roles as { role: CrewRoleSlot }[]) {
    if (seen.has(role)) return `role ${role} bị trùng`;
    seen.add(role);
  }
  const missing = REQUIRED_ROLES.find((role) => !seen.has(role));
  return missing ? `roles thiếu ${missing}` : null;
}

const checkoutNameOk = (value: unknown): value is string =>
  typeof value === "string" && CHECKOUT_NAME.test(value) && value !== "repo";

/** Tên thư mục checkout cần gỡ: 1 đến 8 tên không trùng (tám ô của wizard hay tên thư mục của app như `executor-1`). */
function roleListError(roles: unknown): string | null {
  if (!Array.isArray(roles)) return "roles phải là mảng";
  for (const role of roles) {
    if (!checkoutNameOk(role)) return "role không hợp lệ";
  }
  if (roles.length < 1 || roles.length > CREW_ROLE_SLOTS.length) return `roles phải có 1 đến ${CREW_ROLE_SLOTS.length} vai trò`;
  const seen = new Set<string>();
  for (const role of roles as string[]) {
    if (seen.has(role)) return `role ${role} bị trùng`;
    seen.add(role);
  }
  return null;
}

const originError = (value: unknown) =>
  typeof value === "string" && value.length <= 500 && !CONTROL.test(value) && ORIGIN.test(value) ? null : "originUrl không hợp lệ";

/** Vai trò của `ensure-project`: 1–8 thư mục checkout không trùng, mỗi cái một nhánh. */
function ensureRolesError(roles: unknown): string | null {
  if (!Array.isArray(roles)) return "roles phải là mảng";
  for (const item of roles) {
    if (!isObject(item)) return "mỗi phần tử roles phải là object";
    const error = unknownKeyError(item, ["role", "branch"]) ?? (checkoutNameOk(item.role) ? null : "role không hợp lệ") ?? branchError(item.branch);
    if (error) return error;
  }
  if (roles.length < 1 || roles.length > MAX_ENSURE_ROLES) return `roles phải có 1 đến ${MAX_ENSURE_ROLES} vai trò`;
  const seen = new Set<string>();
  for (const { role } of roles as { role: string }[]) {
    if (seen.has(role)) return `role ${role} bị trùng`;
    seen.add(role);
  }
  return null;
}

/** Repo đi kèm: tối đa 5, tên khác `repo`, khác tên vai trò và khác nhau. */
function companionsError(list: unknown, roles: readonly { role: string }[]): string | null {
  if (!Array.isArray(list)) return "companions phải là mảng";
  if (list.length > MAX_COMPANIONS) return `companions có tối đa ${MAX_COMPANIONS} repo`;
  const taken = new Set(roles.map((item) => item.role));
  for (const item of list) {
    if (!isObject(item)) return "mỗi phần tử companions phải là object";
    const error = unknownKeyError(item, ["name", "originUrl"])
      ?? (typeof item.name === "string" && COMPANION_NAME.test(item.name) && item.name !== "repo" ? null : "tên repo đi kèm không hợp lệ")
      ?? originError(item.originUrl);
    if (error) return error;
    const name = item.name as string;
    if (taken.has(name)) return `tên repo đi kèm ${name} bị trùng`;
    taken.add(name);
  }
  return null;
}

/**
 * Checks a job payload against its kind before it is queued. Returns the payload tagged with its kind,
 * or the fixed Vietnamese sentence describing the first problem. The app validates again before acting.
 */
export function validateJobPayload(kind: MachineJobKind, payload: unknown): JobPayload | string {
  if (!MACHINE_JOB_KINDS.includes(kind)) return "kind không hợp lệ";
  if (!isObject(payload)) return "payload phải là object";
  const unknown = unknownKeyError(payload, [...KEYS[kind], "kind"]);
  if (unknown) return unknown;
  if ("kind" in payload && payload.kind !== kind) return "kind trong payload không khớp";
  const p = payload;
  switch (kind) {
    case "inspect-folder":
      return folderError(p.folder) ?? { kind, folder: p.folder as string };
    case "prepare-checkouts":
      return projectKeyError(p.projectKey) ?? folderError(p.folder) ?? rolesError(p.roles) ?? {
        kind, projectKey: p.projectKey as string, folder: p.folder as string,
        roles: (p.roles as { role: CrewRoleSlot; branch: string }[]).map(({ role, branch }) => ({ role, branch })),
      };
    case "agent-workspace":
      return projectKeyError(p.projectKey) ?? folderError(p.folder) ?? roleError(p.role) ?? branchError(p.branch) ?? {
        kind, projectKey: p.projectKey as string, folder: p.folder as string, role: p.role as CrewRoleSlot, branch: p.branch as string,
      };
    case "skill-sync":
      if (typeof p.skillId !== "string" || !UUID.test(p.skillId)) return "skillId phải là uuid";
      if (typeof p.slug !== "string" || !SLUG.test(p.slug)) return "slug không hợp lệ";
      if (typeof p.version !== "string" || !VERSION.test(p.version)) return "version không hợp lệ";
      return { kind, skillId: p.skillId.toLowerCase(), slug: p.slug, version: p.version };
    case "check":
      return projectKeyError(p.projectKey) ?? { kind, projectKey: p.projectKey as string };
    case "remove-checkouts": {
      const error = (typeof p.projectId === "string" && UUID.test(p.projectId) ? null : "projectId phải là uuid")
        ?? projectKeyError(p.projectKey) ?? roleListError(p.roles)
        ?? (typeof p.removeStatusRepo === "boolean" ? null : "removeStatusRepo phải là boolean");
      return error ?? {
        kind, projectId: (p.projectId as string).toLowerCase(), projectKey: p.projectKey as string,
        roles: [...(p.roles as string[])], removeStatusRepo: p.removeStatusRepo as boolean,
      };
    }
    case "skill-remove":
      if (typeof p.skillId !== "string" || !UUID.test(p.skillId)) return "skillId phải là uuid";
      if (typeof p.slug !== "string" || !SLUG.test(p.slug)) return "slug không hợp lệ";
      return { kind, skillId: p.skillId.toLowerCase(), slug: p.slug };
    case "ensure-project": {
      const error = projectKeyError(p.projectKey)
        ?? (typeof p.projectId === "string" && UUID.test(p.projectId) ? null : "projectId phải là uuid")
        ?? originError(p.originUrl) ?? branchError(p.branch) ?? ensureRolesError(p.roles)
        ?? companionsError(p.companions, p.roles as { role: string }[]);
      return error ?? {
        kind, projectKey: p.projectKey as string, projectId: (p.projectId as string).toLowerCase(),
        originUrl: p.originUrl as string, branch: p.branch as string,
        roles: (p.roles as { role: string; branch: string }[]).map(({ role, branch }) => ({ role, branch })),
        companions: (p.companions as { name: string; originUrl: string }[]).map(({ name, originUrl }) => ({ name, originUrl })),
      };
    }
    case "runtimes-setup":
      return { kind };
  }
}

const RESULT_ERROR = "result không hợp lệ";
const CHECK_STATUSES = ["ok", "warn", "error"];
const str = (value: unknown): value is string => typeof value === "string";
const strOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const checkout = (value: unknown): value is { role: CrewRoleSlot; path: string; head: string } =>
  isObject(value) && roleError(value.role) === null && str(value.path) && str(value.head);

const boolOrNull = (value: unknown): value is boolean | null => value === null || typeof value === "boolean";
const version = (value: unknown): value is string | null =>
  value === null || typeof value === "string" && value.length > 0 && value.length <= 200 && !CONTROL.test(value);

const roleOnly = (value: unknown): value is string => checkoutNameOk(value);
const removedCheckout = (value: unknown): value is { role: string; path: string } =>
  isObject(value) && roleOnly(value.role) && str(value.path);
const keptCheckout = (value: unknown): value is { role: string; path: string; reason: KeptCheckoutReason; detail?: unknown } =>
  removedCheckout(value) && KEPT_CHECKOUT_REASONS.includes((value as Record<string, unknown>).reason as KeptCheckoutReason)
  && ((value as Record<string, unknown>).detail === undefined || str((value as Record<string, unknown>).detail));

/**
 * Checks the result a Mac reports against the job's kind, so the web can read every field it expects. Returns a copy
 * with only the known fields (the remote URL without credentials), or `result không hợp lệ`. The kind itself is
 * compared with the job before this is called.
 */
export function validateJobResult(kind: MachineJobKind, result: Record<string, unknown>): JobResult | string {
  const r = result;
  switch (kind) {
    case "inspect-folder":
      if (!str(r.root) || !strOrNull(r.branch) || !strOrNull(r.remote) || !strOrNull(r.docsBundle) || typeof r.clean !== "boolean") return RESULT_ERROR;
      return {
        kind, root: r.root, branch: r.branch, remote: r.remote === null ? null : maskUrlUserinfo(r.remote), docsBundle: r.docsBundle, clean: r.clean,
      };
    case "prepare-checkouts":
      if (!Array.isArray(r.checkouts) || !r.checkouts.every(checkout)) return RESULT_ERROR;
      return { kind, checkouts: r.checkouts.map(({ role, path, head }) => ({ role, path, head })) };
    case "agent-workspace":
      return checkout(r) ? { kind, role: r.role, path: r.path, head: r.head } : RESULT_ERROR;
    case "skill-sync":
      if (!str(r.sha256) || !Number.isInteger(r.files) || (r.files as number) < 0) return RESULT_ERROR;
      return { kind, sha256: r.sha256, files: r.files as number };
    case "check": {
      const items = r.items;
      if (!Array.isArray(items) || !items.every((item) =>
        isObject(item) && str(item.id) && str(item.title) && CHECK_STATUSES.includes(item.status as string))) return RESULT_ERROR;
      return {
        kind,
        items: (items as { id: string; status: "ok" | "warn" | "error"; title: string }[]).map(({ id, status, title }) => ({ id, status, title })),
      };
    }
    case "remove-checkouts": {
      const { removed, kept, absent } = r;
      if (!Array.isArray(removed) || !removed.every(removedCheckout) || !Array.isArray(kept) || !kept.every(keptCheckout)
        || !Array.isArray(absent) || !absent.every(roleOnly)) return RESULT_ERROR;
      return {
        kind,
        removed: removed.map(({ role, path }) => ({ role, path })),
        kept: kept.map(({ role, path, reason, detail }) => {
          // The detail is git output from the Mac: shown on the web, so cleaned like an error text.
          const clean = typeof detail === "string" ? sanitizeJobError(detail) : "";
          return clean === "" ? { role, path, reason } : { role, path, reason, detail: clean };
        }),
        absent: [...absent],
      };
    }
    case "skill-remove":
      return typeof r.removed === "boolean" ? { kind, removed: r.removed } : RESULT_ERROR;
    case "runtimes-setup": {
      const { wrappers, codex, opencode } = r;
      if (!isObject(wrappers) || typeof wrappers.codex !== "boolean" || typeof wrappers.opencode !== "boolean"
        || !isObject(codex) || !version(codex.version) || !boolOrNull(codex.loggedIn)
        || !isObject(opencode) || !version(opencode.version) || !boolOrNull(opencode.keyPresent)) return RESULT_ERROR;
      // Chỉ chép trường của hợp đồng: kết quả hiện trên web, không được mang key, token hay path auth.
      return {
        kind,
        wrappers: { codex: wrappers.codex, opencode: wrappers.opencode },
        codex: { version: codex.version, loggedIn: codex.loggedIn },
        opencode: { version: opencode.version, keyPresent: opencode.keyPresent },
      };
    }
    case "ensure-project": {
      const { repoPath, cloned, checkouts, companions } = r;
      const checkoutOk = (value: unknown) =>
        isObject(value) && checkoutNameOk(value.role) && str(value.path) && str(value.head);
      const companionOk = (value: unknown) => isObject(value) && str(value.name) && str(value.path);
      if (!str(repoPath) || typeof cloned !== "boolean" || !Array.isArray(checkouts) || !checkouts.every(checkoutOk)
        || !Array.isArray(companions) || !companions.every(companionOk)) return RESULT_ERROR;
      return {
        kind, repoPath, cloned,
        checkouts: (checkouts as { role: string; path: string; head: string }[]).map(({ role, path, head }) => ({ role, path, head })),
        companions: (companions as { name: string; path: string }[]).map(({ name, path }) => ({ name, path })),
      };
    }
  }
  return RESULT_ERROR;
}
