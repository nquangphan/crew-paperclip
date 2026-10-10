// crew: tự dựng. Logic thuần của Tổng quan: href yêu cầu, dữ liệu biểu đồ 14 ngày, banner agent, đích của dòng hoạt động.
import type { DashboardRunActivityDay } from '@paperclipai/shared';

const VN_OFFSET_MS = 7 * 3600 * 1000;

/** Ngày `YYYY-MM-DD` theo giờ Asia/Ho_Chi_Minh. */
export function vnDay(date: Date | string): string {
  const ms = new Date(date).getTime();
  return Number.isNaN(ms) ? '' : new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 14 ngày gần nhất, cũ trước, kết thúc hôm nay (giờ Asia/Ho_Chi_Minh). */
export function last14Days(now: Date = new Date()): string[] {
  return Array.from({ length: 14 }, (_, i) => vnDay(new Date(now.getTime() - (13 - i) * 86_400_000)));
}

export interface BarSegment {
  color: string;
  flex: number;
}
export interface Bar {
  key: string;
  /** Nhãn ngày `tháng/ngày` chỉ ở vị trí đầu, giữa, cuối. */
  label: string | null;
  title: string;
  /** 0 khi ngày không có dữ liệu (vẽ thanh rỗng). */
  heightPct: number;
  segments: BarSegment[];
}

const dayLabel = (date: string, index: number, count: number): string | null => {
  if (index !== 0 && index !== 6 && index !== count - 1) return null;
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
};

export const RUN_COLORS = {
  succeeded: 'var(--status-task-icon-done)',
  recovered: 'var(--status-task-todo)',
  failed: 'var(--status-task-icon-blocked)',
  other: 'var(--hex-737373)',
} as const;

const empty = (date: string): DashboardRunActivityDay => ({
  date,
  succeeded: 0,
  failed: 0,
  recovered: 0,
  other: 0,
  total: 0,
  failedByErrorCode: {},
});

/** Thanh run theo ngày, xếp chồng thành công, phục hồi, lỗi, khác. Không có dữ liệu thì dùng 14 ngày trống. */
export function runActivityBars(
  activity: readonly DashboardRunActivityDay[],
  title: (d: DashboardRunActivityDay) => string,
): Bar[] {
  const days = activity.length > 0 ? [...activity] : last14Days().map(empty);
  const max = Math.max(...days.map((d) => d.total), 1);
  return days.map((d, i) => ({
    key: d.date,
    label: dayLabel(d.date, i, days.length),
    title: title(d),
    heightPct: d.total > 0 ? (d.total / max) * 100 : 0,
    segments: (['succeeded', 'recovered', 'failed', 'other'] as const)
      .filter((k) => d[k] > 0)
      .map((k) => ({ color: RUN_COLORS[k], flex: d[k] })),
  }));
}

/** Thanh tỉ lệ thành công; run phục hồi (retry thành công) tính là thành công. */
export function successRateBars(
  activity: readonly DashboardRunActivityDay[],
  title: (d: DashboardRunActivityDay, rate: number) => string,
): Bar[] {
  const days = activity.length > 0 ? [...activity] : last14Days().map(empty);
  return days.map((d, i) => {
    const rate = d.total > 0 ? (d.succeeded + d.recovered) / d.total : 0;
    const color =
      rate >= 0.8 ? RUN_COLORS.succeeded : rate >= 0.5 ? 'var(--hex-eab308)' : 'var(--status-task-icon-blocked)';
    return {
      key: d.date,
      label: dayLabel(d.date, i, days.length),
      title: title(d, rate),
      heightPct: Math.round(rate * 10_000) / 100,
      segments: d.total > 0 ? [{ color, flex: 1 }] : [],
    };
  });
}

export const STATUS_ORDER = ['todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled', 'backlog'] as const;
export const STATUS_COLORS: Record<string, string> = {
  todo: 'var(--status-task-todo)',
  in_progress: 'var(--status-task-icon-in_progress)',
  in_review: 'var(--status-task-in_review)',
  done: 'var(--status-task-icon-done)',
  blocked: 'var(--status-task-icon-blocked)',
  cancelled: 'var(--status-task-cancelled)',
  backlog: 'var(--project-none)',
};

/** Yêu cầu tạo trong 14 ngày gần nhất theo trạng thái. `statuses` là các trạng thái có dữ liệu, theo thứ tự cố định. */
export function issueStatusBars(
  issues: readonly { status: string; createdAt: string | Date }[],
  now: Date,
  title: (date: string, total: number) => string,
): { bars: Bar[]; statuses: string[] } {
  const days = last14Days(now);
  const grouped = new Map<string, Record<string, number>>(days.map((d) => [d, {}]));
  const seen = new Set<string>();
  for (const issue of issues) {
    const entry = grouped.get(vnDay(issue.createdAt));
    if (!entry) continue;
    entry[issue.status] = (entry[issue.status] ?? 0) + 1;
    seen.add(issue.status);
  }
  const statuses = STATUS_ORDER.filter((s) => seen.has(s)) as string[];
  const totals = days.map((d) => Object.values(grouped.get(d) ?? {}).reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const bars = days.map((d, i) => ({
    key: d,
    label: dayLabel(d, i, days.length),
    title: title(d, totals[i]),
    heightPct: totals[i] > 0 ? (totals[i] / max) * 100 : 0,
    segments: statuses
      .filter((s) => (grouped.get(d)?.[s] ?? 0) > 0)
      .map((s) => ({ color: STATUS_COLORS[s], flex: grouped.get(d)?.[s] ?? 0 })),
  }));
  return { bars, statuses };
}

/** Banner đầu trang: company chưa có agent, hoặc mọi agent đều tạm dừng (nhìn ngoài không khác company hỏng). */
export function pausedBanner(agents: readonly { status: string }[] | undefined): 'no-agents' | 'all-paused' | null {
  if (!agents) return null;
  if (agents.length === 0) return 'no-agents';
  return agents.every((a) => a.status === 'paused') ? 'all-paused' : null;
}

interface ActivityRef {
  entityType: string;
  entityId: string;
  details: Record<string, unknown> | null;
}
interface ActivityCtx {
  base: string;
  issues: Map<string, { identifier: string | null; title: string }>;
  agents: Map<string, string>;
  projects: Map<string, string>;
}
export interface ActivityTarget {
  label: string | null;
  title?: string;
  /** Có khi đích là yêu cầu: dòng mở popup thay vì sang trang. */
  issueIdentifier?: string;
  href: string | null;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Đích của một dòng hoạt động: nhãn, tiêu đề và link tới thực thể. */
export function activityTarget(event: ActivityRef, ctx: ActivityCtx): ActivityTarget {
  switch (event.entityType) {
    case 'issue': {
      const known = ctx.issues.get(event.entityId);
      const identifier = known?.identifier ?? str(event.details?.identifier);
      const title = known?.title ?? str(event.details?.issueTitle);
      if (!identifier) return { label: null, title, href: null };
      return { label: identifier, title, issueIdentifier: identifier, href: null };
    }
    case 'agent':
      return { label: ctx.agents.get(event.entityId) ?? null, href: `${ctx.base}/agents/${event.entityId}` };
    case 'project':
      return { label: ctx.projects.get(event.entityId) ?? null, href: `${ctx.base}/projects/${event.entityId}` };
    case 'heartbeat_run': {
      const agentId = str(event.details?.agentId);
      return { label: agentId ? (ctx.agents.get(agentId) ?? null) : null, href: `${ctx.base}/runs/${event.entityId}` };
    }
    default:
      return { label: null, href: null };
  }
}
