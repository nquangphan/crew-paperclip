// Tách file markdown hướng dẫn thành tiêu đề, phần mở đầu, nhóm (`##`) và mục (`###`), rồi lọc theo vai trò.
//
// Cú pháp riêng, mỗi thứ đứng riêng một dòng (bỏ qua trong khối code):
//   ## Tên nhóm {#group-id}
//   ### Tên mục {#section-id}                    mọi vai trò
//   ### Tên mục {#section-id roles=owner,operator} chỉ các vai trò này
//   {{shot:<id>}}       ảnh chụp màn hình (file theo ngôn ngữ và vai trò, xem guide-shot.tsx)
//   {{diagram:<id>}}    sơ đồ minh họa (không phải ảnh chụp)
//   {{missing}}         bảng tính năng Paperclip không có trong Crew
//   {{roles:owner,operator}} … {{/roles}}   đoạn chỉ cho các vai trò này (không lồng nhau)
import { type GuideRole, isGuideRole } from './guide-roles';

export type GuideBlock = (
  | { type: 'md'; text: string }
  | { type: 'shot'; id: string }
  | { type: 'diagram'; id: string }
  | { type: 'missing' }
) & { roles?: GuideRole[] };

export interface GuideSection {
  id: string;
  title: string;
  /** Không có: mọi vai trò. */
  roles?: GuideRole[];
  blocks: GuideBlock[];
}

export interface GuideGroup {
  id: string;
  title: string;
  sections: GuideSection[];
}

export interface GuideDoc {
  title: string;
  intro: GuideBlock[];
  groups: GuideGroup[];
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(##|###) (.+?)\s*\{#([a-z0-9-]+)(?:\s+roles=([a-z,]+))?\}\s*$/;
const MEDIA_LINE = /^\{\{(shot|diagram):([a-z0-9-]+)\}\}$/;
const ROLES_OPEN = /^\{\{roles:([a-z,]+)\}\}$/;
const ROLES_CLOSE = '{{/roles}}';
const MISSING_LINE = '{{missing}}';

function parseRoles(raw: string, where: string): GuideRole[] {
  const roles = raw.split(',').filter(Boolean);
  const bad = roles.filter((r) => !isGuideRole(r));
  if (!roles.length || bad.length) throw new Error(`Vai trò không hợp lệ ở ${where}: ${raw}`);
  return roles as GuideRole[];
}

function toBlocks(lines: string[], where: string): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  let buffer: string[] = [];
  let roles: GuideRole[] | undefined;
  const withRoles = (block: GuideBlock): GuideBlock => (roles ? { ...block, roles } : block);
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push(withRoles({ type: 'md', text }));
    buffer = [];
  };
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    const trimmed = line.trim();
    if (inFence) {
      buffer.push(line);
      continue;
    }
    const media = MEDIA_LINE.exec(trimmed);
    const open = ROLES_OPEN.exec(trimmed);
    if (media) {
      flush();
      blocks.push(withRoles({ type: media[1] as 'shot' | 'diagram', id: media[2] }));
    } else if (trimmed === MISSING_LINE) {
      flush();
      blocks.push(withRoles({ type: 'missing' }));
    } else if (open) {
      if (roles) throw new Error(`Khối {{roles}} lồng nhau ở ${where}`);
      flush();
      roles = parseRoles(open[1], where);
    } else if (trimmed === ROLES_CLOSE) {
      if (!roles) throw new Error(`{{/roles}} thừa ở ${where}`);
      flush();
      roles = undefined;
    } else {
      buffer.push(line);
    }
  }
  if (roles) throw new Error(`Thiếu {{/roles}} ở ${where}`);
  flush();
  return blocks;
}

export function parseGuide(markdown: string): GuideDoc {
  let title = '';
  const introLines: string[] = [];
  const groups: {
    id: string;
    title: string;
    sections: { id: string; title: string; roles?: GuideRole[]; lines: string[] }[];
  }[] = [];
  let current: { lines: string[] } | null = null;
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const h1 = !inFence && !title && !groups.length ? /^# (.+)$/.exec(line) : null;
    const heading = !inFence ? HEADING.exec(line) : null;
    if (!inFence && !heading && /^#{2,3} /.test(line)) throw new Error(`Tiêu đề thiếu {#id}: ${line}`);
    if (h1) {
      title = h1[1].trim();
    } else if (heading?.[1] === '##') {
      if (heading[4]) throw new Error(`Nhóm không gắn vai trò: ${line}`);
      groups.push({ id: heading[3], title: heading[2], sections: [] });
      current = null;
    } else if (heading) {
      const group = groups.at(-1);
      if (!group) throw new Error(`Mục nằm ngoài nhóm: ${line}`);
      const section = {
        id: heading[3],
        title: heading[2],
        ...(heading[4] ? { roles: parseRoles(heading[4], heading[3]) } : {}),
        lines: [],
      };
      group.sections.push(section);
      current = section;
    } else if (current) {
      current.lines.push(line);
    } else if (!groups.length) {
      introLines.push(line);
    } else if (line.trim()) {
      throw new Error(`Nội dung nằm giữa nhóm và mục đầu: ${line}`);
    }
  }
  return {
    title,
    intro: toBlocks(introLines, 'mở đầu'),
    groups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      sections: g.sections.map(({ lines, ...s }) => ({ ...s, blocks: toBlocks(lines, s.id) })),
    })),
  };
}

const visible = (roles: GuideRole[] | undefined, role: GuideRole) => !roles || roles.includes(role);

/** Bản của một vai trò: bỏ mục và đoạn không dành cho vai trò đó, bỏ nhóm không còn mục nào. */
export function filterGuide(doc: GuideDoc, role: GuideRole): GuideDoc {
  const blocks = (list: GuideBlock[]) => list.filter((b) => visible(b.roles, role));
  return {
    title: doc.title,
    intro: blocks(doc.intro),
    groups: doc.groups
      .map((g) => ({
        ...g,
        sections: g.sections.filter((s) => visible(s.roles, role)).map((s) => ({ ...s, blocks: blocks(s.blocks) })),
      }))
      .filter((g) => g.sections.length > 0),
  };
}

/** Mọi khối của tài liệu (kể cả phần mở đầu), không lọc vai trò. */
export function allBlocks(doc: GuideDoc): GuideBlock[] {
  return [...doc.intro, ...doc.groups.flatMap((g) => g.sections.flatMap((s) => s.blocks))];
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
