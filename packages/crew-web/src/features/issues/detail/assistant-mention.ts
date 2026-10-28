// crew: tự dựng
/**
 * Đổi tag `@tro-ly` / `@Trợ Lý` trong bình luận thành link `[@Trợ Lý](agent://<id>)` tới Trợ Lý của project, để bình
 * luận hiện chip và server biết bình luận gọi Trợ Lý (route `assistant-call`). Hàm thuần.
 *
 * Luật khớp: không phân biệt hoa thường, so sau khi chuẩn hóa NFC; đứng riêng một từ (trước là đầu dòng, khoảng trắng
 * hay dấu mở ngoặc/nháy; sau là hết chuỗi, khoảng trắng hay dấu câu không dính chữ). Ranh giới xét trên cả chuỗi, nên
 * tag dính ngay sau inline code hay thẻ HTML không khớp. Bỏ qua code block có rào và thụt lề, inline code, thẻ HTML và
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

const TAG_RE = /(^|[\s([{"'“‘])@(?:tro-ly|trợ[ {2}]lý)(?=$|[\s)\]}>,;:!?…"'”’]|\.(?![\p{L}\p{N}]))/giu;
/** Inline code (cùng độ dài dãy backtick), link/ảnh markdown, comment và thẻ HTML, autolink `<…>`: giữ nguyên. */
const PROTECTED_INLINE_RE = /(`+)[\s\S]*?\1|!?\[[^\]\n]*\]\([^)\n]*\)|<!--[\s\S]*?-->|<\/?[A-Za-z][^<>\n]*>|<[^>\s]+>/g;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_RE = /^(?: {4}|\t)/;
const LIST_ITEM_RE = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
/**
 * Ký tự giữ chỗ cho vùng được bảo vệ: không phải khoảng trắng hay dấu câu, nên tag dính ngay trước hay sau vùng đó
 * (`` `x`@tro-ly ``, `<b>@tro-ly</b>`) không khớp ranh giới từ của `TAG_RE`.
 */
const MASK = '\u0000';
const maskText = (text: string) => text.replace(/[^\n]/g, MASK);

/**
 * Che code block có rào và code block thụt ≥ 4 dấu cách (hay tab; chỉ khi mở sau dòng trống, không nằm trong list),
 * giữ nguyên độ dài và ký tự xuống dòng.
 */
function maskCodeBlocks(text: string): string {
  let out = '';
  let fence: string | null = null;
  let indented = false;
  let inList = false;
  let prevBlank = true;
  for (const line of text.split(/(?<=\n)/)) {
    const blank = line.trim() === '';
    const marker = FENCE_RE.exec(line)?.[1] ?? null;
    if (fence !== null) {
      out += maskText(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      prevBlank = false;
      continue;
    }
    if (indented && !blank && !INDENTED_RE.test(line)) indented = false;
    if (!indented && !blank && !inList && prevBlank && INDENTED_RE.test(line)) indented = true;
    if (indented) {
      out += maskText(line);
      prevBlank = blank;
      continue;
    }
    if (marker) {
      fence = marker;
      out += maskText(line);
      prevBlank = false;
      continue;
    }
    if (LIST_ITEM_RE.test(line)) inList = true;
    else if (!blank && prevBlank && !INDENTED_RE.test(line)) inList = false;
    out += line;
    prevBlank = blank;
  }
  return out;
}

export function toAssistantMention(body: string, assistant: { id: string } | null): AssistantMentionResult {
  const normalized = body.normalize('NFC');
  // Tìm tag trên bản đã che (cùng độ dài), rồi thay đúng vị trí đó trên bản gốc.
  const masked = maskCodeBlocks(normalized).replace(PROTECTED_INLINE_RE, maskText);
  const matches = [...masked.matchAll(TAG_RE)];
  if (matches.length === 0) return { body, mentioned: false, missing: false };
  if (!assistant) return { body, mentioned: false, missing: true };
  const replacement = `[${ASSISTANT_MENTION_LABEL}](agent://${assistant.id})`;
  let out = '';
  let last = 0;
  for (const match of matches) {
    const start = (match.index ?? 0) + match[1].length;
    out += normalized.slice(last, start) + replacement;
    last = (match.index ?? 0) + match[0].length;
  }
  return { body: out + normalized.slice(last), mentioned: true, missing: false };
}
