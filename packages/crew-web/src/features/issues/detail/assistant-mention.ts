// crew: tự dựng
/**
 * Đổi tag `@tro-ly` / `@Trợ Lý` trong bình luận thành link `[@Trợ Lý](agent://<id>)` tới Trợ Lý của project, để bình
 * luận hiện chip và server biết bình luận gọi Trợ Lý (route `assistant-call`). Hàm thuần.
 *
 * Luật khớp: không phân biệt hoa thường, so sau khi chuẩn hóa NFC; đứng riêng một từ (trước là đầu dòng, khoảng trắng
 * hay dấu mở ngoặc/nháy; sau là hết chuỗi, khoảng trắng hay dấu câu không dính chữ). Bỏ qua code block, inline code và
 * link đã có. Không có Trợ Lý thì giữ nguyên chữ và báo `missing`.
 */

export const ASSISTANT_MENTION_LABEL = '@Trợ Lý';

export interface AssistantMentionResult {
  body: string;
  /** Có ít nhất một tag đã đổi thành link tới Trợ Lý. */
  mentioned: boolean;
  /** Có tag nhưng project không có Trợ Lý: chữ giữ nguyên. */
  missing: boolean;
}

const TAG_RE = /(^|[\s([{"'“‘])@(?:tro-ly|trợ[  ]lý)(?=$|[\s)\]}>,;:!?…"'”’]|\.(?![\p{L}\p{N}]))/giu;
/** Inline code (cùng độ dài dãy backtick), link/ảnh markdown và autolink `<…>`: giữ nguyên. */
const PROTECTED_INLINE_RE = /(`+)[\s\S]*?\1|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\s]+>/g;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Tách phần văn bản thường (`code: false`) và code block có rào (`code: true`), giữ đủ ký tự. */
function splitFences(text: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = [];
  const lines = text.split(/(?<=\n)/);
  let fence: string | null = null;
  let buffer = '';
  let bufferIsCode = false;
  const flush = () => {
    if (buffer) parts.push({ text: buffer, code: bufferIsCode });
    buffer = '';
  };
  for (const line of lines) {
    const marker = FENCE_RE.exec(line)?.[1] ?? null;
    if (fence === null && marker) {
      flush();
      fence = marker;
      bufferIsCode = true;
      buffer = line;
      continue;
    }
    if (fence !== null) {
      buffer += line;
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
        flush();
        fence = null;
        bufferIsCode = false;
      }
      continue;
    }
    buffer += line;
  }
  flush();
  return parts;
}

function replaceTags(text: string, replacement: string | null): { text: string; count: number } {
  let count = 0;
  const out = text.replace(TAG_RE, (match, before: string) => {
    count += 1;
    return replacement === null ? match : `${before}${replacement}`;
  });
  return { text: out, count };
}

export function toAssistantMention(body: string, assistant: { id: string } | null): AssistantMentionResult {
  const normalized = body.normalize('NFC');
  const replacement = assistant ? `[${ASSISTANT_MENTION_LABEL}](agent://${assistant.id})` : null;
  let total = 0;
  let out = '';
  for (const part of splitFences(normalized)) {
    if (part.code) {
      out += part.text;
      continue;
    }
    let last = 0;
    for (const match of part.text.matchAll(PROTECTED_INLINE_RE)) {
      const start = match.index ?? 0;
      const gap = replaceTags(part.text.slice(last, start), replacement);
      total += gap.count;
      out += gap.text + match[0];
      last = start + match[0].length;
    }
    const tail = replaceTags(part.text.slice(last), replacement);
    total += tail.count;
    out += tail.text;
  }
  if (total === 0) return { body, mentioned: false, missing: false };
  if (!assistant) return { body, mentioned: false, missing: true };
  return { body: out, mentioned: true, missing: false };
}
