// Gợi ý loại yêu cầu từ tiêu đề + mô tả. Giữ số lần hỏi Jev ít để số đo không bị bản nháp nửa câu làm loãng và không ăn
// hạn mức chung của route judge: chờ chữ ổn định 800 ms, đủ 20 ký tự, chỉ hỏi lại khi chữ đổi đáng kể so với lần hỏi
// trước, và tối đa `SUGGEST_MAX_CALLS` lần mỗi lần mở form. Request cũ bị hủy khi chữ đổi. Chỉ chế độ `on` mới cho gợi
// ý; lỗi, quá hạn, shadow, off đều im lặng.
import { useEffect, useRef, useState } from 'react';
import type { RequestTypeLabel } from '@/api';
import { judgeRequestType, recordOutcome } from './judge-client';

export const SUGGEST_DEBOUNCE_MS = 800;
export const SUGGEST_MIN_CHARS = 20;
export const SUGGEST_MAX_CALLS = 3;
/** Chữ đổi ít nhất chừng này ký tự, hoặc chừng này phần trăm độ dài, mới đáng hỏi lại. */
export const SUGGEST_CHANGE_CHARS = 30;
export const SUGGEST_CHANGE_RATIO = 0.2;

/** Số ký tự khác nhau giữa hai đoạn chữ (phần giữa sau khi bỏ đầu và cuối giống nhau). */
export function changedChars(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let head = 0;
  while (head < max && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < max - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return Math.max(a.length, b.length) - head - tail;
}

/** Chữ đã đổi đáng kể chưa so với `base` (lần hỏi hay lần có kết quả trước). */
export function changedMeaningfully(base: string, next: string): boolean {
  const changed = changedChars(base, next);
  return changed >= SUGGEST_CHANGE_CHARS || changed / Math.max(base.length, next.length, 1) >= SUGGEST_CHANGE_RATIO;
}

export interface RequestTypeSuggestion {
  /** Loại Jev gợi ý khi chế độ `on` và gợi ý còn khớp chữ hiện tại; còn lại là null. */
  suggestion: RequestTypeLabel | null;
  /** Ghi loại owner đã gửi cho phán đoán mới nhất (chỉ khi không còn request nào đang chờ). Lỗi bị nuốt. */
  recordFinal: (kind: string) => void;
}

export function useRequestTypeSuggestion(
  companyId: string,
  title: string,
  description: string,
  /** Loại owner ĐÃ chọn (chưa đụng vào ô Loại thì để undefined); gửi kèm để server tính độ lệch. */
  picked?: RequestTypeLabel,
): RequestTypeSuggestion {
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const [verdict, setVerdict] = useState<{ label: RequestTypeLabel | null; forText: string } | null>(null);
  const [pending, setPending] = useState(false);
  const asked = useRef<string | null>(null);
  const calls = useRef(0);
  const judgmentId = useRef<string | null>(null);
  const text = `${title.trim()}\n${description.trim()}`;
  const long = title.trim().length + description.trim().length >= SUGGEST_MIN_CHARS;

  const inflight = useRef<AbortController | null>(null);

  // Rời form: hủy request đang bay.
  useEffect(() => () => inflight.current?.abort(), []);

  useEffect(() => {
    // Chữ đã đổi đáng kể: request đang bay là của nội dung cũ, hủy và coi như chưa có kết quả.
    if (inflight.current && asked.current !== null && changedMeaningfully(asked.current, text)) {
      inflight.current.abort();
      inflight.current = null;
      setPending(false);
      judgmentId.current = null;
    }
    if (!long || calls.current >= SUGGEST_MAX_CALLS) return;
    if (asked.current !== null && !changedMeaningfully(asked.current, text)) return;
    const timer = setTimeout(() => {
      const controller = new AbortController();
      inflight.current = controller;
      asked.current = text;
      calls.current += 1;
      judgmentId.current = null;
      setPending(true);
      void judgeRequestType(
        companyId,
        {
          title: title.trim(),
          description: description.trim(),
          ...(pickedRef.current ? { current: pickedRef.current } : {}),
        },
        controller.signal,
      ).then((v) => {
        if (controller.signal.aborted) return;
        inflight.current = null;
        setPending(false);
        judgmentId.current = v?.judgmentId ?? null;
        setVerdict(v ? { label: v.mode === 'on' ? v.label : null, forText: text } : null);
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [companyId, long, text, title, description]);

  const fresh = verdict !== null && !pending && !changedMeaningfully(verdict.forText, text);
  return {
    suggestion: fresh ? verdict.label : null,
    recordFinal: (kind) => {
      if (!pending) recordOutcome(companyId, judgmentId.current, kind);
    },
  };
}
