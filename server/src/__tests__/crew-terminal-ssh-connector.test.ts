import type { EventEmitter } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, seedCrewProject, seedPairing, seedTemplate } from "./helpers/crew-machine-tables.js";

const ssh2 = vi.hoisted(() => ({
  state: { client: null as unknown, stream: null as unknown, execArgs: [] as unknown[], closeBeforeReady: false, config: {} as Record<string, unknown> },
}));

const FAKE_KEY = "throwaway-test-key-material";

vi.mock("../services/secrets.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/secrets.ts")>()),
  secretService: () => ({ resolveSecretValue: async () => FAKE_KEY }),
}));

vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");
  class Client extends EventEmitter {
    stream = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), setWindow: vi.fn() });
    end = vi.fn();
    constructor() {
      super();
      ssh2.state.client = this;
      ssh2.state.stream = this.stream;
    }
    connect(config: Record<string, unknown>) {
      ssh2.state.config = config;
      const verifier = config.hostVerifier as ((key: Buffer) => boolean) | undefined;
      const trusted = verifier ? verifier(Buffer.from("presented-host-key")) : true;
      if (ssh2.state.closeBeforeReady) {
        queueMicrotask(() => this.emit("close"));
        return;
      }
      queueMicrotask(() => (trusted ? this.emit("ready") : this.emit("error", new Error("host key rejected"))));
    }
    exec(command: string, options: unknown, callback: (err: Error | undefined, stream: unknown) => void) {
      ssh2.state.execArgs = [command, options];
      callback(undefined, this.stream);
    }
  }
  return { Client, default: { Client } };
});

import { createSsh2CrewTerminalConnector, resolveMachineSshTarget, type CrewTerminalSshTarget } from "../crew/terminal/ssh-connector.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

suite("resolveMachineSshTarget (Postgres)", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let companyId: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-terminal-ssh-connector-");
    db = createDb(temporary.connectionString);
    const ns = await applyCrewMachineTables(db);
    const w = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    companyId = w.companyId;
    await seedPairing(db, ns, companyId, BOOK, await seedTemplate(db, BOOK));
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  it("máy đã ghép: trả host, cổng, user và khóa riêng", async () => {
    const target = await resolveMachineSshTarget(db, companyId, BOOK.machineId);
    expect(target).toMatchObject({ host: BOOK.ip, port: 2222, username: "owner", strictHostKeyChecking: true });
    expect(target?.privateKey).toBe(FAKE_KEY);
    expect(target?.knownHosts).toContain(BOOK.ip);
  });

  it("máy lạ thì trả null", async () => {
    expect(await resolveMachineSshTarget(db, companyId, MINI.machineId)).toBeNull();
  });
});

describe("createSsh2CrewTerminalConnector", () => {
  const hostKey = Buffer.from("presented-host-key");
  const target = (knownHosts: string | null, strict = true): CrewTerminalSshTarget => ({
    host: "100.64.0.3", port: 2222, username: "owner", privateKey: FAKE_KEY, knownHosts, strictHostKeyChecking: strict,
  });
  const line = (key: Buffer) => `[100.64.0.3]:2222 ssh-ed25519 ${key.toString("base64")}`;
  const open = (t: CrewTerminalSshTarget) =>
    createSsh2CrewTerminalConnector().open({ target: t, command: "tmux attach", cols: 100, rows: 30 });

  beforeEach(() => {
    ssh2.state.execArgs = [];
  });

  it("mở PTY với đúng lệnh, kích thước và tham số kết nối", async () => {
    const shell = await open(target(line(hostKey)));
    expect(ssh2.state.execArgs).toEqual(["tmux attach", { pty: { term: "xterm-256color", cols: 100, rows: 30 } }]);
    expect(ssh2.state.config).toMatchObject({
      host: "100.64.0.3", port: 2222, username: "owner", privateKey: FAKE_KEY,
      readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
    });
    shell.resize(120, 40);
    expect((ssh2.state.stream as { setWindow: ReturnType<typeof vi.fn> }).setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
  });

  it("chuyển dữ liệu ra, phát onClose khi stream đóng và close đóng cả client", async () => {
    const shell = await open(target(line(hostKey)));
    const data: string[] = [];
    const onClose = vi.fn();
    shell.onData((d) => data.push(d));
    shell.onClose(onClose);
    (ssh2.state.stream as EventEmitter).emit("data", Buffer.from("xin chào"));
    (ssh2.state.stream as EventEmitter).emit("exit", 0);
    expect(data).toEqual(["xin chào"]);
    expect(onClose).toHaveBeenCalled();
    shell.close();
    expect((ssh2.state.client as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalled();
  });

  it("ký tự nhiều byte bị cắt giữa hai gói vẫn ra đúng chữ", async () => {
    const shell = await open(target(line(hostKey)));
    const data: string[] = [];
    shell.onData((d) => data.push(d));
    const bytes = Buffer.from("Dự án ─│", "utf8");
    // Cắt giữa "ự" (3 byte) và giữa "─" (3 byte).
    const cutVi = 2;
    const cutBox = bytes.indexOf(Buffer.from("─", "utf8")) + 1;
    const stream = ssh2.state.stream as EventEmitter;
    stream.emit("data", bytes.subarray(0, cutVi));
    stream.emit("data", bytes.subarray(cutVi, cutBox));
    stream.emit("data", bytes.subarray(cutBox));
    expect(data.join("")).toBe("Dự án ─│");
    expect(data.join("")).not.toContain("�");
  });

  it("knownHosts không khớp khoá của máy thì từ chối", async () => {
    await expect(open(target(line(Buffer.from("another-key"))))).rejects.toThrow();
  });

  it("knownHosts không có dòng nào thì từ chối khi bật kiểm chặt", async () => {
    await expect(open(target("# trống\n"))).rejects.toThrow();
  });

  it("kiểm chặt mà không có knownHosts thì từ chối", async () => {
    await expect(open(target(null))).rejects.toThrow(/known_hosts/);
  });

  it("không bật kiểm chặt thì nhận khoá", async () => {
    await expect(open(target(line(Buffer.from("another-key")), false))).resolves.toBeTruthy();
    await expect(open(target(null, false))).resolves.toBeTruthy();
  });

  it("dòng @revoked khớp khoá thì từ chối dù có dòng thường khớp", async () => {
    await expect(open(target(`${line(hostKey)}\n@revoked ${line(hostKey)}`))).rejects.toThrow();
  });

  it("dòng @cert-authority khớp khoá không được tính", async () => {
    await expect(open(target(`@cert-authority ${line(hostKey)}`))).rejects.toThrow();
  });

  it("khớp ở dòng không phải đầu tiên thì nhận", async () => {
    const hosts = `# ghi chú\n${line(Buffer.from("other"))}\n\n${line(hostKey)}\n`;
    await expect(open(target(hosts))).resolves.toBeTruthy();
  });

  it("đóng kết nối trước khi sẵn sàng thì reject", async () => {
    // client bị đóng ngay sau connect, trước ready
    ssh2.state.closeBeforeReady = true;
    await expect(open(target(null, false))).rejects.toThrow(/đóng/);
    ssh2.state.closeBeforeReady = false;
  });

  it("onClose chỉ phát đúng một lần", async () => {
    const shell = await open(target(line(hostKey)));
    const onClose = vi.fn();
    shell.onClose(onClose);
    (ssh2.state.stream as EventEmitter).emit("exit", 0);
    (ssh2.state.stream as EventEmitter).emit("close");
    (ssh2.state.client as EventEmitter).emit("close");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lỗi muộn của client không thành sự kiện không ai bắt", async () => {
    await open(target(line(hostKey)));
    expect(() => (ssh2.state.client as EventEmitter).emit("error", new Error("late"))).not.toThrow();
  });
});
