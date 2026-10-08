import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { agentTaskSessions, agents, type Db, heartbeatRuns, issueRelations, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { persistActivity, publishActivity } from "../services/activity-log.js";
import { getRunLogStore } from "../services/run-log-store.js";

/** Dòng marker gói trong mô tả issue con, do Trợ Lý ghi. */
export const CREW_BUNDLE_RE = /^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$/m;

export interface CrewBundle {
  id: string;
  seq: number;
}

export function parseCrewBundle(description: string | null | undefined): CrewBundle | null {
  if (!description) return null;
  const match = CREW_BUNDLE_RE.exec(description.replace(/\r\n/g, "\n"));
  return match ? { id: match[1]!, seq: Number(match[2]) } : null;
}

export interface BundleSession {
  lastRunId: string | null;
  sessionParamsJson: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  updatedAt: Date;
}

export interface BundlePredecessorCandidate {
  issueId: string;
  status: string;
  description: string | null;
  /** Task session hoặc session còn lưu trên run của chính agent trên issue này. */
  session: BundleSession | null;
}

export type BundlePredecessor = BundlePredecessorCandidate & { seq: number; session: BundleSession & { lastRunId: string } };

/** Tiền nhiệm: blocker trực tiếp cùng gói, seq nhỏ hơn, đã `done`, agent có session trên đó; seq lớn nhất thắng. */
export function pickBundlePredecessor(
  own: CrewBundle,
  candidates: readonly BundlePredecessorCandidate[],
): BundlePredecessor | null {
  const eligible: BundlePredecessor[] = [];
  for (const candidate of candidates) {
    const bundle = parseCrewBundle(candidate.description);
    const session = candidate.session;
    if (!bundle || bundle.id !== own.id || bundle.seq >= own.seq) continue;
    if (candidate.status !== "done" || !session?.lastRunId || !session.sessionParamsJson || Object.keys(session.sessionParamsJson).length === 0) continue;
    eligible.push({ ...candidate, seq: bundle.seq, session: { ...session, lastRunId: session.lastRunId } });
  }
  eligible.sort((a, b) => b.seq - a.seq || b.session.updatedAt.getTime() - a.session.updatedAt.getTime());
  return eligible[0] ?? null;
}

export interface BundleResumeTarget {
  bundle: CrewBundle;
  predecessor: BundlePredecessor;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Init được ghi vào stdout trước khi adapter trả kết quả; không cần log đã finalize. */
async function sessionIdFromRunLog(run: typeof heartbeatRuns.$inferSelect, adapterType: string): Promise<string | null> {
  if ((adapterType !== "claude_local" && adapterType !== "codex_local") ||
      run.logStore !== "local_file" || !run.logRef) return null;
  // Chặn việc đọc nhầm file của company/agent/run khác kể cả khi logRef hỏng.
  if (run.logRef !== `${run.companyId}/${run.agentId}/${run.id}.ndjson`) return null;
  // Init ở đầu stream. Giới hạn I/O trong claim; thiếu bằng chứng thì mở session mới.
  const maxBytes = 4 * 1024 * 1024;
  let offset = 0;
  let records = "";
  let stdout = "";
  function readInit(line: string): string | null {
    try {
      const event = record(JSON.parse(line));
      const id = adapterType === "claude_local"
        ? event.type === "system" && event.subtype === "init" ? event.session_id : null
        : event.type === "thread.started" ? event.thread_id : null;
      return typeof id === "string" && SESSION_UUID_RE.test(id) ? id : null;
    } catch {
      return null;
    }
  }
  try {
    const store = getRunLogStore();
    while (offset < maxBytes) {
      const page = await store.read({ store: "local_file", logRef: run.logRef }, {
        offset, limitBytes: Math.min(256_000, maxBytes - offset),
      });
      records += page.content;
      let boundary: number;
      while ((boundary = records.indexOf("\n")) >= 0) {
        const entry = record(JSON.parse(records.slice(0, boundary)));
        records = records.slice(boundary + 1);
        if (entry.stream !== "stdout" || typeof entry.chunk !== "string") continue;
        stdout += entry.chunk;
        let lineEnd: number;
        while ((lineEnd = stdout.indexOf("\n")) >= 0) {
          const sessionId = readInit(stdout.slice(0, lineEnd));
          stdout = stdout.slice(lineEnd + 1);
          if (sessionId) return sessionId;
        }
      }
      if (page.nextOffset === undefined) return records.trim() ? null : readInit(stdout);
      if (page.nextOffset <= offset) return null;
      offset = page.nextOffset;
    }
  } catch {
    // Log thiếu/hỏng hoặc lỗi storage không được làm hỏng claim hay đoán ID.
  }
  return null;
}

/** Cancellation có thể giữ run nhưng bỏ qua upsertTaskSession trong executeRun. */
async function sessionFromRun(db: Db, run: typeof heartbeatRuns.$inferSelect, adapterType: string): Promise<BundleSession | null> {
  const context = record(run.contextSnapshot);
  const result = record(run.resultJson);
  const resumeParams = record(context.resumeSessionParams);
  const validId = (values: unknown[]) => values
    .map(nonEmptyString)
    .find((id) => id && (
      adapterType === "claude_local" || adapterType === "codex_local"
        ? SESSION_UUID_RE.test(id)
        : adapterType === "hermes_local"
          ? /^(?:\d{8}_\d{6}_[A-Za-z0-9_-]{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id)
          : true
    ));
  // Kết quả đã persist vẫn ưu tiên; init hiện tại đáng tin hơn ID đầu vào khi CLI đã mở mới.
  const sessionId = validId([run.sessionIdAfter, result.sessionId, result.session_id])
    ?? await sessionIdFromRunLog(run, adapterType)
    ?? validId([run.sessionIdBefore, resumeParams.sessionId]);
  if (!sessionId) return null;

  // UUID, workspace và execution identity phải thuộc chính session/run.
  const params: Record<string, unknown> = {
    ...(nonEmptyString(resumeParams.sessionId) === sessionId ? resumeParams : {}),
    sessionId,
  };
  const workspace = record(context.paperclipWorkspace);
  for (const key of ["cwd", "workspaceId", "repoUrl", "repoRef"] as const) {
    const value = nonEmptyString(workspace[key]);
    if (value) params[key] = value;
  }
  // executeRun lưu identity SSH trước dispatch. Cùng shape với
  // buildRemoteExecutionSessionIdentity; adapter vẫn kiểm identity khi resume.
  const environment = record(context.paperclipEnvironment);
  const host = nonEmptyString(environment.host);
  const username = nonEmptyString(environment.username);
  const remoteCwd = nonEmptyString(environment.remoteCwd);
  const port = environment.port;
  if (environment.driver === "ssh" && host && username && remoteCwd &&
      typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) {
    params.remoteExecution = { transport: "ssh", host, port, username, remoteCwd };
  }
  if (adapterType === "claude_local" && !nonEmptyString(params.mcpServerIdentity)) {
    // MCP identity là JSON.stringify({name,url,connectionId}[]) do adapter lưu,
    // không chứa token hay UUID/cwd của task. Heartbeat chỉ dựng đủ runtimeMcp
    // tại dispatch (kèm tạo gateway/token), không có resolver thuần ở claim.
    // Mượn đúng trường này từ session gần nhất của cùng company/agent/adapter;
    // guard Claude vẫn từ chối nếu tập MCP hiện tại đã đổi. Không mượn prompt,
    // cwd hay remoteExecution của task khác để ép vượt các guard còn lại.
    const [saved] = await db.select({
      identity: sql<string>`${agentTaskSessions.sessionParamsJson}->>'mcpServerIdentity'`,
    }).from(agentTaskSessions).where(and(
      eq(agentTaskSessions.companyId, run.companyId),
      eq(agentTaskSessions.agentId, run.agentId),
      eq(agentTaskSessions.adapterType, adapterType),
      sql`jsonb_typeof(${agentTaskSessions.sessionParamsJson}->'mcpServerIdentity') = 'string'`,
      sql`${agentTaskSessions.sessionParamsJson}->>'mcpServerIdentity' ~ '[^[:space:]]'`,
    )).orderBy(desc(agentTaskSessions.updatedAt), desc(agentTaskSessions.id)).limit(1);
    if (saved) params.mcpServerIdentity = saved.identity;
  }
  return { lastRunId: run.id, sessionParamsJson: params, sessionDisplayId: sessionId, updatedAt: run.updatedAt };
}

/**
 * Tìm session để issue `issueId` của agent nối tiếp. Null khi issue không giao cho agent, không có marker gói,
 * agent đã có session riêng trên issue này, hoặc không có tiền nhiệm hợp lệ là con cùng parent.
 */
export async function findBundlePredecessor(
  db: Db,
  input: { companyId: string; agentId: string; issueId: string },
): Promise<BundleResumeTarget | null> {
  const [issue] = await db
    .select({ assigneeAgentId: issues.assigneeAgentId, description: issues.description, parentId: issues.parentId })
    .from(issues)
    .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
  if (!issue || issue.parentId === null || issue.assigneeAgentId !== input.agentId) return null;
  const bundle = parseCrewBundle(issue.description);
  if (!bundle) return null;
  const [agent] = await db.select({ adapterType: agents.adapterType }).from(agents).where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId)));
  if (!agent) return null;
  const sessionScope = and(
    eq(agentTaskSessions.companyId, input.companyId),
    eq(agentTaskSessions.agentId, input.agentId),
    eq(agentTaskSessions.adapterType, agent.adapterType),
  );
  const own = await db
    .select({ id: agentTaskSessions.id })
    .from(agentTaskSessions)
    .where(and(sessionScope, eq(agentTaskSessions.taskKey, input.issueId)))
    .limit(1);
  if (own.length > 0) return null;
  const blockers = await db
    .select({ issueId: issues.id, status: issues.status, description: issues.description })
    .from(issueRelations)
    .innerJoin(issues, eq(issueRelations.issueId, issues.id))
    .where(
      and(
        eq(issueRelations.companyId, input.companyId),
        eq(issues.companyId, input.companyId),
        eq(issues.parentId, issue.parentId),
        eq(issueRelations.type, "blocks"),
        eq(issueRelations.relatedIssueId, input.issueId),
      ),
    );
  if (blockers.length === 0) return null;
  const sessions = await db
    .select({
      taskKey: agentTaskSessions.taskKey,
      adapterType: agentTaskSessions.adapterType,
      lastRunId: agentTaskSessions.lastRunId,
      sessionParamsJson: agentTaskSessions.sessionParamsJson,
      sessionDisplayId: agentTaskSessions.sessionDisplayId,
      updatedAt: agentTaskSessions.updatedAt,
    })
    .from(agentTaskSessions)
    .where(and(
      eq(agentTaskSessions.companyId, input.companyId),
      eq(agentTaskSessions.agentId, input.agentId),
      inArray(agentTaskSessions.taskKey, blockers.map((b) => b.issueId)),
    ));
  const byKey = new Map<string, BundleSession>(sessions.filter((s) => s.adapterType === agent.adapterType).map((s) => [s.taskKey, s]));
  const hasTaskSession = new Set(sessions.map((s) => s.taskKey));
  for (const blocker of blockers) {
    const marker = parseCrewBundle(blocker.description);
    if (hasTaskSession.has(blocker.issueId) || blocker.status !== "done" ||
        !marker || marker.id !== bundle.id || marker.seq >= bundle.seq) continue;
    // Chọn run mới nhất TRƯỚC khi tìm id: không đào lại session cũ sau một run mới không có id.
    const [latestRun] = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.agentId, input.agentId),
      sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${blocker.issueId}`,
    )).orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id)).limit(1);
    const session = latestRun ? await sessionFromRun(db, latestRun, agent.adapterType) : null;
    if (session) byKey.set(blocker.issueId, session);
  }
  const predecessor = pickBundlePredecessor(
    bundle,
    blockers.map((b) => ({ ...b, session: byKey.get(b.issueId) ?? null })),
  );
  return predecessor ? { bundle, predecessor } : null;
}

/**
 * Chạy sau khi cổng tải cho claim. Ghi tham số resume giống `payload.resumeFromRunId` của stock vào
 * `contextSnapshot` của run (DB, có điều kiện còn `queued`, và object `run` mà `claimQueuedRun` đọc tiếp).
 * `executeRun` ưu tiên tham số tường minh này hơn việc reset session của wake `issue_assigned`.
 */
export async function applyBundleResume(input: {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}): Promise<"applied" | "skipped"> {
  const { db, run } = input;
  if (run.status !== "queued") return "skipped";
  const context = (run.contextSnapshot ?? {}) as Record<string, unknown>;
  const issueId = typeof context.issueId === "string" && context.issueId ? context.issueId : null;
  if (!issueId || context.resumeFromRunId != null || context.resumeSessionParams != null) return "skipped";
  const target = await findBundlePredecessor(db, { companyId: run.companyId, agentId: run.agentId, issueId });
  if (!target) return "skipped";
  const { bundle, predecessor } = target;
  const patch = {
    resumeFromRunId: predecessor.session.lastRunId,
    resumeSessionDisplayId: predecessor.session.sessionDisplayId,
    resumeSessionParams: predecessor.session.sessionParamsJson,
    crewBundleResume: { bundle: bundle.id, fromIssueId: predecessor.issueId },
  };
  // Resume và audit cùng commit; lỗi DB không để lại một nửa thay đổi.
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(heartbeatRuns)
      .set({
        contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(heartbeatRuns.id, run.id),
        eq(heartbeatRuns.companyId, run.companyId),
        eq(heartbeatRuns.agentId, run.agentId),
        eq(heartbeatRuns.status, "queued"),
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}`,
        sql`(${heartbeatRuns.contextSnapshot}->'resumeFromRunId' is null or ${heartbeatRuns.contextSnapshot}->'resumeFromRunId' = 'null'::jsonb)`,
        sql`(${heartbeatRuns.contextSnapshot}->'resumeSessionParams' is null or ${heartbeatRuns.contextSnapshot}->'resumeSessionParams' = 'null'::jsonb)`,
      ))
      .returning({ contextSnapshot: heartbeatRuns.contextSnapshot });
    if (!updated) return null;
    const { publication } = await persistActivity(tx as unknown as Db, {
      companyId: run.companyId,
      actorType: "system",
      actorId: "crew",
      action: "crew.bundle_resume",
      entityType: "heartbeat_run",
      entityId: run.id,
      agentId: run.agentId,
      runId: run.id,
      issueId,
      details: { bundle: bundle.id, fromIssueId: predecessor.issueId, toIssueId: issueId, resumeFromRunId: predecessor.session.lastRunId },
    });
    return { ...updated, publication };
  });
  if (!result) return "skipped";
  run.contextSnapshot = result.contextSnapshot;
  try {
    publishActivity(result.publication);
  } catch (err) {
    // DB đã commit; lỗi thông báo không thay đổi kết quả nối session.
    logger.warn({ err, runId: run.id }, "crew-bundle-resume: activity publication failed");
  }
  return "applied";
}

/** Lỗi bất kỳ: run chạy session mới như stock (không giữ run, không ném). */
export async function applyBundleResumeSafely(input: {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}): Promise<"applied" | "skipped"> {
  try {
    return await applyBundleResume(input);
  } catch (err) {
    logger.warn({ err, runId: input.run.id }, "crew-bundle-resume: failed open");
    return "skipped";
  }
}
