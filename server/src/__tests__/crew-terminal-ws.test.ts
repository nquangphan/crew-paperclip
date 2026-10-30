import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveTerminalTargetMock, loggerMock } = vi.hoisted(() => ({
  resolveTerminalTargetMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../crew/terminal/targets.js", () => ({ resolveTerminalTarget: resolveTerminalTargetMock }));
vi.mock("../middleware/logger.js", () => ({ logger: loggerMock }));

import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import type { CrewTerminalSshConnector, CrewTerminalSshTarget } from "../crew/terminal/ssh-connector.js";
import { setupCrewTerminalWebSocketServer } from "../crew/terminal/terminal-ws.js";
import { createTerminalTicketStore, type TerminalTicketStore } from "../crew/terminal/ticket-store.js";
import { createTerminalUnlockStore, type TerminalUnlockStore } from "../crew/terminal/unlock-store.js";
import type { EnvironmentCustomImageSshShell } from "../realtime/environment-custom-image-terminal-ws.js";
import { setupEnvironmentCustomImageTerminalWebSocketServer } from "../realtime/environment-custom-image-terminal-ws.js";
import { setupLiveEventsWebSocketServer } from "../realtime/live-events-ws.js";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws") as {
  WebSocket: new (url: string, opts?: { headers?: Record<string, string>; autoPong?: boolean }) => {
    readyState: number;
    send(data: string): void;
    close(): void;
    on(event: "open", listener: () => void): void;
    on(event: "message", listener: (data: Buffer | string) => void): void;
    on(event: "close", listener: (code: number) => void): void;
    on(event: "error", listener: (err: Error) => void): void;
  };
};
type Client = InstanceType<typeof WebSocket>;

class FakeSshShell extends EventEmitter implements EnvironmentCustomImageSshShell {
  writes: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
  closeCalls = 0;
  write(data: string) {
    this.writes.push(data);
  }
  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows });
  }
  close() {
    this.closeCalls += 1;
  }
  onData(listener: (data: string) => void) {
    this.on("data", listener);
  }
  onClose(listener: () => void) {
    this.on("close", listener);
  }
  onError(listener: (err: Error) => void) {
    this.on("ssh-error", listener);
  }
}

const COMPANY = "company-1";
const USER = "user-1";
const MACHINE = "machine-1";
const PROJECT = "project-1";
const SSH_TARGET: CrewTerminalSshTarget = {
  host: "mac.tailnet", port: 2222, username: "crew", privateKey: "KEY", knownHosts: null, strictHostKeyChecking: false,
};

/** Phiên đã bị thu hồi (đăng xuất, đổi mật khẩu): cookie của nó không còn ra phiên nữa. */
const revokedSessions = new Set<string>();

/** Cookie `sid=<id>` ứng với phiên `<id>` của USER. */
async function sessionFromCookie(headers: Headers): Promise<BetterAuthSessionResult | null> {
  const sid = /sid=([^;]+)/.exec(headers.get("cookie") ?? "")?.[1];
  return sid && !revokedSessions.has(sid) ? { session: { id: sid, userId: USER }, user: { id: USER } } : null;
}

async function listen(server: HttpServer) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

function waitForOpen(ws: Client) {
  return new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
}

function waitForClose(ws: Client) {
  return new Promise<number>((resolve) => ws.on("close", resolve));
}

function waitForFrame(ws: Client, type: string) {
  return new Promise<Record<string, unknown>>((resolve) => {
    ws.on("message", (data) => {
      const frame = JSON.parse(typeof data === "string" ? data : data.toString("utf8")) as Record<string, unknown>;
      if (frame.type === type) resolve(frame);
    });
  });
}

/** Lỗi nâng cấp của client `ws` có dạng "Unexpected server response: 401". */
function waitForRejection(ws: Client) {
  return new Promise<number>((resolve, reject) => {
    ws.on("open", () => reject(new Error("upgrade should have been rejected")));
    ws.on("error", (err) => resolve(Number(/(\d{3})/.exec(err.message)?.[1] ?? 0)));
  });
}

async function waitFor(assertion: () => void) {
  let last: unknown;
  for (let i = 0; i < 40; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      assertion();
      return;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

describe("crew terminal websocket", () => {
  let servers: HttpServer[];
  let closers: Array<() => Promise<void>>;
  let ticketStore: TerminalTicketStore;
  let unlockStore: TerminalUnlockStore;
  let shell: FakeSshShell;
  let connector: CrewTerminalSshConnector & { open: ReturnType<typeof vi.fn> };
  let resolveSshTarget: ReturnType<typeof vi.fn>;
  let membershipRole: string | null;
  let db: { execute: ReturnType<typeof vi.fn> };
  let nowMs: number;

  beforeEach(() => {
    vi.clearAllMocks();
    servers = [];
    closers = [];
    revokedSessions.clear();
    nowMs = Date.now();
    ticketStore = createTerminalTicketStore();
    unlockStore = createTerminalUnlockStore({ now: () => nowMs });
    unlockStore.unlock("sess-A");
    unlockStore.unlock("sess-B");
    shell = new FakeSshShell();
    connector = { open: vi.fn(async () => shell) };
    resolveSshTarget = vi.fn(async () => SSH_TARGET);
    membershipRole = "owner";
    db = { execute: vi.fn(async () => (membershipRole ? [{ membership_role: membershipRole }] : [])) };
    resolveTerminalTargetMock.mockResolvedValue({
      machineId: MACHINE, hostname: "mac-mini", projectId: PROJECT, projectName: "Paperclip", projectKey: "paperclip", branch: "main",
    });
  });

  afterEach(async () => {
    await Promise.all(closers.map((close) => close()));
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    })));
  });

  async function startHarness(extra?: (server: HttpServer) => void, pingIntervalMs?: number) {
    const server = createServer();
    servers.push(server);
    const handle = setupCrewTerminalWebSocketServer(server, db as never, {
      resolveSessionFromHeaders: sessionFromCookie,
      ticketStore,
      unlockStore,
      connector,
      resolveSshTarget: resolveSshTarget as never,
      pingIntervalMs,
    });
    closers.push(() => handle.close());
    extra?.(server);
    return listen(server);
  }

  function issue(sessionId = "sess-A") {
    return ticketStore.issue({ companyId: COMPANY, userId: USER, sessionId, machineId: MACHINE, projectId: PROJECT }).ticket;
  }

  function connect(port: number, ticket: string, cookieSession = "sess-A", query = "&cols=120&rows=40") {
    return new WebSocket(
      `ws://127.0.0.1:${port}/api/crew/companies/${COMPANY}/terminal/ws?ticket=${encodeURIComponent(ticket)}${query}`,
      { headers: { cookie: `sid=${cookieSession}` } },
    );
  }

  it("mở shell bằng vé hợp lệ rồi chuyển input, output, resize", async () => {
    const port = await startHarness();
    const ws = connect(port, issue());
    const ready = waitForFrame(ws, "ready");
    await waitForOpen(ws);
    await ready;

    expect(connector.open).toHaveBeenCalledTimes(1);
    const input = connector.open.mock.calls[0]?.[0] as { target: unknown; command: string; cols: number; rows: number };
    expect(input.target).toEqual(SSH_TARGET);
    expect(input.command).toContain("crew-owner-paperclip");
    expect(input).toMatchObject({ cols: 120, rows: 40 });
    expect(resolveSshTarget).toHaveBeenCalledWith(db, COMPANY, MACHINE);

    ws.send(JSON.stringify({ type: "input", data: "ls\r" }));
    await waitFor(() => expect(shell.writes).toEqual(["ls\r"]));

    const output = waitForFrame(ws, "output");
    shell.emit("data", "hello");
    await expect(output).resolves.toEqual({ type: "output", data: "hello" });

    ws.send(JSON.stringify({ type: "resize", cols: 90, rows: 30 }));
    await waitFor(() => expect(shell.resizes).toEqual([{ cols: 90, rows: 30 }]));
    ws.send(JSON.stringify({ type: "resize", cols: 9000, rows: 30 }));

    const closed = waitForClose(ws);
    ws.close();
    await closed;
    await waitFor(() => expect(shell.closeCalls).toBe(1));
    expect(shell.resizes).toHaveLength(1);

    const events = loggerMock.info.mock.calls.map((call) => call[0] as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({ event: "crew_terminal_open", userId: USER, machineId: MACHINE, projectId: PROJECT }));
    expect(events).toContainEqual(expect.objectContaining({ event: "crew_terminal_close", userId: USER, reason: "client_closed" }));
    expect(JSON.stringify(loggerMock.info.mock.calls)).not.toContain("hello");
  });

  it("dùng kích thước mặc định 80×24 khi cols/rows ngoài khoảng", async () => {
    const port = await startHarness();
    const ws = connect(port, issue(), "sess-A", "&cols=1&rows=999");
    const ready = waitForFrame(ws, "ready");
    await ready;
    expect(connector.open.mock.calls[0]?.[0]).toMatchObject({ cols: 80, rows: 24 });
    ws.close();
  });

  it("shell đóng thì client nhận closed và đóng 1000", async () => {
    const port = await startHarness();
    const ws = connect(port, issue());
    await waitForFrame(ws, "ready");
    const closedFrame = waitForFrame(ws, "closed");
    const closeCode = waitForClose(ws);
    shell.emit("close");
    await expect(closedFrame).resolves.toMatchObject({ type: "closed" });
    await expect(closeCode).resolves.toBe(1000);
  });

  it("lỗi SSH thì gửi error và đóng 1011", async () => {
    const port = await startHarness();
    const ws = connect(port, issue());
    await waitForFrame(ws, "ready");
    const errorFrame = waitForFrame(ws, "error");
    const closeCode = waitForClose(ws);
    shell.emit("ssh-error", new Error("boom"));
    await errorFrame;
    await expect(closeCode).resolves.toBe(1011);
  });

  it("không mở được SSH thì gửi error và đóng 1011", async () => {
    connector.open.mockRejectedValueOnce(new Error("refused"));
    const port = await startHarness();
    const ws = connect(port, issue());
    const errorFrame = waitForFrame(ws, "error");
    const closeCode = waitForClose(ws);
    await errorFrame;
    await expect(closeCode).resolves.toBe(1011);
  });

  it("dùng lại vé thì 401", async () => {
    const port = await startHarness();
    const ticket = issue();
    const first = connect(port, ticket);
    await waitForFrame(first, "ready");
    await expect(waitForRejection(connect(port, ticket))).resolves.toBe(401);
    first.close();
  });

  it("thiếu phiên hoặc thiếu vé thì 401", async () => {
    const port = await startHarness();
    const noCookie = new WebSocket(`ws://127.0.0.1:${port}/api/crew/companies/${COMPANY}/terminal/ws?ticket=${issue()}`);
    await expect(waitForRejection(noCookie)).resolves.toBe(401);
    const noTicket = new WebSocket(`ws://127.0.0.1:${port}/api/crew/companies/${COMPANY}/terminal/ws`, {
      headers: { cookie: "sid=sess-A" },
    });
    await expect(waitForRejection(noTicket)).resolves.toBe(401);
    expect(connector.open).not.toHaveBeenCalled();
  });

  it("vé của phiên A dùng với cookie phiên B thì 403", async () => {
    const port = await startHarness();
    await expect(waitForRejection(connect(port, issue("sess-A"), "sess-B"))).resolves.toBe(403);
    expect(connector.open).not.toHaveBeenCalled();
  });

  it("vé cấp cho company khác thì 403", async () => {
    const port = await startHarness();
    const ticket = ticketStore.issue({ companyId: "company-2", userId: USER, sessionId: "sess-A", machineId: MACHINE, projectId: PROJECT }).ticket;
    await expect(waitForRejection(connect(port, ticket))).resolves.toBe(403);
  });

  it("người dùng không còn là owner thì 403", async () => {
    membershipRole = "member";
    const port = await startHarness();
    await expect(waitForRejection(connect(port, issue()))).resolves.toBe(403);
    expect(connector.open).not.toHaveBeenCalled();
  });

  it("phiên hết mở khoá thì 403", async () => {
    const port = await startHarness();
    const ticket = issue("sess-C");
    const ws = connect(port, ticket, "sess-C");
    await expect(waitForRejection(ws)).resolves.toBe(403);
    expect(connector.open).not.toHaveBeenCalled();
  });

  it("project không còn ready hoặc máy thiếu SSH thì 403", async () => {
    const port = await startHarness();
    resolveTerminalTargetMock.mockResolvedValueOnce(null);
    await expect(waitForRejection(connect(port, issue()))).resolves.toBe(403);
    resolveSshTarget.mockResolvedValueOnce(null);
    await expect(waitForRejection(connect(port, issue()))).resolves.toBe(403);
    expect(connector.open).not.toHaveBeenCalled();
  });

  it("ping không có pong qua một chu kỳ thì terminate", async () => {
    const server = createServer();
    servers.push(server);
    const handle = setupCrewTerminalWebSocketServer(server, db as never, {
      resolveSessionFromHeaders: sessionFromCookie,
      ticketStore, unlockStore, connector, resolveSshTarget: resolveSshTarget as never, pingIntervalMs: 30,
    });
    closers.push(() => handle.close());
    const port = await listen(server);
    // Tắt pong tự động của client để mô phỏng kết nối chết.
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/crew/companies/${COMPANY}/terminal/ws?ticket=${issue()}`,
      { headers: { cookie: "sid=sess-A" }, autoPong: false },
    );
    await waitForFrame(ws, "ready");
    const closed = waitForClose(ws);
    await closed;
    await waitFor(() => expect(shell.closeCalls).toBe(1));
  });

  describe("mất quyền khi terminal đang mở thì đóng 1008", () => {
    async function openThenRevoke(revoke: () => void) {
      const port = await startHarness(undefined, 30);
      const ws = connect(port, issue());
      await waitForFrame(ws, "ready");
      const errorFrame = waitForFrame(ws, "error");
      const closeCode = waitForClose(ws);
      revoke();
      await errorFrame;
      await expect(closeCode).resolves.toBe(1008);
      await waitFor(() => expect(shell.closeCalls).toBe(1));
      return loggerMock.info.mock.calls.map((call) => call[0] as Record<string, unknown>);
    }

    it("phiên đăng nhập bị thu hồi", async () => {
      const events = await openThenRevoke(() => revokedSessions.add("sess-A"));
      expect(events).toContainEqual(expect.objectContaining({ event: "crew_terminal_close", reason: "session_revoked" }));
    });

    it("không còn là owner", async () => {
      const events = await openThenRevoke(() => {
        membershipRole = "member";
      });
      expect(events).toContainEqual(expect.objectContaining({ event: "crew_terminal_close", reason: "not_owner" }));
    });

    it("hết hạn mở khoá", async () => {
      const events = await openThenRevoke(() => {
        nowMs += 13 * 60 * 60_000;
      });
      expect(events).toContainEqual(expect.objectContaining({ event: "crew_terminal_close", reason: "unlock_expired" }));
    });

    it("còn đủ quyền thì vẫn mở qua nhiều chu kỳ ping", async () => {
      const port = await startHarness(undefined, 30);
      const ws = connect(port, issue());
      await waitForFrame(ws, "ready");
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(ws.readyState).toBe(1);
      expect(shell.closeCalls).toBe(0);
      ws.close();
    });
  });

  it("không đụng tới upgrade của path khác", () => {
    const server = new EventEmitter();
    setupCrewTerminalWebSocketServer(server as never, db as never, { resolveSessionFromHeaders: sessionFromCookie });
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn(), destroyed: false });
    const req = { url: "/api/companies/company-1/events/ws", headers: {} } as IncomingMessage & { paperclipWebSocketHandled?: boolean };
    server.emit("upgrade", req, socket as unknown as Duplex, Buffer.alloc(0));
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(socket.end).not.toHaveBeenCalled();
    expect(req.paperclipWebSocketHandled).toBeUndefined();
  });

  it("chạy chung server với live-events và terminal custom image", async () => {
    const port = await startHarness((server) => {
      setupEnvironmentCustomImageTerminalWebSocketServer(server, {} as never, { customImageService: {} as never, sshConnector: {} as never });
      setupLiveEventsWebSocketServer(server, {} as never, { deploymentMode: "local_trusted" });
    });

    const live = new WebSocket(`ws://127.0.0.1:${port}/api/companies/${COMPANY}/events/ws`);
    await waitForOpen(live);
    const customImage = new WebSocket(
      `ws://127.0.0.1:${port}/api/environment-custom-image-setup-sessions/s-1/terminal/ws?terminalSessionId=t-1`,
    );
    await waitForOpen(customImage);
    const terminal = connect(port, issue());
    await waitForFrame(terminal, "ready");

    live.close();
    customImage.close();
    terminal.close();
  });
});
