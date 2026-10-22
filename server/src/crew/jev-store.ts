import { createHash } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { conflict } from "../errors.js";
import { getConfiguredSecretProvider } from "../secrets/configured-provider.js";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import { secretService } from "../services/secrets.js";
import { CREW_PLUGIN_KEY, rowsOf } from "./project-roles.js";

/**
 * Dữ liệu Jev của Crew, nằm ở bốn bảng plugin `crew_jev_*` (migration `0020_jev.sql` của `crew.core`). Chỉ server đọc/ghi
 * các bảng này. Key OpenRouter là company secret `crew-jev-openrouter`; bảng chỉ giữ id secret và vân tay (12 hex đầu
 * của sha256), không bao giờ giữ key.
 */

type Sql = Pick<Db, "execute">;

export const JEV_TABLES = ["crew_jev_settings", "crew_jev_machines", "crew_jev_gate_events", "crew_jev_shadow"] as const;
export type JevTable = (typeof JEV_TABLES)[number];

export function crewJevTable(name: JevTable): string {
  return `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.${name}`;
}

const table = (name: JevTable) => sql.raw(crewJevTable(name));

/** Bốn bảng Jev đã có (plugin đã áp migration 0020). */
export async function jevTablesReady(db: Sql): Promise<boolean> {
  const checks = JEV_TABLES.map((name) => sql`to_regclass(${crewJevTable(name)}) IS NOT NULL`);
  const rows = rowsOf(await db.execute(sql`SELECT (${sql.join(checks, sql` AND `)}) AS ok`));
  return rows[0]?.ok === true;
}

// ---------------------------------------------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------------------------------------------

export const JEV_SECRET_NAME = "crew-jev-openrouter";
export const JEV_GATE_MODES = ["shadow", "enforce"] as const;
export type JevGateMode = (typeof JEV_GATE_MODES)[number];

export const JEV_DEFAULTS = {
  enabled: false,
  gateMode: "shadow" as JevGateMode,
  model: "typesafe/jev-1.14",
  threshold: 0.5,
  timeoutMs: 2500,
  serverShadow: false,
};

export const jevSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    gateMode: z.enum(JEV_GATE_MODES),
    model: z.string().regex(/^typesafe\/jev-[A-Za-z0-9._-]{1,60}$/),
    threshold: z.number().min(0.3).max(0.95),
    timeoutMs: z.number().int().min(500).max(3000),
    serverShadow: z.boolean(),
  })
  .strict();
export type JevSettingsInput = z.infer<typeof jevSettingsInputSchema>;

export interface JevSettingsRecord extends JevSettingsInput {
  companyId: string;
  /** Id company secret giữ key; chỉ dùng trong server, không trả client. */
  keySecretId: string | null;
  keyFingerprint: string | null;
  version: number;
  shadowCursor: string | null;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

const iso = (value: unknown): string | null =>
  value === null || value === undefined ? null : new Date(value as string | Date).toISOString();
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

function toSettings(companyId: string, row: Record<string, unknown> | undefined): JevSettingsRecord {
  if (!row) {
    return {
      companyId, ...JEV_DEFAULTS, keySecretId: null, keyFingerprint: null, version: 1, shadowCursor: null,
      updatedByUserId: null, updatedAt: null,
    };
  }
  return {
    companyId,
    enabled: row.enabled === true,
    gateMode: row.gate_mode === "enforce" ? "enforce" : "shadow",
    model: String(row.model),
    // `real` của Postgres đọc ra số thực 4 byte (0.7 → 0.699999988); làm tròn về 2 chữ số như ô nhập.
    threshold: Math.round(Number(row.threshold) * 100) / 100,
    timeoutMs: Number(row.timeout_ms),
    serverShadow: row.server_shadow === true,
    keySecretId: str(row.key_secret_id),
    keyFingerprint: str(row.key_fingerprint),
    version: Number(row.version),
    shadowCursor: iso(row.shadow_cursor),
    updatedByUserId: str(row.updated_by_user_id),
    updatedAt: iso(row.updated_at),
  };
}

/** Cấu hình Jev của company; chưa có dòng thì trả mặc định (`version = 1`). */
export async function getJevSettings(db: Sql, companyId: string): Promise<JevSettingsRecord> {
  const rows = rowsOf(await db.execute(sql`SELECT * FROM ${table("crew_jev_settings")} WHERE company_id = ${companyId}`));
  return toSettings(companyId, rows[0]);
}

/** Mọi company đã bật Jev; dùng cho worker chạy nền. */
export async function listEnabledJevSettings(db: Sql): Promise<JevSettingsRecord[]> {
  const rows = rowsOf(await db.execute(sql`SELECT * FROM ${table("crew_jev_settings")} WHERE enabled ORDER BY company_id`));
  return rows.map((row) => toSettings(String(row.company_id), row));
}

/** Ghi cấu hình và tăng `version` (Mac thấy version mới thì áp lại). */
export async function saveJevSettings(
  db: Sql,
  companyId: string,
  input: JevSettingsInput,
  userId: string,
): Promise<JevSettingsRecord> {
  const rows = rowsOf(
    await db.execute(sql`INSERT INTO ${table("crew_jev_settings")} AS s
      (company_id, enabled, gate_mode, model, threshold, timeout_ms, server_shadow, version, updated_by_user_id, updated_at)
      VALUES (${companyId}, ${input.enabled}, ${input.gateMode}, ${input.model}, ${input.threshold}, ${input.timeoutMs},
        ${input.serverShadow}, 2, ${userId}, now())
      ON CONFLICT (company_id) DO UPDATE SET enabled = EXCLUDED.enabled, gate_mode = EXCLUDED.gate_mode,
        model = EXCLUDED.model, threshold = EXCLUDED.threshold, timeout_ms = EXCLUDED.timeout_ms,
        server_shadow = EXCLUDED.server_shadow, version = s.version + 1,
        updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
      RETURNING *`),
  );
  return toSettings(companyId, rows[0]);
}

async function writeKeyColumns(
  db: Sql,
  companyId: string,
  key: { secretId: string; fingerprint: string } | null,
  userId: string,
): Promise<JevSettingsRecord> {
  const rows = rowsOf(
    await db.execute(sql`INSERT INTO ${table("crew_jev_settings")} AS s
      (company_id, key_secret_id, key_fingerprint, version, updated_by_user_id, updated_at)
      VALUES (${companyId}, ${key?.secretId ?? null}, ${key?.fingerprint ?? null}, 2, ${userId}, now())
      ON CONFLICT (company_id) DO UPDATE SET key_secret_id = EXCLUDED.key_secret_id,
        key_fingerprint = EXCLUDED.key_fingerprint, version = s.version + 1,
        updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
      RETURNING *`),
  );
  return toSettings(companyId, rows[0]);
}

/** Vân tay key: 12 hex đầu của sha256. Đủ để Mac biết key đã đổi, không đủ để đoán key. */
export function jevKeyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex").slice(0, 12);
}

/** Key hợp lệ: một dòng, 20–200 ký tự in được, không khoảng trắng. */
export const jevApiKeySchema = z.string().regex(/^[\x21-\x7e]{20,200}$/);

export const JEV_SECRET_DESCRIPTION = "Key OpenRouter cho Jev của Crew (chỉ server Crew đọc).";

/** Khóa theo company cho mọi lần đổi key, để hai lần lưu đồng thời không cùng tạo secret. */
async function lockJevKey(tx: Sql, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crew-jev-key:${companyId}`}))`);
}

/**
 * Lưu key thành company secret `crew-jev-openrouter`: lần đầu `create`, các lần sau `rotate` (secret bị vô hiệu bởi lần
 * xóa trước thì bật lại rồi `rotate`). Ghi id secret và vân tay vào `crew_jev_settings`, tăng `version`. Cả đoạn chạy trong
 * một transaction có khóa theo company. Secret trùng tên mà không do Crew tạo (khác mô tả) thì không đè: `409`.
 */
export async function storeJevKey(db: Db, companyId: string, apiKey: string, userId: string): Promise<JevSettingsRecord> {
  return db.transaction(async (tx) => {
    await lockJevKey(tx, companyId);
    const secrets = secretService(tx);
    const current = await getJevSettings(tx, companyId);
    let existing = current.keySecretId ? await secrets.getById(current.keySecretId) : null;
    if (existing && (existing.companyId !== companyId || existing.status === "deleted")) existing = null;
    if (!existing) {
      const byName = await secrets.getByKey(companyId, JEV_SECRET_NAME);
      if (byName && byName.description !== JEV_SECRET_DESCRIPTION) {
        throw conflict(`Company đã có secret "${JEV_SECRET_NAME}" không do Crew tạo; đổi tên secret đó rồi lưu lại.`, {
          code: "crew_jev_secret_taken",
        });
      }
      existing = byName;
    }

    let secretId: string;
    if (existing) {
      if (existing.status !== "active") await secrets.update(existing.id, { status: "active" });
      await secrets.rotate(existing.id, { value: apiKey }, { userId });
      secretId = existing.id;
    } else {
      const created = await secrets.create(
        companyId,
        { name: JEV_SECRET_NAME, provider: getConfiguredSecretProvider(), value: apiKey, description: JEV_SECRET_DESCRIPTION },
        { userId },
      );
      secretId = created.id;
    }
    return writeKeyColumns(tx, companyId, { secretId, fingerprint: jevKeyFingerprint(apiKey) }, userId);
  });
}

/** Bỏ liên kết key và vô hiệu secret (không `rotate` thành rỗng). */
export async function clearJevKey(db: Db, companyId: string, userId: string): Promise<JevSettingsRecord> {
  return db.transaction(async (tx) => {
    await lockJevKey(tx, companyId);
    const current = await getJevSettings(tx, companyId);
    if (current.keySecretId) {
      const secrets = secretService(tx);
      const secret = await secrets.getById(current.keySecretId);
      if (secret && secret.companyId === companyId && secret.status === "active") {
        await secrets.update(secret.id, { status: "disabled" });
      }
    }
    return writeKeyColumns(tx, companyId, null, userId);
  });
}

/**
 * Giá trị key cho lời gọi OpenRouter của server hoặc để gửi cho Mac đã ký đúng. Không có key hay không đọc được thì
 * `null` (người gọi coi như `no_key`). Mỗi lần đọc ghi một access event với `consumerId` của người gọi.
 */
export async function resolveJevApiKey(
  db: Db,
  settings: Pick<JevSettingsRecord, "companyId" | "keySecretId">,
  consumerId: string,
): Promise<string | null> {
  if (!settings.keySecretId) return null;
  try {
    const value = await secretService(db).resolveSecretValue(settings.companyId, settings.keySecretId, "latest", {
      accessContext: { consumerType: "system", consumerId, configPath: "crew.jev.apiKey", actorType: "system" },
    });
    return value ? value : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Máy
// ---------------------------------------------------------------------------------------------------------------

export interface JevMachine {
  machineId: string;
  appliedVersion: number | null;
  keyFingerprint: string | null;
  lastPullAt: string | null;
  lastEventsAt: string | null;
  /** Tên máy từ `machine_pairings` (giữ cả khi máy đã gỡ); `null` khi máy chưa từng ghép. */
  hostname: string | null;
  /** Máy đã bị gỡ (bản tin và pull của nó bị từ chối). */
  revoked: boolean;
}

const pairingsTable = () => sql.raw(`${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.machine_pairings`);

export async function listJevMachines(db: Sql, companyId: string): Promise<JevMachine[]> {
  const rows = rowsOf(
    await db.execute(sql`SELECT m.*, p.hostname AS hostname, (p.revoked_at IS NOT NULL) AS revoked
      FROM ${table("crew_jev_machines")} m
      LEFT JOIN ${pairingsTable()} p ON p.company_id = m.company_id AND p.machine_id = m.machine_id
      WHERE m.company_id = ${companyId}
      ORDER BY m.last_pull_at DESC NULLS LAST, m.machine_id`),
  );
  return rows.map((row) => ({
    machineId: String(row.machine_id),
    appliedVersion: num(row.applied_version),
    keyFingerprint: str(row.key_fingerprint),
    lastPullAt: iso(row.last_pull_at),
    lastEventsAt: iso(row.last_events_at),
    hostname: str(row.hostname),
    revoked: row.revoked === true,
  }));
}

export async function recordMachinePull(
  db: Sql,
  input: { companyId: string; machineId: string; appliedVersion: number | null; keyFingerprint: string | null },
): Promise<void> {
  await db.execute(sql`INSERT INTO ${table("crew_jev_machines")}
    (company_id, machine_id, applied_version, key_fingerprint, last_pull_at)
    VALUES (${input.companyId}, ${input.machineId}, ${input.appliedVersion}, ${input.keyFingerprint}, now())
    ON CONFLICT (company_id, machine_id) DO UPDATE SET applied_version = EXCLUDED.applied_version,
      key_fingerprint = EXCLUDED.key_fingerprint, last_pull_at = now()`);
}

export async function recordMachineEvents(db: Sql, companyId: string, machineId: string): Promise<void> {
  await db.execute(sql`INSERT INTO ${table("crew_jev_machines")} (company_id, machine_id, last_events_at)
    VALUES (${companyId}, ${machineId}, now())
    ON CONFLICT (company_id, machine_id) DO UPDATE SET last_events_at = now()`);
}

// ---------------------------------------------------------------------------------------------------------------
// Dòng log gate
// ---------------------------------------------------------------------------------------------------------------

export const JEV_CATEGORIES = ["rm_recursive", "no_verify", "force_push", "push_default", "pr_merge", "credential"] as const;
export const JEV_VERDICTS = ["allow", "deny", "escalate", "error"] as const;
export const JEV_GATE_ERROR_CODES = [
  "no_key",
  "timeout",
  "unreachable",
  "bad_response",
  "bad_event",
  "internal",
  // Mac bỏ qua Jev vì đã đủ tiến trình nền, hoặc phải bỏ dòng cũ chưa đẩy khi `gate.log` vượt trần (`reason` = `dropped:<n>`).
  "skipped_bg",
  "dropped",
] as const;
export const JEV_LABELS = ["correct", "wrong"] as const;
export type JevLabel = (typeof JEV_LABELS)[number];

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional().transform((value) => value ?? null);
const nullableText = (max: number) => z.string().max(max).nullable().optional().transform((value) => value ?? null);

/** Một dòng `gate.log` (JSONL v1) như Mac gửi lên. */
export const jevGateEventSchema = z.object({
  v: z.literal(1),
  eventId: uuid,
  ts: z.string().datetime({ offset: true }),
  companyId: uuid,
  runId: nullableUuid,
  agentId: nullableUuid,
  cwd: nullableText(1000),
  mode: z.enum(JEV_GATE_MODES),
  category: z.enum(JEV_CATEGORIES).nullable().optional().transform((value) => value ?? null),
  blocking: z.boolean(),
  verdict: z.enum(JEV_VERDICTS),
  applied: z.enum(["allow", "deny"]),
  confidence: z.number().min(0).max(1).nullable().optional().transform((value) => value ?? null),
  reason: nullableText(40),
  errorCode: z.enum(JEV_GATE_ERROR_CODES).nullable().optional().transform((value) => value ?? null),
  latencyMs: z.number().int().min(0).max(600_000).nullable().optional().transform((value) => value ?? null),
  model: nullableText(100),
  // Mac đã che và cắt 2000 ký tự; server nhận dư một chút rồi cắt lại.
  command: z.string().max(4000),
});
export type JevGateEvent = z.infer<typeof jevGateEventSchema>;

/** Chèn một lô dòng log; trùng `(company_id, event_id)` thì bỏ qua và đếm vào `duplicates`. */
export async function insertGateEvents(
  db: Sql,
  companyId: string,
  machineId: string,
  events: JevGateEvent[],
  redact: (text: string) => string,
): Promise<{ accepted: number; duplicates: number }> {
  if (events.length === 0) return { accepted: 0, duplicates: 0 };
  const values = events.map((event) => sql`(${companyId}, ${machineId}, ${event.eventId}, ${event.ts}::timestamptz,
    ${event.runId}, ${event.agentId}, ${event.mode}, ${event.category}, ${event.verdict}, ${event.applied},
    ${event.blocking}, ${event.confidence}, ${event.reason}, ${event.errorCode}, ${event.latencyMs}, ${event.model},
    ${redact(event.command).slice(0, 2000)}, ${event.cwd})`);
  const rows = rowsOf(
    await db.execute(sql`INSERT INTO ${table("crew_jev_gate_events")}
      (company_id, machine_id, event_id, occurred_at, run_id, agent_id, mode, category, verdict, applied, blocking,
       confidence, reason, error_code, latency_ms, model, command, cwd)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (company_id, event_id) DO NOTHING
      RETURNING id`),
  );
  return { accepted: rows.length, duplicates: events.length - rows.length };
}

export const JEV_PAGE_SIZE = 50;

export interface JevGateEventRow {
  id: string;
  eventId: string;
  machineId: string;
  /** Tên máy từ `machine_pairings`; `null` khi máy chưa từng ghép (hoặc dòng vừa trả từ lệnh gắn nhãn). */
  hostname: string | null;
  occurredAt: string | null;
  runId: string | null;
  agentId: string | null;
  mode: string;
  category: string | null;
  verdict: string;
  applied: string;
  blocking: boolean;
  confidence: number | null;
  reason: string | null;
  errorCode: string | null;
  latencyMs: number | null;
  model: string | null;
  command: string;
  cwd: string | null;
  ownerLabel: JevLabel | null;
  labeledByUserId: string | null;
  labeledAt: string | null;
  receivedAt: string | null;
}

function toGateEvent(row: Record<string, unknown>): JevGateEventRow {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    machineId: String(row.machine_id),
    hostname: str(row.hostname),
    occurredAt: iso(row.occurred_at),
    runId: str(row.run_id),
    agentId: str(row.agent_id),
    mode: String(row.mode),
    category: str(row.category),
    verdict: String(row.verdict),
    applied: String(row.applied),
    blocking: row.blocking === true,
    confidence: num(row.confidence),
    reason: str(row.reason),
    errorCode: str(row.error_code),
    latencyMs: num(row.latency_ms),
    model: str(row.model),
    command: String(row.command),
    cwd: str(row.cwd),
    ownerLabel: row.owner_label === "correct" || row.owner_label === "wrong" ? row.owner_label : null,
    labeledByUserId: str(row.labeled_by_user_id),
    labeledAt: iso(row.labeled_at),
    receivedAt: iso(row.received_at),
  };
}

const beforeSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const gateEventsQuerySchema = z
  .object({
    verdict: z.enum(JEV_VERDICTS).optional(),
    category: z.enum(JEV_CATEGORIES).optional(),
    label: z.enum(["unlabeled", ...JEV_LABELS]).optional(),
    before: beforeSchema.optional(),
  })
  .strict();
export type GateEventsQuery = z.infer<typeof gateEventsQuerySchema>;

export interface JevPage<T> {
  items: T[];
  /** Truyền làm `before` để lấy trang sau; `null` khi đã hết. */
  nextBefore: string | null;
}

function page<T extends { id: string }>(items: T[]): JevPage<T> {
  return { items, nextBefore: items.length === JEV_PAGE_SIZE ? items[items.length - 1]!.id : null };
}

/** 50 dòng mới nhất (theo `id` giảm dần), lọc theo verdict, nhóm, nhãn; `before` là `id` của dòng cuối trang trước. */
export async function listGateEvents(db: Sql, companyId: string, query: GateEventsQuery): Promise<JevPage<JevGateEventRow>> {
  const conditions: SQL[] = [sql`e.company_id = ${companyId}`];
  if (query.verdict) conditions.push(sql`e.verdict = ${query.verdict}`);
  if (query.category) conditions.push(sql`e.category = ${query.category}`);
  if (query.label === "unlabeled") conditions.push(sql`e.owner_label IS NULL`);
  else if (query.label) conditions.push(sql`e.owner_label = ${query.label}`);
  if (query.before) conditions.push(sql`e.id < ${query.before}`);
  const rows = rowsOf(
    await db.execute(sql`SELECT e.*, p.hostname AS hostname FROM ${table("crew_jev_gate_events")} e
      LEFT JOIN ${pairingsTable()} p ON p.company_id = e.company_id AND p.machine_id = e.machine_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY e.id DESC LIMIT ${JEV_PAGE_SIZE}`),
  );
  return page(rows.map(toGateEvent));
}

/** Owner đánh dấu ca đúng/nhầm (`null` để bỏ dấu). Không có dòng trong company thì `null`. */
export async function labelGateEvent(
  db: Sql,
  companyId: string,
  id: number,
  label: JevLabel | null,
  userId: string,
): Promise<JevGateEventRow | null> {
  const rows = rowsOf(
    await db.execute(sql`UPDATE ${table("crew_jev_gate_events")}
      SET owner_label = ${label},
        labeled_by_user_id = ${label === null ? null : userId},
        labeled_at = ${label === null ? sql`NULL` : sql`now()`}
      WHERE company_id = ${companyId} AND id = ${id}
      RETURNING *`),
  );
  return rows[0] ? toGateEvent(rows[0]) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// So sánh với regex
// ---------------------------------------------------------------------------------------------------------------

export const JEV_SHADOW_KINDS = ["liveness", "runtime"] as const;
export type JevShadowKind = (typeof JEV_SHADOW_KINDS)[number];

/** "Lệch": Jev trả lời chắc chắn và khác nhãn regex. */
const MISMATCH = sql.raw(
  "(status = 'done' AND NOT coalesce(escalated, false) AND jev_label IS NOT NULL AND jev_label <> regex_label)",
);

export interface JevShadowRow {
  id: string;
  kind: JevShadowKind;
  runId: string;
  regexLabel: string;
  jevLabel: string | null;
  confidence: number | null;
  escalated: boolean | null;
  status: string;
  errorCode: string | null;
  latencyMs: number | null;
  inputExcerpt: string | null;
  mismatch: boolean;
  createdAt: string | null;
  evaluatedAt: string | null;
}

export const shadowQuerySchema = z
  .object({
    kind: z.enum(JEV_SHADOW_KINDS).optional(),
    mismatch: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
    before: beforeSchema.optional(),
  })
  .strict();
export type ShadowQuery = z.infer<typeof shadowQuerySchema>;

function toShadowRow(row: Record<string, unknown>, redact: ((text: string) => string) | null): JevShadowRow {
  return {
    id: String(row.id),
    kind: row.kind === "runtime" ? "runtime" : "liveness",
    runId: String(row.run_id),
    regexLabel: String(row.regex_label),
    jevLabel: str(row.jev_label),
    confidence: num(row.confidence),
    escalated: row.escalated === null || row.escalated === undefined ? null : row.escalated === true,
    status: String(row.status),
    errorCode: str(row.error_code),
    latencyMs: num(row.latency_ms),
    inputExcerpt: row.input_excerpt === null || row.input_excerpt === undefined || !redact ? null : redact(String(row.input_excerpt)),
    mismatch: row.mismatch === true,
    createdAt: iso(row.created_at),
    evaluatedAt: iso(row.evaluated_at),
  };
}

/**
 * Dòng so sánh, mới nhất trước. `inputExcerpt` luôn đi qua `redact` lúc đọc (kể cả dòng `pending` chưa được worker xử
 * lý); `redact = null` (không nạp được hàm che) thì trả `inputExcerpt: null`.
 */
export async function listShadow(
  db: Sql,
  companyId: string,
  query: ShadowQuery,
  redact: ((text: string) => string) | null,
): Promise<JevPage<JevShadowRow>> {
  const conditions: SQL[] = [sql`company_id = ${companyId}`];
  if (query.kind) conditions.push(sql`kind = ${query.kind}`);
  if (query.mismatch) conditions.push(MISMATCH);
  if (query.before) conditions.push(sql`id < ${query.before}`);
  const rows = rowsOf(
    await db.execute(sql`SELECT *, ${MISMATCH} AS mismatch FROM ${table("crew_jev_shadow")}
      WHERE ${sql.join(conditions, sql` AND `)} ORDER BY id DESC LIMIT ${JEV_PAGE_SIZE}`),
  );
  return page(rows.map((row) => toShadowRow(row, redact)));
}

// ---------------------------------------------------------------------------------------------------------------
// Số liệu
// ---------------------------------------------------------------------------------------------------------------

export interface JevShadowStats {
  done: number;
  mismatch: number;
  escalated: number;
  error: number;
  pending: number;
}

export interface JevStats {
  days: number;
  gate: {
    calls: number;
    allow: number;
    deny: number;
    escalate: number;
    error: number;
    appliedDeny: number;
    /** Lần Mac bỏ qua Jev vì đủ tiến trình nền (không tính vào `calls`). */
    skipped: number;
    /** Số dòng log Mac báo đã bỏ chưa gửi (tổng `dropped:<n>`, không tính vào `calls`). */
    droppedLines: number;
    p50Ms: number | null;
    p95Ms: number | null;
    byCategory: Array<{ category: string; calls: number; deny: number; appliedDeny: number }>;
    byDay: Array<{ day: string; calls: number; allow: number; deny: number; escalate: number; error: number }>;
  };
  shadow: Record<JevShadowKind, JevShadowStats>;
}

/** Dòng thật sự là một lần hỏi Jev: loại `skipped_bg` (không gọi Jev) và `dropped` (một dòng thay cho N dòng đã mất). */
const CALLED = sql.raw("coalesce(error_code, '') NOT IN ('skipped_bg', 'dropped')");
const MISMATCH_S = sql.raw(
  "(s.status = 'done' AND NOT coalesce(s.escalated, false) AND s.jev_label IS NOT NULL AND s.jev_label <> s.regex_label)",
);
const CALLED_E = sql.raw("coalesce(e.error_code, '') NOT IN ('skipped_bg', 'dropped')");

const roundMs = (value: unknown): number | null => (value === null || value === undefined ? null : Math.round(Number(value)));
const int = (value: unknown): number => Number(value ?? 0);

/**
 * Số liệu `days` ngày lịch gần nhất theo giờ Việt Nam, tính từ 00:00 (giờ Việt Nam) của ngày đầu tới hiện tại, nên ngày
 * đầu của `byDay` luôn đủ ngày. p50/p95 chỉ tính trên dòng có `latency_ms`.
 */
export async function jevStats(db: Sql, companyId: string, days: number): Promise<JevStats> {
  const since = sql`((date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - make_interval(days => ${days - 1}))
    AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
  const events = table("crew_jev_gate_events");
  const verdictCounts = sql.raw(`count(*)::int AS calls,
    count(*) FILTER (WHERE verdict = 'allow')::int AS allow,
    count(*) FILTER (WHERE verdict = 'deny')::int AS deny,
    count(*) FILTER (WHERE verdict = 'escalate')::int AS escalate,
    count(*) FILTER (WHERE verdict = 'error')::int AS error,
    count(*) FILTER (WHERE applied = 'deny')::int AS applied_deny`);

  const [totals] = rowsOf(
    await db.execute(sql`SELECT ${verdictCounts},
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
      FROM ${events} WHERE company_id = ${companyId} AND occurred_at >= ${since} AND ${CALLED}`),
  );
  const [skips] = rowsOf(
    await db.execute(sql`SELECT
      count(*) FILTER (WHERE error_code = 'skipped_bg')::int AS skipped,
      coalesce(sum(coalesce(substring(reason from '^dropped:([0-9]+)$')::int, 0))
        FILTER (WHERE error_code = 'dropped'), 0)::int AS dropped_lines
      FROM ${events} WHERE company_id = ${companyId} AND occurred_at >= ${since}`),
  );
  const byCategory = rowsOf(
    await db.execute(sql`SELECT category, ${verdictCounts} FROM ${events}
      WHERE company_id = ${companyId} AND occurred_at >= ${since} AND category IS NOT NULL AND ${CALLED}
      GROUP BY category ORDER BY category`),
  );
  const byDay = rowsOf(
    await db.execute(sql`SELECT to_char(occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS day, ${verdictCounts}
      FROM ${events} WHERE company_id = ${companyId} AND occurred_at >= ${since} AND ${CALLED}
      GROUP BY 1 ORDER BY 1`),
  );
  const shadowRows = rowsOf(
    await db.execute(sql`SELECT kind,
      count(*) FILTER (WHERE status = 'done')::int AS done,
      count(*) FILTER (WHERE ${MISMATCH})::int AS mismatch,
      count(*) FILTER (WHERE status = 'done' AND coalesce(escalated, false))::int AS escalated,
      count(*) FILTER (WHERE status = 'error')::int AS error,
      count(*) FILTER (WHERE status = 'pending')::int AS pending
      FROM ${table("crew_jev_shadow")} WHERE company_id = ${companyId} AND created_at >= ${since}
      GROUP BY kind`),
  );
  const shadowOf = (kind: JevShadowKind): JevShadowStats => {
    const row = shadowRows.find((candidate) => candidate.kind === kind);
    return {
      done: int(row?.done), mismatch: int(row?.mismatch), escalated: int(row?.escalated), error: int(row?.error),
      pending: int(row?.pending),
    };
  };
  return {
    days,
    gate: {
      calls: int(totals?.calls),
      allow: int(totals?.allow),
      deny: int(totals?.deny),
      escalate: int(totals?.escalate),
      error: int(totals?.error),
      appliedDeny: int(totals?.applied_deny),
      skipped: int(skips?.skipped),
      droppedLines: int(skips?.dropped_lines),
      p50Ms: roundMs(totals?.p50),
      p95Ms: roundMs(totals?.p95),
      byCategory: byCategory.map((row) => ({
        category: String(row.category), calls: int(row.calls), deny: int(row.deny), appliedDeny: int(row.applied_deny),
      })),
      byDay: byDay.map((row) => ({
        day: String(row.day), calls: int(row.calls), allow: int(row.allow), deny: int(row.deny),
        escalate: int(row.escalate), error: int(row.error),
      })),
    },
    shadow: { liveness: shadowOf("liveness"), runtime: shadowOf("runtime") },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tóm tắt theo issue
// ---------------------------------------------------------------------------------------------------------------

export const JEV_ISSUE_LIST_MAX = 50;

/** Các run của issue (index `heartbeat_runs_company_ctx_issue_created_idx`). */
const issueRunsSql = (companyId: string, issueId: string) =>
  sql`SELECT id FROM "heartbeat_runs" WHERE company_id = ${companyId} AND (context_snapshot ->> 'issueId') = ${issueId}`;

/** Truy vấn đếm theo run của issue; export để test kiểm kế hoạch (dùng `crew_jev_gate_events_run_idx`). */
export function issueGateCountsSql(companyId: string, issueId: string): SQL {
  return sql`SELECT count(*) FILTER (WHERE ${CALLED})::int AS calls,
      count(*) FILTER (WHERE ${CALLED} AND e.verdict = 'allow')::int AS allow,
      count(*) FILTER (WHERE ${CALLED} AND e.verdict = 'deny')::int AS deny,
      count(*) FILTER (WHERE ${CALLED} AND e.verdict = 'escalate')::int AS escalate,
      count(*) FILTER (WHERE ${CALLED} AND e.verdict = 'error')::int AS error,
      count(*) FILTER (WHERE ${CALLED} AND e.applied = 'deny')::int AS applied_deny,
      max(e.occurred_at) AS last_at
    FROM ${table("crew_jev_gate_events")} e
    WHERE e.company_id = ${companyId} AND e.run_id IN (${issueRunsSql(companyId, issueId)})`;
}

export interface JevIssueSummary {
  calls: number;
  allow: number;
  deny: number;
  appliedDeny: number;
  escalate: number;
  error: number;
  runs: number;
  lastAt: string | null;
  items: JevGateEventRow[];
  shadow: { mismatch: number; items: JevShadowRow[] };
}

/** Số lệnh Jev đã xét trong các run của một issue, kèm tối đa 50 ca deny/escalate/lỗi và ca lệch C3 của các run đó. */
export async function jevIssueSummary(
  db: Sql,
  companyId: string,
  issueId: string,
  redact: ((text: string) => string) | null,
): Promise<JevIssueSummary> {
  const [runCount] = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM (${issueRunsSql(companyId, issueId)}) r`));
  const runs = int(runCount?.n);
  const empty: JevIssueSummary = {
    calls: 0, allow: 0, deny: 0, appliedDeny: 0, escalate: 0, error: 0, runs, lastAt: null,
    items: [], shadow: { mismatch: 0, items: [] },
  };
  if (runs === 0) return empty;
  const [totals] = rowsOf(await db.execute(issueGateCountsSql(companyId, issueId)));
  const itemRows = rowsOf(
    await db.execute(sql`SELECT e.*, p.hostname AS hostname FROM ${table("crew_jev_gate_events")} e
      LEFT JOIN ${pairingsTable()} p ON p.company_id = e.company_id AND p.machine_id = e.machine_id
      WHERE e.company_id = ${companyId} AND e.run_id IN (${issueRunsSql(companyId, issueId)})
        AND e.verdict IN ('deny', 'escalate', 'error') AND ${CALLED_E}
      ORDER BY e.id DESC LIMIT ${JEV_ISSUE_LIST_MAX}`),
  );
  const shadowRows = rowsOf(
    await db.execute(sql`SELECT *, ${MISMATCH} AS mismatch FROM ${table("crew_jev_shadow")}
      WHERE company_id = ${companyId} AND run_id IN (${issueRunsSql(companyId, issueId)}) AND ${MISMATCH}
      ORDER BY id DESC LIMIT ${JEV_ISSUE_LIST_MAX}`),
  );
  const [mismatchCount] = rowsOf(
    await db.execute(sql`SELECT count(*)::int AS n FROM ${table("crew_jev_shadow")}
      WHERE company_id = ${companyId} AND run_id IN (${issueRunsSql(companyId, issueId)}) AND ${MISMATCH}`),
  );
  return {
    calls: int(totals?.calls), allow: int(totals?.allow), deny: int(totals?.deny), appliedDeny: int(totals?.applied_deny),
    escalate: int(totals?.escalate), error: int(totals?.error), runs, lastAt: iso(totals?.last_at),
    items: itemRows.map(toGateEvent),
    shadow: { mismatch: int(mismatchCount?.n), items: shadowRows.map((row) => toShadowRow(row, redact)) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bản đồ yêu cầu: số lệnh Jev theo từng issue của cây
// ---------------------------------------------------------------------------------------------------------------

const MAP_MAX_DEPTH = 20;

export interface JevMapIssue {
  calls: number;
  deny: number;
  appliedDeny: number;
  escalate: number;
  error: number;
}

export interface JevRequestMap {
  byIssue: Record<string, JevMapIssue>;
  shadowMismatch: Record<string, number>;
}

/** Cây yêu cầu (gốc và mọi hậu duệ, như handler `crew.runs` của plugin) nối với run của từng issue. */
const treeRunsSql = (companyId: string, requestId: string) => sql`WITH RECURSIVE tree(id, depth) AS (
      SELECT id, 0 FROM public.issues WHERE id = ${requestId} AND company_id = ${companyId}
      UNION ALL
      SELECT i.id, t.depth + 1 FROM public.issues i JOIN tree t ON i.parent_id = t.id
      WHERE i.company_id = ${companyId} AND t.depth < ${MAP_MAX_DEPTH}),
    tree_runs AS (
      SELECT r.id AS run_id, tree.id::text AS issue_id FROM tree
      JOIN "heartbeat_runs" r ON r.company_id = ${companyId} AND (r.context_snapshot ->> 'issueId') = tree.id::text)`;

/** Một truy vấn gom nhóm cho cả cây; export để test kiểm kế hoạch (dùng `crew_jev_gate_events_run_idx`). */
export function requestMapGateSql(companyId: string, requestId: string): SQL {
  return sql`${treeRunsSql(companyId, requestId)}
    SELECT tr.issue_id,
      count(*) FILTER (WHERE ${CALLED_E})::int AS calls,
      count(*) FILTER (WHERE ${CALLED_E} AND e.verdict = 'deny')::int AS deny,
      count(*) FILTER (WHERE ${CALLED_E} AND e.applied = 'deny')::int AS applied_deny,
      count(*) FILTER (WHERE ${CALLED_E} AND e.verdict = 'escalate')::int AS escalate,
      count(*) FILTER (WHERE ${CALLED_E} AND e.verdict = 'error')::int AS error
    FROM tree_runs tr JOIN ${table("crew_jev_gate_events")} e ON e.company_id = ${companyId} AND e.run_id = tr.run_id
    GROUP BY tr.issue_id`;
}

/** Số lệnh Jev và ca lệch C3 theo issue của một cây yêu cầu; chỉ issue có dữ liệu mới có khóa (id chữ thường). */
export async function jevRequestMap(db: Sql, companyId: string, requestId: string): Promise<JevRequestMap> {
  const gate = rowsOf(await db.execute(requestMapGateSql(companyId, requestId)));
  const mismatch = rowsOf(
    await db.execute(sql`${treeRunsSql(companyId, requestId)}
      SELECT tr.issue_id, count(*)::int AS n
      FROM tree_runs tr JOIN ${table("crew_jev_shadow")} s ON s.company_id = ${companyId} AND s.run_id = tr.run_id
      WHERE ${MISMATCH_S} GROUP BY tr.issue_id`),
  );
  const byIssue: Record<string, JevMapIssue> = {};
  for (const row of gate) {
    const calls = int(row.calls);
    if (calls === 0) continue;
    byIssue[String(row.issue_id).toLowerCase()] = {
      calls, deny: int(row.deny), appliedDeny: int(row.applied_deny), escalate: int(row.escalate), error: int(row.error),
    };
  }
  const shadowMismatch: Record<string, number> = {};
  for (const row of mismatch) shadowMismatch[String(row.issue_id).toLowerCase()] = int(row.n);
  return { byIssue, shadowMismatch };
}
