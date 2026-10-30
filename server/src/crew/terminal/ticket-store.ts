import { createHash, randomBytes } from "node:crypto";

/** Vé WebSocket sống 60 giây và chỉ dùng được một lần. */
const TICKET_TTL_MS = 60_000;

export type TerminalTicketClaims = {
  companyId: string;
  userId: string;
  sessionId: string;
  machineId: string;
  projectId: string;
};

export interface TerminalTicketStore {
  issue(claims: TerminalTicketClaims): { ticket: string; expiresAt: Date };
  consume(ticket: string): TerminalTicketClaims | null;
}

const digest = (ticket: string) => createHash("sha256").update(ticket).digest("hex");

/** Kho vé trong bộ nhớ; chỉ lưu sha256 của vé nên đọc kho không lấy lại được vé. */
export function createTerminalTicketStore(opts: { ttlMs?: number; now?: () => number } = {}): TerminalTicketStore {
  const ttlMs = opts.ttlMs ?? TICKET_TTL_MS;
  const now = opts.now ?? Date.now;
  const tickets = new Map<string, { claims: TerminalTicketClaims; expiresAt: number }>();

  return {
    issue(claims) {
      const t = now();
      for (const [key, entry] of tickets) if (entry.expiresAt < t) tickets.delete(key);
      const ticket = randomBytes(32).toString("base64url");
      const expiresAt = t + ttlMs;
      tickets.set(digest(ticket), { claims: { ...claims }, expiresAt });
      return { ticket, expiresAt: new Date(expiresAt) };
    },
    consume(ticket) {
      const key = digest(ticket);
      const entry = tickets.get(key);
      if (!entry) return null;
      tickets.delete(key);
      return entry.expiresAt < now() ? null : entry.claims;
    },
  };
}

export const crewTerminalTicketStore = createTerminalTicketStore();
