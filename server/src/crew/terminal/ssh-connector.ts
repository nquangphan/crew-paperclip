// @ts-ignore ssh2 không đi kèm kiểu; chỉ dùng phần khai báo bên dưới.
import { Client as Ssh2Client } from "ssh2";
import { StringDecoder } from "node:string_decoder";
import { eq } from "drizzle-orm";
import { environments, type Db } from "@paperclipai/db";
import type { EnvironmentCustomImageSshShell } from "../../realtime/environment-custom-image-terminal-ws.js";
import { resolveEnvironmentDriverConfigForRuntime } from "../../services/environment-config.js";
import { pairedMachine } from "../machine-pin.js";

export type CrewTerminalSshTarget = {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  knownHosts: string | null;
  strictHostKeyChecking: boolean;
};

export interface CrewTerminalSshConnector {
  open(input: { target: CrewTerminalSshTarget; command: string; cols: number; rows: number }): Promise<EnvironmentCustomImageSshShell>;
}

/** Thông tin SSH của máy đã ghép, lấy từ environment mẫu `may-<máy>` (host, cổng, user, khoá riêng). */
export async function resolveMachineSshTarget(db: Db, companyId: string, machineId: string): Promise<CrewTerminalSshTarget | null> {
  const machine = await pairedMachine(db, companyId, machineId);
  if (!machine) return null;
  const [environment] = await db.select().from(environments).where(eq(environments.id, machine.templateEnvironmentId)).limit(1);
  if (!environment) return null;
  const resolved = await resolveEnvironmentDriverConfigForRuntime(db, companyId, {
    id: environment.id,
    driver: environment.driver as "ssh",
    config: environment.config,
  });
  if (resolved.driver !== "ssh" || !resolved.config.privateKey) return null;
  const { host, port, username, privateKey, knownHosts, strictHostKeyChecking } = resolved.config;
  return { host, port, username, privateKey, knownHosts, strictHostKeyChecking };
}

/**
 * Khoá máy có được known_hosts tin không. So theo khoá, không theo tên máy.
 * Dòng `@revoked` khớp khoá thì loại; dòng `@cert-authority` là khoá CA nên bỏ qua; dòng thường khớp thì nhận.
 */
function knownHostsTrustKey(knownHosts: string | null, presented: Buffer): boolean {
  if (!knownHosts) return false;
  let trusted = false;
  for (const raw of knownHosts.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/\s+/);
    const marker = fields[0]?.startsWith("@") ? fields.shift() : null;
    if (marker === "@cert-authority") continue;
    const blob = fields[2];
    if (!blob || !Buffer.from(blob, "base64").equals(presented)) continue;
    if (marker === "@revoked") return false;
    if (!marker) trusted = true;
  }
  return trusted;
}

interface ClientChannel {
  write(data: string): void;
  end(): void;
  destroy(): void;
  setWindow(rows: number, cols: number, height: number, width: number): void;
  on(event: "data", listener: (data: Buffer | string) => void): void;
  on(event: "exit" | "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

interface Client {
  once(event: "ready", listener: () => void): void;
  once(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  connect(config: Record<string, unknown>): void;
  exec(
    command: string,
    options: { pty: { term: string; cols: number; rows: number } },
    callback: (err: Error | undefined, stream: ClientChannel | undefined) => void,
  ): void;
  end(): void;
  destroy(): void;
}

const Client = Ssh2Client as new () => Client;

class Ssh2PtyShell implements EnvironmentCustomImageSshShell {
  private closed = false;
  private readonly closeListeners: Array<() => void> = [];

  constructor(private readonly client: Client, private readonly stream: ClientChannel) {
    const emitClose = () => {
      if (this.closed) return;
      this.closed = true;
      for (const listener of this.closeListeners) listener();
    };
    stream.on("exit", emitClose);
    stream.on("close", emitClose);
    client.on("close", emitClose);
  }

  write(data: string): void {
    this.stream.write(data);
  }

  resize(cols: number, rows: number): void {
    this.stream.setWindow(rows, cols, 0, 0);
  }

  close(): void {
    try {
      this.stream.end();
    } catch {
      this.stream.destroy();
    }
    try {
      this.client.end();
    } catch {
      this.client.destroy();
    }
  }

  onData(listener: (data: string) => void): void {
    // Giải mã liên tục: ký tự UTF-8 nhiều byte có thể bị cắt giữa hai gói SSH, giải từng gói riêng sẽ ra `�`.
    const decoder = new StringDecoder("utf8");
    this.stream.on("data", (data: Buffer | string) => {
      const text = typeof data === "string" ? data : decoder.write(data);
      if (text) listener(text);
    });
  }

  onClose(listener: () => void): void {
    if (this.closed) listener();
    else this.closeListeners.push(listener);
  }

  onError(listener: (err: Error) => void): void {
    this.stream.on("error", listener);
    this.client.on("error", listener);
  }
}

export function createSsh2CrewTerminalConnector(): CrewTerminalSshConnector {
  return {
    open: ({ target, command, cols, rows }) =>
      new Promise<EnvironmentCustomImageSshShell>((resolve, reject) => {
        const client = new Client();
        let settled = false;
        let hostKeyRejected = false;
        const fail = (cause: Error) => {
          if (settled) return;
          settled = true;
          const err = hostKeyRejected ? new Error("Khoá máy không khớp known_hosts, đã từ chối kết nối.") : cause;
          try {
            client.end();
          } catch {
            client.destroy();
          }
          reject(err);
        };

        client.once("ready", () => {
          client.exec(command, { pty: { term: "xterm-256color", cols, rows } }, (err, stream) => {
            if (err || !stream) {
              fail(err ?? new Error("Không mở được kênh SSH."));
              return;
            }
            if (settled) return;
            settled = true;
            resolve(new Ssh2PtyShell(client, stream));
          });
        });
        // Giữ listener lỗi suốt đời client để lỗi muộn không thành sự kiện 'error' không ai bắt.
        client.on("error", fail);
        client.on("close", () => fail(new Error("Kết nối SSH đóng trước khi sẵn sàng.")));

        client.connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey: target.privateKey,
          readyTimeout: 20000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          ...(target.strictHostKeyChecking
            ? {
                hostVerifier: (key: Buffer) => {
                  const ok = knownHostsTrustKey(target.knownHosts, key);
                  hostKeyRejected = !ok;
                  return ok;
                },
              }
            : {}),
        });
      }),
  };
}
