import { type Request, type Response, Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { badRequest, HttpError, notFound, payloadTooLarge } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { requireOwner, resolveContributionActor, type ContributionActor } from "./contributions.js";
import { jevJudge } from "./jev-client.js";
import { machineSecret, resolveCrewCompanySecret, verifyMachineRequest } from "./jev-machine-auth.js";
import { startJevShadowWorker } from "./jev-shadow.js";
import {
  clearJevKey,
  gateEventsQuerySchema,
  getJevSettings,
  insertGateEvents,
  jevApiKeySchema,
  jevGateEventSchema,
  type JevGateEvent,
  jevSettingsInputSchema,
  type JevSettingsRecord,
  jevIssueSummary,
  jevStats,
  jevTablesReady,
  labelGateEvent,
  listGateEvents,
  listJevMachines,
  listShadow,
  recordMachineEvents,
  recordMachinePull,
  resolveJevApiKey,
  saveJevSettings,
  shadowQuerySchema,
  storeJevKey,
} from "./jev-store.js";
import { loadJevUse } from "./vendor/jev-use.js";

const BASE = "/crew/companies/:companyId/jev";
const BODY_LOCAL = "crewJevBody";

export const JEV_ERRORS = {
  invalid: "crew_jev_invalid",
  unavailable: "crew_jev_unavailable",
  notFound: "crew_jev_not_found",
  tooManyEvents: "too_many_events",
} as const;

/** Bản tin pull nhỏ; lô events tối đa 256 KiB và 500 dòng. */
export const JEV_PULL_MAX_BYTES = 16 * 1024;
export const JEV_EVENTS_MAX_BYTES = 256 * 1024;
export const JEV_EVENTS_MAX_ROWS = 500;

function jevUnavailable(): HttpError {
  return new HttpError(503, "Crew: chưa có bảng Jev (plugin crew.core chưa nâng cấp), hãy thử lại sau.", {
    code: JEV_ERRORS.unavailable,
  });
}

function invalid(message: string): HttpError {
  return badRequest(message, { code: JEV_ERRORS.invalid });
}

/** Body đã được dời khỏi `req.body` (xem router), handler chỉ đọc ở đây. */
function takeBody(res: Response): unknown {
  return res.locals[BODY_LOCAL];
}

async function ownerOf(db: Db, req: Request): Promise<ContributionActor> {
  const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
  requireOwner(actor);
  if (!(await jevTablesReady(db))) throw jevUnavailable();
  return actor;
}

async function settingsView(db: Db, settings: JevSettingsRecord) {
  const machines = await listJevMachines(db, settings.companyId);
  return {
    enabled: settings.enabled,
    gateMode: settings.gateMode,
    model: settings.model,
    threshold: settings.threshold,
    timeoutMs: settings.timeoutMs,
    serverShadow: settings.serverShadow,
    hasKey: settings.keySecretId !== null,
    keyFingerprint: settings.keyFingerprint,
    version: settings.version,
    updatedAt: settings.updatedAt,
    machines: machines.map((machine) => ({
      machineId: machine.machineId,
      hostname: machine.hostname,
      revoked: machine.revoked,
      appliedVersion: machine.appliedVersion,
      // Máy đang giữ đúng key hiện tại (cả hai cùng không có key cũng tính là khớp).
      keyOk: machine.keyFingerprint === settings.keyFingerprint,
      lastPullAt: machine.lastPullAt,
      lastEventsAt: machine.lastEventsAt,
    })),
  };
}

const putKeySchema = z.object({ apiKey: jevApiKeySchema, test: z.boolean().optional() }).strict();
const statsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) }).strict();
const labelBodySchema = z.object({ label: z.enum(["correct", "wrong"]).nullable() }).strict();
const gateEventIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value));

const fingerprintSchema = z.string().regex(/^[0-9a-f]{12}$/).nullable();
const pullSchema = z.object({
  version: z.literal(1),
  companyId: z.string(),
  machineId: z.string(),
  sentAt: z.string().datetime({ offset: true }),
  appliedVersion: z.number().int().min(0).max(2_147_483_647).nullable(),
  keyFingerprint: fingerprintSchema,
});
const eventsSchema = z.object({
  version: z.literal(1),
  companyId: z.string(),
  machineId: z.string(),
  sentAt: z.string().datetime({ offset: true }),
  events: z.array(z.unknown()),
});

/** Câu hỏi nhỏ nhất để thử key; không có dữ liệu của company. */
const KEY_TEST_STATE = "Crew is checking that its Jev API key works. This request carries no user data.";

/**
 * Router Jev của Crew (`/api/crew/companies/:companyId/jev/...`), gắn bên trong router góp ý (vá lõi C7) nên không cần vá
 * lõi mới.
 *
 * - Route owner (`/settings`, `/key`, `/stats`, `/gate-events`, `/shadow`, `/issues/:issueId/summary`): chỉ owner đăng nhập bằng phiên trình duyệt
 *   (`resolveContributionActor` + `requireOwner`); board key trên Mac, agent và mọi role khác nhận 403.
 * - Route máy (`/machine/pull`, `/machine/events`): Mac ký HMAC bằng khóa máy, cùng luật webhook máy của plugin.
 * - Body bị dời khỏi `req.body` trước mọi bước có thể lỗi, nên log HTTP và báo lỗi không bao giờ chứa key hay lệnh.
 * - Key không bao giờ có trong response, trừ response pull cho Mac đã ký đúng khi vân tay key trên Mac khác server.
 * - Tạo router cũng bật worker so sánh Jev với regex (`jev-shadow.ts`).
 */
export function crewJevRoutes(db: Db): Router {
  const router = Router();
  // Worker so sánh Jev với regex: một timer cho cả process, không chạy khi test.
  startJevShadowWorker(db);

  router.use(BASE, (req, res, next) => {
    res.locals[BODY_LOCAL] = req.body;
    req.body = {};
    next();
  });

  router.get(`${BASE}/settings`, async (req, res) => {
    const actor = await ownerOf(db, req);
    res.json(await settingsView(db, await getJevSettings(db, actor.companyId)));
  });

  router.put(`${BASE}/settings`, async (req, res) => {
    const actor = await ownerOf(db, req);
    const body = jevSettingsInputSchema.safeParse(takeBody(res) ?? {});
    if (!body.success) {
      throw badRequest("Cấu hình Jev không hợp lệ.", { code: JEV_ERRORS.invalid, issues: body.error.issues });
    }
    const settings = await saveJevSettings(db, actor.companyId, body.data, actor.userId);
    logger.info(
      { companyId: actor.companyId, version: settings.version, enabled: settings.enabled, gateMode: settings.gateMode },
      "crew jev settings saved",
    );
    res.json(await settingsView(db, settings));
  });

  router.put(`${BASE}/key`, async (req, res) => {
    const actor = await ownerOf(db, req);
    // Không kèm `issues` của zod: chúng có thể chép lại giá trị key.
    const body = putKeySchema.safeParse(takeBody(res) ?? {});
    if (!body.success) throw invalid("Key OpenRouter phải là một dòng 20–200 ký tự, không có khoảng trắng.");
    const settings = await storeJevKey(db, actor.companyId, body.data.apiKey, actor.userId);
    logger.info({ companyId: actor.companyId, version: settings.version }, "crew jev key stored");
    const result: Record<string, unknown> = { hasKey: true, keyFingerprint: settings.keyFingerprint };
    if (body.data.test) {
      const judged = await jevJudge({
        apiKey: body.data.apiKey,
        model: settings.model,
        timeoutMs: settings.timeoutMs,
        state: KEY_TEST_STATE,
        questions: { ok: { type: "noul", question: "Is this a connectivity check?" } },
      });
      if (judged.ok) result.test = "ok";
      else {
        result.test = "error";
        result.errorCode = judged.errorCode;
      }
      logger.info({ companyId: actor.companyId, test: result.test, errorCode: result.errorCode }, "crew jev key tested");
    }
    res.json(result);
  });

  router.delete(`${BASE}/key`, async (req, res) => {
    const actor = await ownerOf(db, req);
    const settings = await clearJevKey(db, actor.companyId, actor.userId);
    logger.info({ companyId: actor.companyId, version: settings.version }, "crew jev key cleared");
    res.json({ hasKey: false });
  });

  router.get(`${BASE}/stats`, async (req, res) => {
    const actor = await ownerOf(db, req);
    const query = statsQuerySchema.safeParse(req.query);
    if (!query.success) throw invalid("Số ngày phải từ 1 đến 30.");
    res.json(await jevStats(db, actor.companyId, query.data.days));
  });

  router.get(`${BASE}/gate-events`, async (req, res) => {
    const actor = await ownerOf(db, req);
    const query = gateEventsQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw badRequest("Tham số lọc không hợp lệ.", { code: JEV_ERRORS.invalid, issues: query.error.issues });
    }
    res.json(await listGateEvents(db, actor.companyId, query.data));
  });

  router.post(`${BASE}/gate-events/:id/label`, async (req, res) => {
    const actor = await ownerOf(db, req);
    const id = gateEventIdSchema.safeParse(req.params.id);
    if (!id.success) throw notFound("Không có dòng gate này.", { code: JEV_ERRORS.notFound });
    const body = labelBodySchema.safeParse(takeBody(res) ?? {});
    if (!body.success) throw invalid("Nhãn phải là correct, wrong hoặc null.");
    const row = await labelGateEvent(db, actor.companyId, id.data, body.data.label, actor.userId);
    if (!row) throw notFound("Không có dòng gate này.", { code: JEV_ERRORS.notFound });
    logger.info({ companyId: actor.companyId, gateEventId: row.id, label: row.ownerLabel }, "crew jev gate event labeled");
    res.json(row);
  });

  router.get(`${BASE}/shadow`, async (req, res) => {
    const actor = await ownerOf(db, req);
    const query = shadowQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw badRequest("Tham số lọc không hợp lệ.", { code: JEV_ERRORS.invalid, issues: query.error.issues });
    }
    let redact: ((text: string) => string) | null = null;
    try {
      redact = (await loadJevUse()).redactSecrets;
    } catch {
      // Không nạp được hàm che thì không trả đoạn trích.
    }
    res.json(await listShadow(db, actor.companyId, query.data, redact));
  });

  router.get(`${BASE}/issues/:issueId/summary`, async (req, res) => {
    const actor = await ownerOf(db, req);
    const issueId = z.string().uuid().safeParse(req.params.issueId);
    if (!issueId.success) throw badRequest("Mã issue không hợp lệ.", { code: JEV_ERRORS.invalid });
    const settings = await getJevSettings(db, actor.companyId);
    let redact: ((text: string) => string) | null = null;
    try {
      redact = (await loadJevUse()).redactSecrets;
    } catch {
      // Không nạp được hàm che thì không trả đoạn trích.
    }
    res.json({ enabled: settings.enabled, ...(await jevIssueSummary(db, actor.companyId, issueId.data, redact)) });
  });

  const machineRequest = (req: Request, maxBytes: number) =>
    verifyMachineRequest(req, {
      companyId: String(req.params.companyId ?? ""),
      maxBytes,
      resolveSecret: async (companyId, machineId) =>
        machineSecret(db, companyId, machineId, await resolveCrewCompanySecret(db, companyId)),
    });

  router.post(`${BASE}/machine/pull`, async (req, res) => {
    const verified = await machineRequest(req, JEV_PULL_MAX_BYTES);
    const body = pullSchema.safeParse(verified.body);
    if (!body.success) throw badRequest("Bản tin không hợp lệ.", { code: "invalid_body" });
    if (!(await jevTablesReady(db))) throw jevUnavailable();
    const settings = await getJevSettings(db, verified.companyId);
    await recordMachinePull(db, {
      companyId: verified.companyId,
      machineId: verified.machineId,
      appliedVersion: body.data.appliedVersion,
      keyFingerprint: body.data.keyFingerprint,
    });
    const hasKey = settings.keySecretId !== null;
    const response: Record<string, unknown> = {
      version: settings.version,
      enabled: settings.enabled,
      gateMode: settings.gateMode,
      model: settings.model,
      threshold: settings.threshold,
      timeoutMs: settings.timeoutMs,
      hasKey,
      keyFingerprint: settings.keyFingerprint,
    };
    let sentKey = false;
    if (settings.enabled && hasKey && body.data.keyFingerprint !== settings.keyFingerprint) {
      const apiKey = await resolveJevApiKey(db, settings, "crew-jev-machine-pull");
      if (apiKey) {
        response.apiKey = apiKey;
        sentKey = true;
      }
    }
    logger.info(
      { companyId: verified.companyId, machineId: verified.machineId, version: settings.version, sentKey },
      "crew jev machine pull",
    );
    res.set("Cache-Control", "no-store");
    res.json(response);
  });

  router.post(`${BASE}/machine/events`, async (req, res) => {
    const verified = await machineRequest(req, JEV_EVENTS_MAX_BYTES);
    const body = eventsSchema.safeParse(verified.body);
    if (!body.success) throw badRequest("Bản tin không hợp lệ.", { code: "invalid_body" });
    if (body.data.events.length > JEV_EVENTS_MAX_ROWS) {
      throw payloadTooLarge(`Một lô tối đa ${JEV_EVENTS_MAX_ROWS} dòng.`, { code: JEV_ERRORS.tooManyEvents });
    }
    if (!(await jevTablesReady(db))) throw jevUnavailable();
    let redactSecrets: (text: string) => string;
    try {
      ({ redactSecrets } = await loadJevUse());
    } catch {
      // Không che được thì không ghi lệnh; Mac giữ con trỏ và gửi lại lượt sau.
      throw new HttpError(503, "Crew: chưa nạp được Jev, hãy thử lại sau.", { code: JEV_ERRORS.unavailable });
    }
    // Dòng hỏng hoặc của company khác bị bỏ (đếm `rejected`) để Mac vẫn tiến được con trỏ.
    const valid: JevGateEvent[] = [];
    for (const raw of body.data.events) {
      const parsed = jevGateEventSchema.safeParse(raw);
      if (parsed.success && parsed.data.companyId.toLowerCase() === verified.companyId) valid.push(parsed.data);
    }
    const rejected = body.data.events.length - valid.length;
    const { accepted, duplicates } = await insertGateEvents(db, verified.companyId, verified.machineId, valid, redactSecrets);
    await recordMachineEvents(db, verified.companyId, verified.machineId);
    logger.info(
      { companyId: verified.companyId, machineId: verified.machineId, accepted, duplicates, rejected },
      "crew jev machine events",
    );
    res.json({ accepted, duplicates, rejected });
  });

  return router;
}
