// Ghi AGENTS.md có kiểm xung đột: GET lấy contentHash làm baseHash rồi PUT. Server trả 409 khi hash đã cũ (có người
// vừa sửa) thì báo xung đột, không ghi đè, không thử lại.

export const INSTRUCTIONS_PATH = 'AGENTS.md';

/** Phần của `api` (src/api, nhóm agents) mà putInstructions cần. */
export interface InstructionsApi {
  agents: {
    instructionsFile(id: string, path?: string, companyId?: string): Promise<{ content: string; contentHash?: string }>;
    saveInstructionsFile(
      id: string,
      body: { path: string; content: string; baseHash?: string | null },
      companyId?: string,
    ): Promise<{ contentHash?: string }>;
  };
}

export type PutInstructionsResult = { ok: true; hash: string; changed: boolean } | { ok: false; conflict: true };

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : undefined;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `companyId`: company của setup run hay trang đang mở; luôn truyền khi gọi từ wizard. */
export async function putInstructions(
  api: InstructionsApi,
  agentId: string,
  content: string,
  opts: { companyId?: string } = {},
): Promise<PutInstructionsResult> {
  let baseHash: string | null = null;
  try {
    const current = await api.agents.instructionsFile(agentId, INSTRUCTIONS_PATH, opts.companyId);
    baseHash = current.contentHash ?? (await sha256Hex(current.content));
    if (current.content === content) return { ok: true, hash: baseHash, changed: false };
  } catch (error) {
    // Chỉ 404 (chưa có file) mới ghi với baseHash null; lỗi khác ném nguyên, không đoán.
    if (statusOf(error) !== 404) throw error;
  }
  try {
    const saved = await api.agents.saveInstructionsFile(
      agentId,
      { path: INSTRUCTIONS_PATH, content, baseHash },
      opts.companyId,
    );
    return { ok: true, hash: saved.contentHash ?? (await sha256Hex(content)), changed: true };
  } catch (error) {
    if (statusOf(error) === 409) return { ok: false, conflict: true };
    throw error;
  }
}
