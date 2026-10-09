import { parse } from "yaml";

export interface ManifestFlow {
  id: string;
  title: string;
  doc: string;
  entrypoints: string[];
  files: string[];
  tests: string[];
}
export type FlowsManifestOk = { state: "ok"; flows: ManifestFlow[]; shared: Array<{ path: string; flows: string[] }> };
export type FlowsManifestResult = FlowsManifestOk | { state: "invalid"; errors: string[] };

const FLOW_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_ERRORS = 20;
const MAX_ERROR_LENGTH = 200;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPath = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 1024 && !/[\u0000-\u001f]/.test(v);

/** Mirrors the FlowsManifest schema of crew-docs (packages/docs-kit/src/flows-schema.ts) without zod. */
export function parseFlowsManifest(text: string): FlowsManifestResult {
  const errors: string[] = [];
  const add = (message: string) => {
    if (errors.length < MAX_ERRORS) errors.push(message.slice(0, MAX_ERROR_LENGTH));
  };
  let raw: unknown;
  try {
    raw = parse(text, { uniqueKeys: true, prettyErrors: false });
  } catch (error) {
    const first = String((error as Error)?.message ?? error).split("\n")[0];
    return { state: "invalid", errors: [`YAML lỗi: ${first}`.slice(0, MAX_ERROR_LENGTH)] };
  }
  if (!isObject(raw)) return { state: "invalid", errors: ["gốc phải là object"] };
  if (raw.version !== 1) add("version phải là 1");
  const include = isObject(raw.source) ? raw.source.include : undefined;
  if (!Array.isArray(include) || include.length === 0 || !include.every((v) => typeof v === "string")) {
    add("source.include phải là mảng chuỗi khác rỗng");
  }
  const flows: ManifestFlow[] = [];
  if (!isObject(raw.flows)) add("flows phải là object");
  else for (const [id, value] of Object.entries(raw.flows)) {
    if (!FLOW_ID.test(id)) { add(`flows.${id}: id phải kebab-case`); continue; }
    if (!isObject(value) || typeof value.title !== "string" || !value.title || !isPath(value.doc)) {
      add(`flows.${id}: cần title và doc`);
      continue;
    }
    const list = (key: string): string[] | null => {
      const v = value[key];
      if (v === undefined || v === null) return [];
      return Array.isArray(v) && v.every(isPath) ? (v as string[]) : null;
    };
    const entrypoints = list("entrypoints");
    const files = list("files");
    const tests = list("tests");
    if (!entrypoints || !files || !tests) { add(`flows.${id}: entrypoints/files/tests phải là mảng đường dẫn`); continue; }
    flows.push({ id, title: value.title, doc: value.doc, entrypoints, files, tests });
  }
  const shared: Array<{ path: string; flows: string[] }> = [];
  const ids = new Set(flows.map((flow) => flow.id));
  if (raw.shared !== undefined && raw.shared !== null) {
    if (!isObject(raw.shared)) add("shared phải là object");
    else for (const [path, value] of Object.entries(raw.shared)) {
      if (!isPath(path) || !Array.isArray(value) || value.length === 0
        || !value.every((v) => typeof v === "string" && ids.has(v))) {
        add(`shared.${path}: phải là danh sách flow có thật`);
        continue;
      }
      shared.push({ path, flows: value as string[] });
    }
  }
  return errors.length ? { state: "invalid", errors } : { state: "ok", flows, shared };
}
