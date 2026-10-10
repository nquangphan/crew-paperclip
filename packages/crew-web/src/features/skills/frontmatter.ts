// Đọc `name:` trong frontmatter SKILL.md để chặn đổi tên skill thành tên skill Superpowers đã ghim (S14.5).
import { superpowersNameClash } from './name-guard';

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const NAME_LINE = /^name[ \t]*:[ \t]*(.*)$/;

/** Giá trị `name` ở cấp đầu của frontmatter, hoặc null nếu không có. */
export function frontmatterName(markdown: string): string | null {
  const block = FRONTMATTER.exec(markdown);
  if (!block) return null;
  for (const line of block[1].split(/\r?\n/)) {
    const hit = NAME_LINE.exec(line);
    if (!hit) continue;
    let value = hit[1].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1).trim();
    }
    return value || null;
  }
  return null;
}

/** Tên skill Superpowers bị trùng với `name:` của SKILL.md, hoặc null. */
export function skillMarkdownClash(
  markdown: string,
  reports: Parameters<typeof superpowersNameClash>[1],
): string | null {
  const name = frontmatterName(markdown);
  return name ? superpowersNameClash(name, reports) : null;
}
