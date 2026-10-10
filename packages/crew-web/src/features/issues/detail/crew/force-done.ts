// Ép Done của owner: đóng yêu cầu bỏ qua cổng, có lý do. Không dùng PATCH stock (board gửi `done` thành Duyệt khi là
// người duyệt stage đang chờ, hoặc mở workflow khi chưa vào stage), mà gọi route board của plugin crew.core. Trước
// route, web hủy việc con chưa xong (nếu owner chọn) và run đang chạy của chính yêu cầu: `done` không tự hủy run.
import type { ForceDoneResult } from '@/api';

export const MIN_FORCE_REASON = 10;
export const MAX_FORCE_REASON = 1000;

const CLOSED = new Set(['done', 'cancelled']);
const ACTIVE_RUN = new Set(['running', 'queued']);
// Ký tự điều khiển C0/C1 trừ tab và xuống dòng: route từ chối (reason_invalid).
// biome-ignore lint/suspicious/noControlCharactersInRegex: đúng là cần bắt ký tự điều khiển
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

interface Principal {
  type?: string | null;
  agentId?: string | null;
  userId?: string | null;
}

interface ForceDoneIssue {
  status: string;
  executionPolicy?: { stages: { id: string; type: string }[] } | null;
  executionState?: {
    status?: string | null;
    currentStageId?: string | null;
    currentParticipant?: Principal | null;
    completedStageIds?: string[] | null;
  } | null;
}

export interface SkippedGate {
  stageId: string;
  type: string;
  /** Vị trí trong policy (0 là stage đầu). */
  index: number;
  /** Stage đang chờ người duyệt. */
  current: boolean;
  /** Người đang giữ stage đang chờ. */
  holder: { type: 'agent'; agentId: string } | { type: 'user'; userId: string } | null;
}

/** Nút Ép Done chỉ có khi yêu cầu chưa đóng; đã đóng thì phải Mở lại trước. */
export function forceDoneAvailable(issue: { status: string }): boolean {
  return !CLOSED.has(issue.status);
}

/** Stage theo policy chưa có trong `completedStageIds` của vòng hiện tại: các cổng mà Ép Done sẽ bỏ qua. */
export function skippedGates(issue: ForceDoneIssue): SkippedGate[] {
  const state = issue.executionState ?? null;
  const done = new Set(state?.completedStageIds ?? []);
  const pendingId = state?.status === 'pending' ? (state.currentStageId ?? null) : null;
  return (issue.executionPolicy?.stages ?? []).flatMap((stage, index) => {
    if (done.has(stage.id)) return [];
    const current = stage.id === pendingId;
    const p = current ? state?.currentParticipant : null;
    const holder =
      p?.type === 'agent' && p.agentId
        ? { type: 'agent' as const, agentId: p.agentId }
        : p?.type === 'user' && p.userId
          ? { type: 'user' as const, userId: p.userId }
          : null;
    return [{ stageId: stage.id, type: stage.type, index, current, holder }];
  });
}

/** Lý do sau khi bỏ khoảng trắng hai đầu: 10–1000 ký tự, không có ký tự điều khiển (như route kiểm). */
export function validReason(reason: string): boolean {
  const text = reason.trim();
  return text.length >= MIN_FORCE_REASON && text.length <= MAX_FORCE_REASON && !CONTROL.test(text);
}

/** Việc con chưa xong (chưa done/cancelled). */
export function openChildren<T extends { status: string }>(children: T[]): T[] {
  return children.filter((c) => !CLOSED.has(c.status));
}

export interface ForceDoneDeps {
  /** Đọc lại yêu cầu ngay trước khi làm (không dùng bản đang hiện trên trang). */
  getIssue: () => Promise<{ status: string }>;
  /** Danh sách con mới nhất. */
  listChildren: () => Promise<{ id: string; status: string }[]>;
  /** PATCH stock `{status:'cancelled'}` (board hủy thì run của con dừng theo). */
  cancelChild: (childId: string) => Promise<unknown>;
  /** Run của chính yêu cầu (live-runs). */
  listActiveRuns: () => Promise<{ id: string; status: string }[]>;
  cancelRun: (runId: string) => Promise<unknown>;
  /** Route Ép Done của plugin. */
  forceDone: (reason: string) => Promise<ForceDoneResult>;
}

export type ForceDoneOutcome = { kind: 'stale'; status: string } | { kind: 'done'; result: ForceDoneResult };

/**
 * Chạy Ép Done theo thứ tự: đọc lại yêu cầu → hủy con chưa xong (nếu chọn) → hủy run đang chạy → route. Dừng ở lỗi
 * đầu tiên (ném lại nguyên lỗi). Bấm lại thì chạy lại từ đầu an toàn: con đã hủy và run đã dừng không còn trong danh
 * sách. Yêu cầu đã đóng khi đọc lại thì không làm gì (`stale`).
 */
export async function runForceDone(
  deps: ForceDoneDeps,
  input: { reason: string; cancelChildren: boolean },
): Promise<ForceDoneOutcome> {
  if (!validReason(input.reason)) throw new Error('reason_invalid');
  const reason = input.reason.trim();
  const fresh = await deps.getIssue();
  if (CLOSED.has(fresh.status)) return { kind: 'stale', status: fresh.status };
  if (input.cancelChildren) {
    for (const child of openChildren(await deps.listChildren())) await deps.cancelChild(child.id);
  }
  for (const run of await deps.listActiveRuns()) {
    if (ACTIVE_RUN.has(run.status)) await deps.cancelRun(run.id);
  }
  return { kind: 'done', result: await deps.forceDone(reason) };
}
