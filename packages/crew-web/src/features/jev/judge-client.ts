// Gọi các route chấm của Jev từ form của owner. Quy tắc chung: không bao giờ ném lỗi và không chờ quá hạn; mọi lỗi
// (mạng, 4xx/5xx, `{ok:false}`, sai dạng, quá hạn) cùng trả `null`, nghĩa là form chạy y như khi chưa có Jev.

import type { ApprovalNoteVerdict, JudgeAction, RequestTypeLabel, RequestTypeVerdict } from '@/api';
import { api } from '@/api';
import { parseApprovalNote, parseRequestType } from './judge-adapter';

/** Trần chờ Jev khi owner bấm Duyệt / Yêu cầu sửa. */
export const APPROVAL_JUDGE_TIMEOUT_MS = 1500;
/** Trần chờ cho gợi ý loại yêu cầu (không chặn thao tác nào, nên rộng hơn một chút). */
export const REQUEST_TYPE_TIMEOUT_MS = 4000;

/**
 * Chạy `run` với hạn cứng `ms`: quá hạn thì hủy request (AbortController) và trả `null` ngay cả khi `run` bỏ qua tín hiệu
 * hủy. Lỗi bất kỳ cũng là `null`.
 */
export async function withHardTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  /** Hủy từ bên ngoài (ví dụ chữ đã đổi): hủy request và trả `null` ngay. */
  outer?: AbortSignal,
): Promise<T | null> {
  const controller = new AbortController();
  if (outer?.aborted) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, ms);
    outer?.addEventListener(
      'abort',
      () => {
        controller.abort();
        resolve(null);
      },
      { once: true },
    );
  });
  try {
    return await Promise.race([run(controller.signal).catch(() => null), expired]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function judgeApprovalNote(
  companyId: string,
  body: { issueId: string; action: JudgeAction; note: string },
  timeoutMs: number = APPROVAL_JUDGE_TIMEOUT_MS,
): Promise<ApprovalNoteVerdict | null> {
  return withHardTimeout(
    async (signal) => parseApprovalNote(await api.jev.judgeApprovalNote(companyId, body, signal)),
    timeoutMs,
  );
}

export function judgeRequestType(
  companyId: string,
  body: { title: string; description: string; current?: RequestTypeLabel },
  outer?: AbortSignal,
): Promise<RequestTypeVerdict | null> {
  return withHardTimeout(
    async (signal) => parseRequestType(await api.jev.judgeRequestType(companyId, body, signal)),
    REQUEST_TYPE_TIMEOUT_MS,
    outer,
  );
}

/** Ghi kết cục owner chọn cho một phán đoán. Bắn rồi quên: lỗi không ảnh hưởng gì. */
export function recordOutcome(companyId: string, judgmentId: string | null, outcome: string): void {
  if (!judgmentId) return;
  void api.jev.judgmentOutcome(companyId, judgmentId, outcome).catch(() => undefined);
}
