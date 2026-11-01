import { type Request, Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { badRequest, HttpError, unauthorized } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { requireOwner, resolveContributionActor } from "../contributions.js";
import { verifyUserPassword } from "./password.js";
import { buildKillOwnerSessionCommand, buildListOwnerSessionsCommand, parseOwnerSessions } from "./remote-command.js";
import { type CrewTerminalSshConnector, createSsh2CrewTerminalConnector, resolveMachineSshTarget } from "./ssh-connector.js";
import { listTerminalTargets, resolveTerminalTarget } from "./targets.js";
import { crewTerminalTicketStore } from "./ticket-store.js";
import { crewTerminalUnlockThrottle } from "./unlock-throttle.js";
import { crewTerminalUnlockStore } from "./unlock-store.js";

const BASE = "/crew/companies/:companyId";

export const TERMINAL_ERRORS = {
  invalid: "crew_terminal_invalid",
  badPassword: "crew_terminal_bad_password",
  locked: "crew_terminal_locked",
  throttled: "crew_terminal_unlock_throttled",
  targetMissing: "crew_terminal_target_missing",
} as const;

/** Mỗi máy được hỏi danh sách phiên tmux tối đa chừng này mili giây. */
const SESSIONS_TIMEOUT_MS = 10_000;

const unlockBody = z.object({ password: z.string().min(1).max(500) }).strict();
const ticketBody = z.object({ machineId: z.string().uuid(), projectId: z.string().uuid() }).strict();
const killBody = z.object({ machineId: z.string().uuid(), projectKey: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/) }).strict();

/**
 * Router terminal web của Crew, gắn trong router góp ý. Chỉ owner đăng nhập bằng phiên trình duyệt.
 *
 * - `GET …/terminal/targets`: máy và project `ready` để mở terminal.
 * - `GET|POST …/terminal/unlock`: trạng thái và mở khoá bằng mật khẩu đăng nhập; hạn 12 giờ theo phiên.
 * - `POST …/terminal/tickets` `{ machineId, projectId }`: vé WebSocket dùng một lần (60 giây), cần đã mở khoá.
 * - `GET …/terminal/sessions`: phiên tmux owner đang sống trên từng máy có project `ready` (hỏi qua SSH, chỉ đọc), kể cả
 *   phiên mở từ trình duyệt hay máy khác; máy không hỏi được thì `ok: false`.
 * - `POST …/terminal/sessions/kill` `{ machineId, projectKey }`: tắt hẳn phiên tmux `crew-owner-<khóa>` trên máy đã ghép
 *   (giết cả chương trình đang chạy trong đó), cần đã mở khoá; `{ killed }` false khi phiên không còn.
 */
export function crewTerminalRoutes(
  db: Db,
  opts: { connector?: CrewTerminalSshConnector; resolveSshTarget?: typeof resolveMachineSshTarget } = {},
): Router {
  const connector = opts.connector ?? createSsh2CrewTerminalConnector();
  const resolveSshTarget = opts.resolveSshTarget ?? resolveMachineSshTarget;
  const router = Router();
  const ownerOf = async (req: Request) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
    requireOwner(actor);
    const sessionId = typeof req.actor?.sessionId === "string" ? req.actor.sessionId : "";
    if (!sessionId) throw unauthorized();
    return { ...actor, sessionId };
  };
  const body = <T>(schema: z.ZodType<T>, value: unknown, message: string): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw badRequest(message, { code: TERMINAL_ERRORS.invalid, issues: parsed.error.issues });
    return parsed.data;
  };

  router.get(`${BASE}/terminal/targets`, async (req, res) => {
    const actor = await ownerOf(req);
    res.json({ items: await listTerminalTargets(db, actor.companyId) });
  });

  router.get(`${BASE}/terminal/unlock`, async (req, res) => {
    const actor = await ownerOf(req);
    const { unlocked, expiresAt } = crewTerminalUnlockStore.status(actor.sessionId);
    res.json({ unlocked, expiresAt: expiresAt?.toISOString() ?? null });
  });

  router.post(`${BASE}/terminal/unlock`, async (req, res) => {
    const actor = await ownerOf(req);
    const { password } = body(unlockBody, req.body, "Cần nhập mật khẩu.");
    // Giữ chỗ trước khi kiểm mật khẩu: lần thử đang chạy đã tính là một lần sai.
    if (!crewTerminalUnlockThrottle.reserve(actor.userId)) {
      throw new HttpError(429, "Nhập sai mật khẩu quá nhiều lần, hãy thử lại sau 15 phút.", { code: TERMINAL_ERRORS.throttled });
    }
    if (!(await verifyUserPassword(db, actor.userId, password))) {
      throw new HttpError(403, "Mật khẩu không đúng.", { code: TERMINAL_ERRORS.badPassword });
    }
    crewTerminalUnlockThrottle.clear(actor.userId);
    const { expiresAt } = crewTerminalUnlockStore.unlock(actor.sessionId);
    logger.info({ companyId: actor.companyId, userId: actor.userId }, "crew terminal unlocked");
    res.json({ expiresAt: expiresAt.toISOString() });
  });

  router.post(`${BASE}/terminal/tickets`, async (req, res) => {
    const actor = await ownerOf(req);
    const { machineId, projectId } = body(ticketBody, req.body, "machineId và projectId không hợp lệ.");
    if (!crewTerminalUnlockStore.status(actor.sessionId).unlocked) {
      throw new HttpError(423, "Terminal đang khoá, hãy nhập mật khẩu để mở.", { code: TERMINAL_ERRORS.locked });
    }
    if (!(await resolveTerminalTarget(db, actor.companyId, machineId, projectId))) {
      throw new HttpError(404, "Không tìm thấy project sẵn sàng trên máy này.", { code: TERMINAL_ERRORS.targetMissing });
    }
    const { ticket, expiresAt } = crewTerminalTicketStore.issue({
      companyId: actor.companyId, userId: actor.userId, sessionId: actor.sessionId, machineId, projectId,
    });
    res.status(201).json({ ticket, expiresAt: expiresAt.toISOString() });
  });

  router.get(`${BASE}/terminal/sessions`, async (req, res) => {
    const actor = await ownerOf(req);
    const targets = await listTerminalTargets(db, actor.companyId);
    const machines = [...new Map(targets.map((t) => [t.machineId, t.hostname])).entries()];
    const results = await Promise.all(
      machines.map(async ([machineId, hostname]) => {
        try {
          const target = await resolveSshTarget(db, actor.companyId, machineId);
          if (!target) return { machineId, hostname, ok: false, sessions: [] };
          const output = await connector.run({ target, command: buildListOwnerSessionsCommand(), timeoutMs: SESSIONS_TIMEOUT_MS });
          return { machineId, hostname, ok: true, sessions: parseOwnerSessions(output) };
        } catch (err) {
          logger.warn({ companyId: actor.companyId, machineId, err: (err as Error).message }, "crew terminal sessions failed");
          return { machineId, hostname, ok: false, sessions: [] };
        }
      }),
    );
    const items = results.flatMap(({ machineId, hostname, sessions }) =>
      sessions.map((session) => {
        const project = targets.find((t) => t.machineId === machineId && t.projectKey === session.projectKey);
        return {
          machineId,
          hostname,
          projectKey: session.projectKey,
          projectId: project?.projectId ?? null,
          projectName: project?.projectName ?? null,
          attached: session.attached,
          createdAt: session.createdAt,
          activityAt: session.activityAt,
        };
      }),
    );
    res.json({ items, machines: results.map(({ machineId, hostname, ok }) => ({ machineId, hostname, ok })) });
  });

  router.post(`${BASE}/terminal/sessions/kill`, async (req, res) => {
    const actor = await ownerOf(req);
    const { machineId, projectKey } = body(killBody, req.body, "machineId và projectKey không hợp lệ.");
    if (!crewTerminalUnlockStore.status(actor.sessionId).unlocked) {
      throw new HttpError(423, "Terminal đang khoá, hãy nhập mật khẩu để mở.", { code: TERMINAL_ERRORS.locked });
    }
    const target = await resolveSshTarget(db, actor.companyId, machineId);
    if (!target) {
      throw new HttpError(404, "Không tìm thấy máy đã ghép.", { code: TERMINAL_ERRORS.targetMissing });
    }
    const output = await connector.run({ target, command: buildKillOwnerSessionCommand(projectKey), timeoutMs: SESSIONS_TIMEOUT_MS });
    const killed = output.trim().split(/\r?\n/).includes("killed");
    logger.info({ companyId: actor.companyId, userId: actor.userId, machineId, projectKey, killed }, "crew terminal session killed");
    res.json({ killed });
  });

  return router;
}
