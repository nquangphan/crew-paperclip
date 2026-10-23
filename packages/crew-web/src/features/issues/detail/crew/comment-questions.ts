// crew: tự dựng
import type { AskUserQuestionsAnswer, AskUserQuestionsInteraction, IssueComment } from '@paperclipai/shared';

type Question = AskUserQuestionsInteraction['payload']['questions'][number];

/** Thẻ có sẵn (ask_user_questions…) tạo trong khoảng này trước bình luận thì bình luận chỉ nhắc lại thẻ đó. */
const CARD_WINDOW_MS = 10 * 60_000;
const LETTERS = 'abcdefgh';

const QUESTION_RE = /^\s*(?:[-*+]\s+)?(?:#{1,6}\s+)?(?:\*\*|__)?\s*Q(\d{1,2})\s*[.:)]\s*(.*)$/;
const OPTION_RE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([a-h])[).](?:\*\*|__)?\s+(.+)$/;
const SUGGEST_RE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*(Đề xuất\b.*)$/i;

const plain = (s: string) => s.replace(/\*\*|__/g, '').trim();

/** Câu hỏi viết gọn một dòng: `**Q1. <câu hỏi>?** a) <…> b) <…> **Đề xuất a**: <…>`. Dưới hai lựa chọn thì null. */
function splitInline(text: string): { prompt: string; options: string[]; suggest?: string } | null {
  const marks: { start: number; end: number }[] = [];
  let from = 0;
  for (const letter of LETTERS) {
    const re = new RegExp(`(?:^|\\s)(?:\\*\\*|__)?${letter}\\)(?:\\*\\*|__)?\\s`, 'g');
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) break;
    marks.push({ start: m.index, end: re.lastIndex });
    from = re.lastIndex;
  }
  if (marks.length < 2) return null;
  const tail = text.slice(marks[marks.length - 1].end);
  const cut = tail.search(/(?:\*\*|__)?Đề xuất/i);
  const options = marks.map((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : cut >= 0 ? marks[i].end + cut : text.length;
    return `${LETTERS[i]}) ${plain(text.slice(m.end, end))}`;
  });
  return {
    prompt: plain(text.slice(0, marks[0].start)),
    options,
    ...(cut >= 0 ? { suggest: plain(tail.slice(cut)) } : {}),
  };
}

/**
 * Đọc các điểm owner cần chốt mà agent viết trong bình luận theo mẫu của role (`Q1. <câu hỏi>`, `- a) <lựa chọn>`,
 * `- Đề xuất: …`, hoặc gọn trên một dòng), thành câu hỏi cùng hình payload của thẻ `ask_user_questions`. Câu có lựa chọn là bắt buộc; câu
 * không có lựa chọn (hỏi thông tin) chỉ có ô nhập chữ. Không có câu nào đủ hai lựa chọn thì coi như bình luận không
 * hỏi gì (ví dụ bình luận nhắc lại lựa chọn owner đã chốt `Q1: a`).
 */
export function parseCommentQuestions(body: string): Question[] {
  const out: { n: number; prompt: string[]; options: string[]; suggest?: string; open: boolean }[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const q = QUESTION_RE.exec(line);
    if (q) {
      const inline = splitInline(q[2]);
      out.push(
        inline
          ? { n: Number(q[1]), prompt: [inline.prompt], options: inline.options, suggest: inline.suggest, open: true }
          : { n: Number(q[1]), prompt: [plain(q[2])], options: [], open: true },
      );
      continue;
    }
    const cur = out.at(-1);
    if (!cur?.open || line.trim() === '') continue;
    const s = SUGGEST_RE.exec(line);
    if (s) {
      cur.suggest = plain(s[1]);
      continue;
    }
    const o = OPTION_RE.exec(line);
    if (o && o[1] === LETTERS[cur.options.length]) {
      cur.options.push(`${o[1]}) ${plain(o[2])}`);
      continue;
    }
    if (/^\s*#/.test(line)) cur.open = false;
    else if (cur.options.length === 0) cur.prompt.push(plain(line));
    // Dòng thụt lề sau lựa chọn là phần nói thêm của lựa chọn đó; dòng sát lề là đoạn khác, hết câu hỏi.
    else if (!/^\s/.test(line)) cur.open = false;
  }
  if (!out.some((q) => q.options.length >= 2)) return [];
  return out
    .filter((q) => q.options.length !== 1)
    .map((q) => {
      const prompt = `Q${q.n}. ${q.prompt.filter(Boolean).join('\n')}`;
      const helpText = q.suggest ?? null;
      if (q.options.length === 0) {
        return {
          id: `q${q.n}`,
          prompt,
          helpText,
          selectionMode: 'single',
          options: [{ id: 'text', label: prompt, freeText: true }],
        };
      }
      return {
        id: `q${q.n}`,
        prompt,
        helpText,
        selectionMode: 'single',
        required: true,
        allowOther: true,
        options: q.options.map((label, i) => ({ id: LETTERS[i], label })),
      };
    }) as Question[];
}

/** Mục điểm cần owner chốt trong tổng kết Trợ Lý ghi vào mô tả yêu cầu gốc. */
const SUMMARY_RE = /^#{2,3}\s*Cần owner quyết định\s*$/m;
/** Bình luận Trợ Lý đăng cùng lần ghi tổng kết vào mô tả. */
const SUMMARY_COMMENT = 'crew-assistant done';

/** Câu hỏi trong mục `### Cần owner quyết định` của mô tả; mục trống (`- Không có.`) thì rỗng. */
export function summaryQuestions(description: string | null | undefined): Question[] {
  const m = description ? SUMMARY_RE.exec(description) : null;
  if (!description || !m) return [];
  const rest = description.slice(m.index + m[0].length);
  const end = rest.search(/^#{1,3}\s/m);
  return parseCommentQuestions(end >= 0 ? rest.slice(0, end) : rest);
}

export interface PendingQuestions {
  /** Bình luận agent hỏi, hoặc bình luận `crew-assistant done` đi cùng tổng kết khi câu hỏi nằm trong mô tả. */
  comment: IssueComment;
  fromSummary: boolean;
  questions: Question[];
}

/**
 * Điểm cần owner chốt mới nhất mà chưa ai trả lời, lấy từ bình luận agent hoặc từ tổng kết trong mô tả: sau đó không
 * có bình luận nào của người, và không có thẻ câu hỏi/xác nhận tạo cùng lúc hay sau đó (bình luận đi kèm thẻ, hoặc
 * thẻ đã thay nó).
 */
export function pendingQuestions(
  comments: IssueComment[],
  cards: { createdAt: Date | string }[],
  description?: string | null,
): PendingQuestions | null {
  const summary = summaryQuestions(description);
  const sorted = [...comments].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i];
    if (c.authorUserId) return null;
    if (!c.authorAgentId) continue;
    const fromSummary = summary.length > 0 && c.body.startsWith(SUMMARY_COMMENT);
    const questions = fromSummary ? summary : parseCommentQuestions(c.body);
    if (questions.length === 0) continue;
    const at = +new Date(c.createdAt);
    if (cards.some((k) => +new Date(k.createdAt) >= at - CARD_WINDOW_MS)) return null;
    return { comment: c, fromSummary, questions };
  }
  return null;
}

/** Bình luận trả lời gửi lên issue: mỗi câu một dòng `Qn: <lựa chọn>` để agent đọc thẳng. */
export function commentAnswerBody(
  heading: string,
  otherLabel: string,
  questions: Question[],
  answers: AskUserQuestionsAnswer[],
): string {
  const lines = answers.map((a) => {
    const q = questions.find((x) => x.id === a.questionId);
    const n = q?.prompt.match(/^Q(\d+)/)?.[1] ?? a.questionId;
    const picked = (q?.options ?? []).filter((o) => !o.freeText && a.optionIds.includes(o.id)).map((o) => o.label);
    const text = a.otherText?.trim();
    const textOnly = q?.options.every((o) => o.freeText);
    const parts = [...picked, ...(text ? [textOnly ? text : `${otherLabel} — ${text}`] : [])];
    return `- Q${n}: ${parts.join('; ')}`;
  });
  return `${heading}\n${lines.join('\n')}`;
}
