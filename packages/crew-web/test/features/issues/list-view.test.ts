import type { CompactIssue } from '@paperclipai/shared';
import { describe, expect, it } from 'vitest';
import {
  activityAt,
  dateGroup,
  dateSeparator,
  dateSeparatorField,
  groupIssues,
  liveIssueIds,
} from '@/features/issues/list/list-view';
import { columnPatch, isColumnVisible, parseListState } from '@/features/issues/list/use-issues';

const issue = (id: string, over: Partial<CompactIssue> = {}) =>
  ({
    id,
    title: id,
    status: 'todo',
    projectId: null,
    assigneeAgentId: null,
    updatedAt: '2026-10-10T01:00:00.000Z',
    createdAt: '2026-10-09T01:00:00.000Z',
    ...over,
  }) as unknown as CompactIssue;

const labels = {
  status: (s: string) => `S:${s}`,
  project: (id: string) => ({ p1: 'Beta', p2: 'Alpha' })[id],
  agent: (id: string) => ({ a1: 'Agent 1' })[id],
  noProject: 'Không project',
  unassigned: 'Chưa giao',
};

describe('groupIssues', () => {
  it('không nhóm: một khối không tiêu đề', () => {
    expect(groupIssues([issue('1')], 'none', labels)).toEqual([{ key: '__all', label: null, items: [issue('1')] }]);
  });

  it('trạng thái theo thứ tự Paperclip, trạng thái lạ xếp cuối', () => {
    const groups = groupIssues(
      [issue('1', { status: 'done' }), issue('2', { status: 'weird' as never }), issue('3', { status: 'in_progress' })],
      'status',
      labels,
    );
    expect(groups.map((g) => g.key)).toEqual(['in_progress', 'done', 'weird']);
    expect(groups[0].label).toBe('S:in_progress');
  });

  it('project theo tên, không project cuối; người làm theo thứ tự xuất hiện', () => {
    const items = [
      issue('1', { projectId: null }),
      issue('2', { projectId: 'p1', assigneeAgentId: 'a1' }),
      issue('3', { projectId: 'p2' }),
    ];
    expect(groupIssues(items, 'project', labels).map((g) => g.label)).toEqual(['Alpha', 'Beta', 'Không project']);
    expect(groupIssues(items, 'assignee', labels).map((g) => g.label)).toEqual(['Chưa giao', 'Agent 1']);
  });
});

describe('vạch ngày theo lịch Asia/Ho_Chi_Minh', () => {
  // 2026-10-11 09:00 giờ VN.
  const now = new Date('2026-10-11T02:00:00.000Z');

  it('Hôm nay / Hôm qua / Trước đó theo ngày VN, không theo UTC', () => {
    // 00:30 ngày 11 giờ VN là 17:30 ngày 10 UTC: vẫn là hôm nay.
    expect(dateGroup('2026-10-10T17:30:00.000Z', now)).toBe('today');
    // 23:30 ngày 10 giờ VN.
    expect(dateGroup('2026-10-10T16:30:00.000Z', now)).toBe('yesterday');
    expect(dateGroup('2026-10-09T16:30:00.000Z', now)).toBe('earlier');
    expect(dateGroup('không phải ngày', now)).toBe('earlier');
  });

  it('chỉ vẽ vạch khi đổi nhóm; danh sách toàn việc cũ không mở đầu bằng Trước đó', () => {
    expect(dateSeparator(null, 'today')).toBe('today');
    expect(dateSeparator('today', 'today')).toBeNull();
    expect(dateSeparator('today', 'earlier')).toBe('earlier');
    expect(dateSeparator(null, 'earlier')).toBeNull();
  });

  it('chỉ có vạch khi sắp theo ngày', () => {
    expect(dateSeparatorField('updated')).toBe('updatedAt');
    expect(dateSeparatorField('created')).toBe('createdAt');
    expect(dateSeparatorField('title')).toBeNull();
  });
});

describe('thời gian hoạt động và run sống', () => {
  it('ưu tiên lastActivityAt rồi mới updatedAt', () => {
    expect(activityAt(issue('1'))).toBe('2026-10-10T01:00:00.000Z');
    const at = new Date('2026-10-11T00:00:00.000Z');
    expect(activityAt(issue('1', { lastActivityAt: at }))).toBe(at);
  });

  it('chỉ run chờ/chạy của yêu cầu chưa xong', () => {
    const issues = [issue('1'), issue('2', { status: 'done' })];
    const runs = [
      { status: 'running', issueId: '1' },
      { status: 'running', issueId: '2' },
      { status: 'succeeded', issueId: '1' },
      { status: 'queued', issueId: null },
      { status: 'queued', issueId: 'khac' },
    ];
    expect([...liveIssueIds(runs, issues)]).toEqual(['1', 'khac']);
    expect(liveIssueIds(undefined, issues).size).toBe(0);
  });
});

describe('cột hiện trong URL', () => {
  it('mặc định ẩn Project; hide bớt cột mặc định, show bật cột thêm', () => {
    const base = parseListState(new URLSearchParams(''));
    expect(isColumnVisible(base, 'project')).toBe(false);
    expect(isColumnVisible(base, 'assignee')).toBe(true);
    const custom = parseListState(new URLSearchParams('hide=assignee,bogus&show=project'));
    expect(custom.hidden).toEqual(['assignee']);
    expect(isColumnVisible(custom, 'assignee')).toBe(false);
    expect(isColumnVisible(custom, 'project')).toBe(true);
  });

  it('columnPatch ghi đúng tham số và bỏ khóa khi về mặc định', () => {
    const base = parseListState(new URLSearchParams(''));
    expect(columnPatch(base, 'stage', false)).toEqual({ hidden: 'stage', shown: null });
    expect(columnPatch(base, 'project', true)).toEqual({ hidden: null, shown: 'project' });
    const custom = parseListState(new URLSearchParams('hide=stage&show=project'));
    expect(columnPatch(custom, 'stage', true)).toEqual({ hidden: null, shown: 'project' });
    expect(columnPatch(custom, 'project', false)).toEqual({ hidden: 'stage', shown: null });
  });
});
