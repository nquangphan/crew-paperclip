// Phần thuần của danh sách yêu cầu theo IssuesList Paperclip: gom nhóm, vạch ngày, thời gian hoạt động, task đang chạy.
import type { CompactIssue } from '@paperclipai/shared';
import { type GroupKey, type SortKey, STATUS_OPTIONS } from './use-issues';

export interface IssueGroupData {
  key: string;
  /** null khi không nhóm (một khối không tiêu đề). */
  label: string | null;
  items: CompactIssue[];
}

export interface GroupLabels {
  status: (status: string) => string;
  project: (projectId: string) => string | undefined;
  agent: (agentId: string) => string | undefined;
  noProject: string;
  unassigned: string;
}

const NO_PROJECT = '__no_project';
const UNASSIGNED = '__unassigned';

function bucket(issues: readonly CompactIssue[], keyOf: (issue: CompactIssue) => string): Map<string, CompactIssue[]> {
  const out = new Map<string, CompactIssue[]>();
  for (const issue of issues) {
    const key = keyOf(issue);
    const list = out.get(key);
    if (list) list.push(issue);
    else out.set(key, [issue]);
  }
  return out;
}

/**
 * Chia yêu cầu thành nhóm như Paperclip: trạng thái theo thứ tự cố định, project theo tên (không project cuối cùng),
 * người làm theo thứ tự xuất hiện. Cây cha-con dựng riêng trong từng nhóm.
 */
export function groupIssues(issues: readonly CompactIssue[], group: GroupKey, labels: GroupLabels): IssueGroupData[] {
  if (group === 'none') return [{ key: '__all', label: null, items: [...issues] }];
  if (group === 'status') {
    const groups = bucket(issues, (i) => i.status);
    const order: string[] = [
      ...STATUS_OPTIONS,
      ...[...groups.keys()].filter((s) => !(STATUS_OPTIONS as readonly string[]).includes(s)),
    ];
    return order
      .filter((s) => groups.has(s))
      .map((s) => ({ key: s, label: labels.status(s), items: groups.get(s) as CompactIssue[] }));
  }
  if (group === 'project') {
    const groups = bucket(issues, (i) => i.projectId ?? NO_PROJECT);
    const name = (key: string) => (key === NO_PROJECT ? labels.noProject : (labels.project(key) ?? key.slice(0, 8)));
    return [...groups.keys()]
      .sort((a, b) => {
        if (a === NO_PROJECT) return 1;
        if (b === NO_PROJECT) return -1;
        return name(a).localeCompare(name(b), 'vi');
      })
      .map((key) => ({ key, label: name(key), items: groups.get(key) as CompactIssue[] }));
  }
  const groups = bucket(issues, (i) => i.assigneeAgentId ?? UNASSIGNED);
  return [...groups.keys()].map((key) => ({
    key,
    label: key === UNASSIGNED ? labels.unassigned : (labels.agent(key) ?? key.slice(0, 8)),
    items: groups.get(key) as CompactIssue[],
  }));
}

export type DateGroup = 'today' | 'yesterday' | 'earlier';

// Ngày lịch theo giờ Việt Nam: yêu cầu cập nhật 23:30 giờ VN vẫn là "Hôm nay" dù UTC đã sang ngày khác.
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dayOrdinal(date: Date): number {
  const [y, m, d] = dayFormat.format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Hôm nay / Hôm qua / Trước đó theo lịch Asia/Ho_Chi_Minh. Ngày hỏng tính là Trước đó. */
export function dateGroup(value: string | Date, now: Date = new Date()): DateGroup {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'earlier';
  const diff = dayOrdinal(now) - dayOrdinal(date);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  return 'earlier';
}

/** Nhóm cần vạch trước dòng hiện tại; danh sách toàn việc cũ thì không mở đầu bằng "Trước đó". */
export function dateSeparator(previous: DateGroup | null, current: DateGroup): DateGroup | null {
  if (previous === current) return null;
  if (previous === null && current === 'earlier') return null;
  return current;
}

/** Trường ngày làm vạch: chỉ khi sắp mới nhất trước theo ngày cập nhật hoặc ngày tạo. */
export function dateSeparatorField(sort: SortKey): 'updatedAt' | 'createdAt' | null {
  if (sort === 'updated') return 'updatedAt';
  if (sort === 'created') return 'createdAt';
  return null;
}

/** Thời điểm hoạt động gần nhất hiển thị ở cột thời gian (giống issueActivityTimestamp). */
export function activityAt(issue: CompactIssue): string | Date {
  return issue.lastActivityAt ?? issue.lastExternalCommentAt ?? issue.updatedAt;
}

const LIVE_RUN = new Set(['queued', 'running']);
const TERMINAL = new Set(['done', 'cancelled']);

/** Id yêu cầu có run đang chờ/chạy, bỏ yêu cầu đã xong hoặc đã hủy. */
export function liveIssueIds(
  runs: readonly { status: string; issueId?: string | null }[] | undefined,
  issues: readonly CompactIssue[],
): Set<string> {
  const statusOf = new Map(issues.map((i) => [i.id, i.status]));
  const out = new Set<string>();
  for (const run of runs ?? []) {
    if (!run.issueId || !LIVE_RUN.has(run.status)) continue;
    if (TERMINAL.has(statusOf.get(run.issueId) ?? '')) continue;
    out.add(run.issueId);
  }
  return out;
}
