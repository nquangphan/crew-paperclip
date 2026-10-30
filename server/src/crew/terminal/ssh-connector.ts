// @ts-ignore ssh2 không đi kèm kiểu; chỉ dùng phần khai báo bên dưới.
import { Client as Ssh2Client } from "ssh2";
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

/** Khoá máy có nằm trong một dòng `host keytype base64` nào của known_hosts không. So theo khoá, không theo tên máy. */
function knownHostsTrustKey(knownHosts: string, presented: Buffer): boolean {
  for (const raw of knownHosts.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/\s+/);
    if (fields[0]?.startsWith("@")) fields.shift();
    const blob = fields[2];
    if (blob && Buffer.from(blob, "base64").equals(presented)) return true;
  }
  return false;
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
  constructor(private readonly client: Client, private readonly stream: ClientChannel) {}

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
    this.stream.on("data", (data: Buffer | string) => listener(typeof data === "string" ? data : data.toString("utf8")));
  }

  onClose(listener: () => void): void {
    this.stream.on("exit", listener);
    this.stream.on("close", listener);
    this.client.on("close", listener);
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
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
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
        client.once("error", fail);

        const verify = target.strictHostKeyChecking && target.knownHosts !== null;
        client.connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey: target.privateKey,
          readyTimeout: 20000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          ...(verify
            ? { hostVerifier: (key: Buffer) => knownHostsTrustKey(target.knownHosts as string, key) }
            : {}),
        });
      }),
  };
}
