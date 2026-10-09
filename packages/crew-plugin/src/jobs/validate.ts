import { UUID } from "../shared/db.js";
import { maskUrlUserinfo } from "./sanitize.js";
import { CREW_ROLE_SLOTS, type CrewRoleSlot, type JobPayload, type JobResult, MACHINE_JOB_KINDS, type MachineJobKind } from "./types.js";

/** Same rule as the app's project key. */
const PROJECT_KEY = /^[a-z][a-z0-9-]{1,30}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is rejected
const CONTROL = /[\x00-\x1f\x7f]/;
const REQUIRED_ROLES: readonly CrewRoleSlot[] = ["assistant", "executor", "reviewer", "integrator"];

const KEYS: Record<MachineJobKind, readonly string[]> = {
  "inspect-folder": ["folder"],
  "prepare-checkouts": ["projectKey", "folder", "roles"],
  "agent-workspace": ["projectKey", "folder", "role", "branch"],
  "skill-sync": ["skillId", "slug", "version"],
  check: ["projectKey"],
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
  }
}

const RESULT_ERROR = "result không hợp lệ";
const CHECK_STATUSES = ["ok", "warn", "error"];
const str = (value: unknown): value is string => typeof value === "string";
const strOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const checkout = (value: unknown): value is { role: CrewRoleSlot; path: string; head: string } =>
  isObject(value) && roleError(value.role) === null && str(value.path) && str(value.head);

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
  }
  return RESULT_ERROR;
}
