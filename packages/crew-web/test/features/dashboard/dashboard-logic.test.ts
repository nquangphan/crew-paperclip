import { describe, expect, it } from 'vitest';
import {
  activityTarget,
  issueStatusBars,
  last14Days,
  pausedBanner,
  runActivityBars,
  successRateBars,
} from '@/features/dashboard/dashboard-logic';

const NOW = new Date('2026-10-10T03:00:00.000Z');
const day = (date: string, o: Partial<Record<string, number>> = {}) => ({
  date,
  succeeded: 0,
  failed: 0,
  recovered: 0,
  other: 0,
  total: 0,
  failedByErrorCode: {},
  ...o,
});

describe('last14Days', () => {
  it('14 ngày kết thúc hôm nay theo giờ Asia/Ho_Chi_Minh', () => {
    const days = last14Days(new Date('2026-10-10T20:00:00.000Z'));
    expect(days).toHaveLength(14);
    expect(days[13]).toBe('2026-10-11');
    expect(days[0]).toBe('2026-09-28');
  });
});

describe('biểu đồ', () => {
  it('run activity: chiều cao theo tổng/ngày lớn nhất, nhãn ngày ở vị trí 0, 6, 13', () => {
    const bars = runActivityBars(
      [day('2026-10-09', { total: 2, succeeded: 1, failed: 1 }), day('2026-10-10', { total: 4, succeeded: 4 })],
      () => '',
    );
    expect(bars.map((b) => b.heightPct)).toEqual([50, 100]);
    expect(bars[0].segments.map((s) => s.flex)).toEqual([1, 1]);
    expect(bars[0].label).toBe('10/9');
    expect(bars[1].label).toBe('10/10');
  });
  it('run activity: ngày không có run có thanh rỗng', () => {
    const [bar] = runActivityBars([day('2026-10-10')], () => '');
    expect(bar.segments).toEqual([]);
    expect(bar.heightPct).toBe(0);
  });
  it('tỉ lệ thành công: recovered tính là thành công, màu theo ngưỡng 0.8 / 0.5', () => {
    const bars = successRateBars(
      [
        day('a', { total: 10, succeeded: 5, recovered: 3 }),
        day('b', { total: 10, succeeded: 5 }),
        day('c', { total: 10, succeeded: 1 }),
        day('d'),
      ],
      () => '',
    );
    expect(bars.map((b) => b.heightPct)).toEqual([80, 50, 10, 0]);
    expect(bars[0].segments[0].color).toBe('var(--status-task-icon-done)');
    expect(bars[1].segments[0].color).toBe('var(--hex-eab308)');
    expect(bars[2].segments[0].color).toBe('var(--status-task-icon-blocked)');
    expect(bars[3].segments).toEqual([]);
  });
  it('issue theo trạng thái: đếm theo ngày tạo (giờ VN), chỉ trạng thái có dữ liệu trong legend', () => {
    const { bars, statuses } = issueStatusBars(
      [
        { status: 'done', createdAt: '2026-10-10T01:00:00.000Z' },
        { status: 'todo', createdAt: '2026-10-10T02:00:00.000Z' },
        { status: 'todo', createdAt: '2026-10-10T02:30:00.000Z' },
        { status: 'blocked', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      NOW,
      () => '',
    );
    expect(statuses).toEqual(['todo', 'done']);
    expect(bars[13].segments.map((s) => s.flex)).toEqual([2, 1]);
    expect(bars[13].heightPct).toBe(100);
  });
});

describe('pausedBanner', () => {
  it('không có agent: no-agents; mọi agent tạm dừng: all-paused; còn lại: null', () => {
    expect(pausedBanner(undefined)).toBeNull();
    expect(pausedBanner([])).toBe('no-agents');
    expect(pausedBanner([{ status: 'paused' }, { status: 'paused' }])).toBe('all-paused');
    expect(pausedBanner([{ status: 'paused' }, { status: 'idle' }])).toBeNull();
  });
});

describe('activityTarget', () => {
  const ctx = {
    base: '/TPS',
    issues: new Map([['i1', { identifier: 'TPS-1', title: 'Làm A' }]]),
    agents: new Map([['a1', 'Executor']]),
    projects: new Map([['p1', 'Dự án X']]),
  };
  it('issue: nhãn là mã, tiêu đề, popup thay vì trang mới', () => {
    expect(activityTarget({ entityType: 'issue', entityId: 'i1', details: null }, ctx)).toEqual({
      label: 'TPS-1',
      title: 'Làm A',
      issueIdentifier: 'TPS-1',
      href: null,
    });
  });
  it('issue chưa có trong danh sách lấy tiêu đề từ details', () => {
    expect(
      activityTarget({ entityType: 'issue', entityId: 'zz', details: { issueTitle: 'T', identifier: 'TPS-7' } }, ctx),
    ).toMatchObject({ label: 'TPS-7', title: 'T', issueIdentifier: 'TPS-7' });
  });
  it('agent, project, run', () => {
    expect(activityTarget({ entityType: 'agent', entityId: 'a1', details: null }, ctx).href).toBe('/TPS/agents/a1');
    expect(activityTarget({ entityType: 'project', entityId: 'p1', details: null }, ctx)).toMatchObject({
      label: 'Dự án X',
      href: '/TPS/projects/p1',
    });
    expect(
      activityTarget({ entityType: 'heartbeat_run', entityId: 'r1', details: { agentId: 'a1' } }, ctx),
    ).toMatchObject({
      label: 'Executor',
      href: '/TPS/runs/r1',
    });
  });
  it('thực thể lạ không có link', () => {
    expect(activityTarget({ entityType: 'goal', entityId: 'g', details: null }, ctx).href).toBeNull();
  });
});
