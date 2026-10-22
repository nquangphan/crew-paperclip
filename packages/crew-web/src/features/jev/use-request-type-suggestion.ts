// Gợi ý loại yêu cầu từ tiêu đề + mô tả: chờ chữ ổn định 800 ms và đủ 20 ký tự rồi hỏi Jev một lần cho mỗi nội dung.
// Chỉ chế độ `on` mới trả gợi ý để hiện; lỗi, quá hạn, shadow, off đều im lặng (không gợi ý, không lỗi).
import { useEffect, useRef, useState } from 'react';
import type { RequestTypeLabel } from '@/api';
import { judgeRequestType, recordOutcome } from './judge-client';

export const SUGGEST_DEBOUNCE_MS = 800;
export const SUGGEST_MIN_CHARS = 20;

export interface RequestTypeSuggestion {
  /** Loại Jev gợi ý khi chế độ `on`; còn lại là null. */
  suggestion: RequestTypeLabel | null;
  /** Ghi loại owner đã gửi cho phán đoán gần nhất (kể cả shadow). Lỗi bị nuốt. */
  recordFinal: (kind: string) => void;
}

export function useRequestTypeSuggestion(
  companyId: string,
  title: string,
  description: string,
  /** Loại owner đang chọn; gửi kèm để server tính độ lệch. Đổi loại không kích hoạt lần hỏi mới. */
  current?: RequestTypeLabel,
): RequestTypeSuggestion {
  const currentRef = useRef(current);
  currentRef.current = current;
  const [verdict, setVerdict] = useState<{ label: RequestTypeLabel | null; judgmentId: string | null } | null>(null);
  const asked = useRef('');
  const judgmentId = useRef<string | null>(null);
  const text = `${title.trim()}\n${description.trim()}`;
  const long = title.trim().length + description.trim().length >= SUGGEST_MIN_CHARS;

  useEffect(() => {
    if (!long) {
      setVerdict(null);
      judgmentId.current = null;
      asked.current = '';
      return;
    }
    if (text === asked.current) return;
    let live = true;
    const timer = setTimeout(() => {
      asked.current = text;
      void judgeRequestType(companyId, {
        title: title.trim(),
        description: description.trim(),
        ...(currentRef.current ? { current: currentRef.current } : {}),
      }).then((v) => {
        if (!live) return;
        judgmentId.current = v?.judgmentId ?? null;
        setVerdict(v ? { label: v.mode === 'on' ? v.label : null, judgmentId: v.judgmentId } : null);
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [companyId, long, text, title, description]);

  return {
    suggestion: verdict?.label ?? null,
    recordFinal: (kind) => recordOutcome(companyId, judgmentId.current, kind),
  };
}
