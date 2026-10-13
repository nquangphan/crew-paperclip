import type { CompactIssue } from '@paperclipai/shared';
import { describe, expect, it } from 'vitest';
import type { CrewRoot } from '@/api';
import { matchesKind } from '@/features/issues/list/use-issues';
import {
  availableKinds,
  findKindLabelIds,
  isRequestKind,
  labelledKindOf,
  missingKindLabels,
  NO_KIND_LABELS,
  REQUEST_KINDS,
} from '@/features/issues/new/kinds';

describe('loại yêu cầu', () => {
  it('có bốn loại theo thứ tự hiển thị, docs là loại hợp lệ', () => {
    expect(REQUEST_KINDS).toEqual(['code', 'bug', 'research', 'docs']);
    expect(isRequestKind('docs')).toBe(true);
    expect(isRequestKind('Docs')).toBe(false);
  });

  it('tìm id nhãn research và docs theo đúng tên', () => {
    const labels = [
      { id: 'l-bug', name: 'bug' },
      { id: 'l-docs', name: 'docs' },
      { id: 'l-r', name: 'research' },
      { id: 'l-x', name: 'Docs' },
    ];
    expect(findKindLabelIds(labels)).toEqual({ research: 'l-r', docs: 'l-docs' });
    expect(findKindLabelIds([])).toEqual(NO_KIND_LABELS);
  });

  it('loại có nhãn chỉ chọn được khi company có nhãn đó', () => {
    expect(availableKinds({ research: 'l-r', docs: 'l-d' })).toEqual(['code', 'bug', 'research', 'docs']);
    expect(availableKinds({ research: null, docs: 'l-d' })).toEqual(['code', 'bug', 'docs']);
    expect(availableKinds(NO_KIND_LABELS)).toEqual(['code', 'bug']);
    expect(missingKindLabels({ research: 'l-r', docs: null })).toEqual(['docs']);
    expect(missingKindLabels(NO_KIND_LABELS)).toEqual(['research', 'docs']);
  });

  it('loại của issue theo nhãn đã gắn', () => {
    expect(labelledKindOf([{ name: 'docs' }])).toBe('docs');
    expect(labelledKindOf([{ name: 'bug' }, { name: 'research' }])).toBe('research');
    expect(labelledKindOf([{ name: 'bug' }])).toBeNull();
    expect(labelledKindOf(undefined)).toBeNull();
  });
});

describe('lọc danh sách theo loại', () => {
  const issue = (id: string, labels: string[]) =>
    ({ id, labels: labels.map((name) => ({ id: `l-${name}`, name })) }) as unknown as CompactIssue;
  const roots = new Map<string, CrewRoot>([['r', { kind: 'research' } as CrewRoot]]);
  const rows = [issue('d', ['docs']), issue('n', ['research']), issue('r', []), issue('c', ['bug'])];
  const ids = (kind: Parameters<typeof matchesKind>[1]) =>
    rows.filter((i) => matchesKind(i, kind, roots)).map((i) => i.id);

  it('Viết tài liệu, Nghiên cứu và Code / Bug tách riêng; Tất cả giữ mọi dòng', () => {
    expect(ids('docs')).toEqual(['d']);
    expect(ids('research')).toEqual(['n', 'r']);
    expect(ids('other')).toEqual(['c']);
    expect(ids('all')).toEqual(['d', 'n', 'r', 'c']);
  });
});
