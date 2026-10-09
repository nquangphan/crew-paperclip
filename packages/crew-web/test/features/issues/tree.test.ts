import { describe, expect, it } from 'vitest';
import { buildIssueTree, flattenTree } from '@/features/issues/list/tree';

const row = (id: string, parentId: string | null, updatedAt: string) => ({ id, parentId, updatedAt });

describe('buildIssueTree', () => {
  it('lồng con dưới cha theo parentId, ba tầng', () => {
    const tree = buildIssueTree([
      row('c', 'b', '2026-10-10T03:00:00Z'),
      row('a', null, '2026-10-10T01:00:00Z'),
      row('b', 'a', '2026-10-10T02:00:00Z'),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].issue.id).toBe('a');
    expect(tree[0].children[0].issue.id).toBe('b');
    expect(tree[0].children[0].children[0].issue.id).toBe('c');
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it('cha không có trong danh sách thì con thành gốc', () => {
    const tree = buildIssueTree([row('x', 'vang-mat', '2026-10-10T01:00:00Z')]);
    expect(tree.map((n) => n.issue.id)).toEqual(['x']);
    expect(tree[0].depth).toBe(0);
  });

  it('giữ thứ tự updatedAt giảm dần ở mọi tầng', () => {
    const tree = buildIssueTree([
      row('old', null, '2026-10-01T00:00:00Z'),
      row('new', null, '2026-10-09T00:00:00Z'),
      row('k1', 'new', '2026-10-02T00:00:00Z'),
      row('k2', 'new', '2026-10-08T00:00:00Z'),
    ]);
    expect(tree.map((n) => n.issue.id)).toEqual(['new', 'old']);
    expect(tree[0].children.map((n) => n.issue.id)).toEqual(['k2', 'k1']);
  });

  it('vòng cha-con không làm treo và không mất dòng', () => {
    const tree = buildIssueTree([row('p', 'q', '2026-10-02T00:00:00Z'), row('q', 'p', '2026-10-01T00:00:00Z')]);
    expect(
      flattenTree(tree, () => true)
        .map((n) => n.issue.id)
        .sort(),
    ).toEqual(['p', 'q']);
  });
});

describe('flattenTree', () => {
  it('bỏ con của nhánh đang thu', () => {
    const tree = buildIssueTree([row('a', null, '2026-10-02T00:00:00Z'), row('b', 'a', '2026-10-01T00:00:00Z')]);
    expect(flattenTree(tree, () => false).map((n) => n.issue.id)).toEqual(['a']);
    expect(flattenTree(tree, () => true).map((n) => n.issue.id)).toEqual(['a', 'b']);
  });
});
