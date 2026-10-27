// crew: tự dựng
/** Heading mở đầu mục tổng kết của Trợ Lý trong mô tả (đứng đầu dòng, đúng cấp `##`). */
const SUMMARY_HEADING = /^## Tổng kết của Trợ Lý[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;

interface SplitDescription {
  /** Mô tả không có mục tổng kết (phần trước heading). */
  body: string;
  /** Nội dung sau heading tới hết mô tả; `null` khi mô tả không có mục này. */
  summary: string | null;
}

/**
 * Tách mô tả thành thân và mục "Tổng kết của Trợ Lý". Chỉ nhận lần xuất hiện đầu tiên của heading ở đầu dòng; heading
 * nằm trong code fence thì bỏ qua.
 */
function splitAssistantSummary(description: string | null | undefined): SplitDescription {
  const text = description ?? '';
  const lines = text.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const m = FENCE.exec(line);
    if (m) {
      if (fence === null) fence = m[1];
      else if (fence === m[1]) fence = null;
      continue;
    }
    if (fence === null && SUMMARY_HEADING.test(line)) {
      return {
        body: lines.slice(0, i).join('\n').trimEnd(),
        summary: lines
          .slice(i + 1)
          .join('\n')
          .trim(),
      };
    }
  }
  return { body: text, summary: null };
}

export type { SplitDescription };
export { splitAssistantSummary };
