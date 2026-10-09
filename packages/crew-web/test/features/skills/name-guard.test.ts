import { describe, expect, it } from 'vitest';
import { hasSuperpowersData, superpowersNameClash } from '@/features/skills/name-guard';

const report = (skills?: string[]) => ({
  superpowers: { pinned: '5.0.7', ownerInstalled: '5.0.7', ...(skills ? { skills } : {}) },
});

describe('superpowersNameClash (Q6)', () => {
  it('tên trùng skill Superpowers bị chặn, trả đúng tên trùng', () => {
    expect(superpowersNameClash('brainstorming', [report(['brainstorming', 'writing-plans'])])).toBe('brainstorming');
  });
  it('không phân biệt hoa thường và khoảng trắng hai đầu', () => {
    expect(superpowersNameClash('  Brainstorming ', [report(['brainstorming'])])).toBe('brainstorming');
  });
  it('tên khác thì cho', () => {
    expect(superpowersNameClash('my-skill', [report(['brainstorming'])])).toBeNull();
  });
  it('trùng với skill của bất kỳ máy nào trong company', () => {
    expect(superpowersNameClash('writing-plans', [report(['brainstorming']), report(['writing-plans'])])).toBe(
      'writing-plans',
    );
  });
  it('report thiếu skills thì null và hasSuperpowersData sai', () => {
    expect(superpowersNameClash('brainstorming', [report()])).toBeNull();
    expect(hasSuperpowersData([report()])).toBe(false);
    expect(hasSuperpowersData([])).toBe(false);
    expect(hasSuperpowersData([report(), report(['a'])])).toBe(true);
  });
});
