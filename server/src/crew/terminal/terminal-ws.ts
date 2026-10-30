import type { IncomingMessage, Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import type { BetterAuthSessionResult } from "../../auth/better-auth.js";
import { logger } from "../../middleware/logger.js";
import type { EnvironmentCustomImageSshShell } from "../../realtime/environment-custom-image-terminal-ws.js";
import { rowsOf } from "../project-roles.js";
import { buildOwnerTerminalCommand } from "./remote-command.js";
import {
  createSsh2CrewTerminalConnector,
  resolveMachineSshTarget,
  type CrewTerminalSshConnector,
  type CrewTerminalSshTarget,
} from "./ssh-connector.js";
import { resolveTerminalTarget, type TerminalTarget } from "./targets.js";
import { crewTerminalTicketStore, type TerminalTicketClaims, type TerminalTicketStore } from "./ticket-store.js";
import { crewTerminalUnlockStore, type TerminalUnlockStore } from "./unlock-store.js";

interface TerminalSocket {
  readyState: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "pong" | "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

interface TerminalServer {
  clients: Set<TerminalSocket>;
  close(callback?: (err?: Error) => void): void;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, callback: (ws: TerminalSocket) => void): void;
}

interface UpgradeRequest extends IncomingMessage {
  paperclipWebSocketHandled?: boolean;
}

/** Kết quả kiểm lúc nâng cấp: đủ để mở SSH mà không cần hỏi lại DB. */
type AuthorizedTerminal = {
  claims: TerminalTicketClaims;
  target: TerminalTarget;
  sshTarget: CrewTerminalSshTarget;
  cols: number;
  rows: number;
};

class UpgradeRejected extends Error {
  constructor(readonly statusLine: "401 Unauthorized" | "403 Forbidden") {
    super(statusLine);
  }
}

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (opts: { noServer: boolean }) => TerminalServer;
};

const PATH_RE = /^\/api\/crew\/companies\/([^/]+)\/terminal\/ws$/;
const COLS = { min: 2, max: 500, fallback: 80 };
const ROWS = { min: 2, max: 300, fallback: 24 };
const PING_INTERVAL_MS = 30_000;

function parseCompanyId(pathname: string): string | null {
  const match = PATH_RE.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1] ?? "") || null;
  } catch {
    return null;
  }
}

const inRange = (value: unknown, range: { min: number; max: number }): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= range.min && value <= range.max;

function parseDimension(raw: string | null, range: typeof COLS): number {
  if (!raw || !/^\d{1,4}$/.test(raw)) return range.fallback;
  const value = Number(raw);
  return inRange(value, range) ? value : range.fallback;
}

function headersFromIncomingMessage(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(req.headers)) {
    if (!raw) continue;
    if (Array.isArray(raw)) for (const value of raw) headers.append(key, value);
    else headers.set(key, raw);
  }
  return headers;
}

function rejectUpgrade(socket: Duplex, statusLine: string) {
  if (socket.destroyed) return;
  try {
    socket.once("finish", () => socket.destroy());
    socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${statusLine}`);
  } catch {
    socket.destroy();
  }
}

function decodeFrame(raw: unknown): Record<string, unknown> | null {
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Người dùng vẫn là owner đang hoạt động của company (kiểm lại lúc nâng cấp, vé chỉ cấp cho owner). */
async function isActiveOwner(db: Db, companyId: string, userId: string): Promise<boolean> {
  const row = rowsOf(
    await db.execute(sql`SELECT membership_role FROM "company_memberships"
      WHERE company_id = ${companyId} AND principal_type = 'user' AND principal_id = ${userId} AND status = 'active'
      LIMIT 1`),
  )[0];
  return row?.membership_role === "owner";
}

/**
 * WebSocket terminal của owner: `/api/crew/companies/:companyId/terminal/ws?ticket=…&cols=…&rows=…`.
 *
 * Mọi kiểm tra chạy trước khi tạo WebSocket; hỏng bước nào thì trả 401/403 rồi huỷ socket:
 * có phiên → vé dùng một lần → vé khớp company, người dùng, phiên → vẫn là owner → phiên còn mở khoá
 * → project còn `ready` trên máy → máy có thông tin SSH. Path khác thì để các handler `upgrade` khác lo.
 * Không ghi vé, nội dung gõ hay output vào log.
 */
export function setupCrewTerminalWebSocketServer(
  server: HttpServer,
  db: Db,
  opts: {
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
    ticketStore?: TerminalTicketStore;
    unlockStore?: TerminalUnlockStore;
    connector?: CrewTerminalSshConnector;
    resolveSshTarget?: typeof resolveMachineSshTarget;
    pingIntervalMs?: number;
  },
): { close(): Promise<void> } {
  const wss = new WebSocketServer({ noServer: true });
  const ticketStore = opts.ticketStore ?? crewTerminalTicketStore;
  const unlockStore = opts.unlockStore ?? crewTerminalUnlockStore;
  const connector = opts.connector ?? createSsh2CrewTerminalConnector();
  const resolveSshTarget = opts.resolveSshTarget ?? resolveMachineSshTarget;
  const alive = new Map<TerminalSocket, boolean>();
  const closers = new Set<(reason: string) => void>();

  const pingTimer = setInterval(() => {
    for (const [socket, ok] of alive) {
      if (!ok) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, opts.pingIntervalMs ?? PING_INTERVAL_MS);
  pingTimer.unref?.();

  const authorize = async (req: IncomingMessage, companyId: string, url: URL): Promise<AuthorizedTerminal> => {
    const session = opts.resolveSessionFromHeaders ? await opts.resolveSessionFromHeaders(headersFromIncomingMessage(req)) : null;
    const userId = session?.user?.id;
    const sessionId = session?.session?.id;
    if (!userId || !sessionId) throw new UpgradeRejected("401 Unauthorized");

    const ticket = url.searchParams.get("ticket") ?? "";
    const claims = ticket ? ticketStore.consume(ticket) : null;
    if (!claims) throw new UpgradeRejected("401 Unauthorized");

    if (claims.companyId !== companyId || claims.userId !== userId || claims.sessionId !== sessionId) {
      throw new UpgradeRejected("403 Forbidden");
    }
    if (!(await isActiveOwner(db, companyId, userId))) throw new UpgradeRejected("403 Forbidden");
    if (!unlockStore.status(sessionId).unlocked) throw new UpgradeRejected("403 Forbidden");
    const target = await resolveTerminalTarget(db, companyId, claims.machineId, claims.projectId);
    if (!target) throw new UpgradeRejected("403 Forbidden");
    const sshTarget = await resolveSshTarget(db, companyId, claims.machineId);
    if (!sshTarget) throw new UpgradeRejected("403 Forbidden");

    return {
      claims,
      target,
      sshTarget,
      cols: parseDimension(url.searchParams.get("cols"), COLS),
      rows: parseDimension(url.searchParams.get("rows"), ROWS),
    };
  };

  const serve = (socket: TerminalSocket, auth: AuthorizedTerminal) => {
    const { userId, machineId, projectId } = auth.claims;
    let shell: EnvironmentCustomImageSshShell | null = null;
    let finished = false;

    const send = (frame: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
    };
    const finish = (reason: string, code?: number) => {
      if (finished) return;
      finished = true;
      alive.delete(socket);
      closers.delete(finish);
      shell?.close();
      shell = null;
      if (code !== undefined && socket.readyState === WebSocket.OPEN) socket.close(code, reason);
      logger.info({ event: "crew_terminal_close", userId, machineId, projectId, reason }, "crew terminal closed");
    };
    const fail = (reason: string) => {
      send({ type: "error", message: "Mất kết nối SSH tới máy." });
      finish(reason, 1011);
    };

    alive.set(socket, true);
    closers.add(finish);
    socket.on("pong", () => {
      if (!finished) alive.set(socket, true);
    });
    socket.on("close", () => finish("client_closed"));
    socket.on("error", () => finish("client_error"));
    socket.on("message", (raw) => {
      const frame = decodeFrame(raw);
      if (!frame || !shell) return;
      if (frame.type === "input" && typeof frame.data === "string") shell.write(frame.data);
      else if (frame.type === "resize" && inRange(frame.cols, COLS) && inRange(frame.rows, ROWS)) {
        shell.resize(frame.cols, frame.rows);
      }
    });

    let command: string;
    try {
      command = buildOwnerTerminalCommand({ projectKey: auth.target.projectKey, branch: auth.target.branch });
    } catch {
      fail("invalid_target");
      return;
    }

    connector
      .open({ target: auth.sshTarget, command, cols: auth.cols, rows: auth.rows })
      .then((opened) => {
        if (finished) {
          opened.close();
          return;
        }
        shell = opened;
        opened.onData((data) => send({ type: "output", data }));
        opened.onClose(() => {
          if (finished) return;
          send({ type: "closed", reason: "shell_closed" });
          finish("shell_closed", 1000);
        });
        opened.onError((err) => {
          if (finished) return;
          logger.warn({ errorName: err.name, userId, machineId, projectId }, "crew terminal ssh stream failed");
          fail("ssh_error");
        });
        logger.info({ event: "crew_terminal_open", userId, machineId, projectId, reason: "opened" }, "crew terminal opened");
        send({ type: "ready" });
      })
      .catch((err: unknown) => {
        logger.warn(
          { errorName: err instanceof Error ? err.name : typeof err, userId, machineId, projectId },
          "crew terminal ssh connect failed",
        );
        fail("ssh_connect_error");
      });
  };

  server.on("upgrade", (req: UpgradeRequest, socket: Duplex, head: Buffer) => {
    if (!req.url || req.paperclipWebSocketHandled) return;
    const url = new URL(req.url, "http://localhost");
    const companyId = parseCompanyId(url.pathname);
    if (!companyId) return;
    req.paperclipWebSocketHandled = true;

    const onSocketError = (err: Error) => logger.warn({ errorName: err.name }, "crew terminal upgrade socket error");
    socket.on("error", onSocketError);

    void authorize(req, companyId, url)
      .then((auth) => {
        socket.off("error", onSocketError);
        if (socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) => serve(ws, auth));
      })
      .catch((err: unknown) => {
        if (err instanceof UpgradeRejected) {
          logger.warn({ status: err.statusLine, companyId }, "crew terminal upgrade rejected");
          rejectUpgrade(socket, err.statusLine);
          return;
        }
        logger.error({ errorName: err instanceof Error ? err.name : typeof err, companyId }, "crew terminal upgrade failed");
        rejectUpgrade(socket, "500 Internal Server Error");
      });
  });

  const close = () =>
    new Promise<void>((resolve) => {
      clearInterval(pingTimer);
      for (const finish of [...closers]) finish("server_shutdown");
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolve());
    });
  if (typeof server.on === "function") server.on("close", () => void close());

  return { close };
}
