// Tách file markdown hướng dẫn thành tiêu đề, phần mở đầu và các mục `##`.
// Hai dòng đặc biệt đứng riêng một dòng: `{{shot:<id>}}` (chỗ ảnh minh họa) và `{{missing}}` (danh sách tính năng không có).

export type GuideBlock = { type: 'md'; text: string } | { type: 'shot'; id: string } | { type: 'missing' };

export interface GuideSection {
  title: string;
  blocks: GuideBlock[];
}

export interface GuideDoc {
  title: string;
  intro: GuideBlock[];
  sections: GuideSection[];
}

const SHOT_LINE = /^\{\{shot:([a-z0-9-]+)\}\}$/;
const MISSING_LINE = '{{missing}}';
const FENCE = /^\s*(```|~~~)/;

function toBlocks(lines: string[]): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push({ type: 'md', text });
    buffer = [];
  };
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    const shot = inFence ? null : SHOT_LINE.exec(line.trim());
    if (shot) {
      flush();
      blocks.push({ type: 'shot', id: shot[1] });
    } else if (!inFence && line.trim() === MISSING_LINE) {
      flush();
      blocks.push({ type: 'missing' });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

export function parseGuide(markdown: string): GuideDoc {
  let title = '';
  const introLines: string[] = [];
  const chunks: { title: string; lines: string[] }[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const h1 = !inFence && !title && !chunks.length ? /^# (.+)$/.exec(line) : null;
    const h2 = !inFence ? /^## (.+)$/.exec(line) : null;
    if (h1) title = h1[1].trim();
    else if (h2) chunks.push({ title: h2[1].trim(), lines: [] });
    else if (chunks.length) chunks[chunks.length - 1].lines.push(line);
    else introLines.push(line);
  }
  return {
    title,
    intro: toBlocks(introLines),
    sections: chunks.map((c) => ({ title: c.title, blocks: toBlocks(c.lines) })),
  };
}

/** Đường dẫn ảnh viết thẳng kiểu `![chú thích](img/x.png)`. */
export function markdownImages(markdown: string): string[] {
  return [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/** Link nội bộ trong app: bắt đầu bằng một dấu `/` (không phải `//`), không tính ảnh. */
export function internalLinks(markdown: string): string[] {
  return [...markdown.matchAll(/(?<!!)\[[^\]]*\]\((\/(?!\/)[^)\s]*)\)/g)].map((m) => m[1]);
}

/** Thêm tiền tố company vào link nội bộ để `<a href>` trỏ đúng ngay cả khi mở tab mới. */
export function prefixInternalLinks(markdown: string, prefixHref: (to: string) => string): string {
  return markdown.replace(
    /(?<!!)(\[[^\]]*\]\()(\/(?!\/)[^)\s]*)\)/g,
    (_m, open: string, to: string) => `${open}${prefixHref(to)})`,
  );
}
