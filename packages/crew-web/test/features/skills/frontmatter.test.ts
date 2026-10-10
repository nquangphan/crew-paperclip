import { describe, expect, it } from 'vitest';
import { frontmatterName, skillMarkdownClash } from '@/features/skills/frontmatter';

const report = (skills: string[]) => ({ superpowers: { skills } });

describe('frontmatterName', () => {
  it('đọc name trong frontmatter', () => {
    expect(frontmatterName('---\nname: viet-test\ndescription: x\n---\n# Viết test')).toBe('viet-test');
  });
  it('bỏ nháy và khoảng trắng', () => {
    expect(frontmatterName('---\ndescription: x\nname:  "Viết test" \n---\n')).toBe('Viết test');
    expect(frontmatterName("---\r\nname: 'abc'\r\n---\r\n")).toBe('abc');
  });
  it('không có frontmatter hoặc không có name thì null', () => {
    expect(frontmatterName('# Tiêu đề\nname: abc')).toBeNull();
    expect(frontmatterName('---\ndescription: x\n---\n')).toBeNull();
    expect(frontmatterName('---\nname:\n---\n')).toBeNull();
  });
  it('chỉ đọc khóa name ở đầu dòng, không đọc khóa lồng', () => {
    expect(frontmatterName('---\nmetadata:\n  name: con\n---\n')).toBeNull();
  });
});

describe('skillMarkdownClash', () => {
  it('đổi name thành tên skill Superpowers thì chặn', () => {
    expect(skillMarkdownClash('---\nname: Brainstorming\n---\n', [report(['brainstorming'])])).toBe('brainstorming');
  });
  it('tên khác thì cho', () => {
    expect(skillMarkdownClash('---\nname: viet-test\n---\n', [report(['brainstorming'])])).toBeNull();
    expect(skillMarkdownClash('# không frontmatter', [report(['brainstorming'])])).toBeNull();
  });
});
