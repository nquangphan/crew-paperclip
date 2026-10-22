// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JevRequestMap } from '@/api';
import { jevBadgeTone, RoadmapJevBadge, RoadmapLegend } from '@/ds';
import { buildRequestLevel, roadmapJev } from '@/features/roadmap/roadmap-model';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const ROOT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CHILD = 'aaaaaaaa-0000-4000-8000-000000000002';
const QUIET = 'aaaaaaaa-0000-4000-8000-000000000003';

const map: JevRequestMap = {
  enabled: true,
  byIssue: {
    [ROOT]: { calls: 5, deny: 2, appliedDeny: 2, escalate: 0, error: 0 },
    [CHILD]: { calls: 184, deny: 1, appliedDeny: 0, escalate: 1, error: 0 },
    [QUIET]: { calls: 9, deny: 0, appliedDeny: 0, escalate: 0, error: 0 },
  },
  shadowMismatch: { [CHILD]: 2, 'aaaaaaaa-0000-4000-8000-000000000009': 1 },
};

const issue = (id: string, parentId: string | null, title: string) =>
  ({
    id,
    parentId,
    title,
    identifier: `TPS-${title}`,
    status: 'in_progress',
    assigneeAgentId: null,
    blockedBy: [],
  }) as never;

describe('huy hiệu Jev trên bản đồ', () => {
  it('đỏ khi có lệnh bị chặn thật, vàng khi chỉ có deny ghi log hoặc không chắc, xám khi chỉ lệnh cho qua', () => {
    const base = { calls: 1, deny: 0, appliedDeny: 0, escalate: 0, error: 0, mismatch: 0 };
    expect(jevBadgeTone({ ...base, deny: 2, appliedDeny: 1 })).toBe('blocked');
    expect(jevBadgeTone({ ...base, deny: 2 })).toBe('attention');
    expect(jevBadgeTone({ ...base, escalate: 1 })).toBe('attention');
    expect(jevBadgeTone(base)).toBe('quiet');
  });

  it('hiện chữ và tooltip đủ số, chấm khi có ca lệch C3', () => {
    render(<RoadmapJevBadge jev={{ calls: 184, deny: 3, appliedDeny: 2, escalate: 1, error: 0, mismatch: 2 }} />);
    const badge = document.querySelector('[data-slot="roadmap-jev"]') as HTMLElement;
    expect(badge.dataset.tone).toBe('blocked');
    expect(badge.textContent).toBe('2 chặn');
    expect(badge.title).toBe('Jev: 184 lệnh · 2 chặn thật · 1 deny chỉ ghi log · 1 không chắc · 0 lỗi · 2 ca lệch C3');
    expect(document.querySelector('[data-slot="roadmap-jev-mismatch"]')).not.toBeNull();
  });

  it('thẻ chỉ có lệnh cho qua hiện số lệnh, màu xám, không có chấm', () => {
    render(<RoadmapJevBadge jev={{ calls: 9, deny: 0, appliedDeny: 0, escalate: 0, error: 0, mismatch: 0 }} />);
    const badge = document.querySelector('[data-slot="roadmap-jev"]') as HTMLElement;
    expect(badge.dataset.tone).toBe('quiet');
    expect(badge.textContent).toBe('9 lệnh');
    expect(document.querySelector('[data-slot="roadmap-jev-mismatch"]')).toBeNull();
  });

  it('không dùng tím (đang làm) hay xanh ngọc (đang duyệt)', () => {
    for (const jev of [
      { calls: 1, deny: 1, appliedDeny: 1, escalate: 0, error: 0, mismatch: 1 },
      { calls: 1, deny: 1, appliedDeny: 0, escalate: 0, error: 0, mismatch: 0 },
      { calls: 1, deny: 0, appliedDeny: 0, escalate: 0, error: 0, mismatch: 0 },
    ]) {
      const { container, unmount } = render(<RoadmapJevBadge jev={jev} />);
      expect(container.innerHTML).not.toMatch(/in_progress|in_review|qc_verified/);
      unmount();
    }
  });
});

describe('dữ liệu Jev của tầng yêu cầu', () => {
  it('roadmapJev: không có lệnh và không có ca lệch thì không có huy hiệu; không phân biệt hoa thường', () => {
    expect(roadmapJev(undefined, ROOT)).toBeUndefined();
    expect(roadmapJev(map, 'aaaaaaaa-0000-4000-8000-0000000000ff')).toBeUndefined();
    expect(roadmapJev(map, ROOT.toUpperCase())).toEqual({
      calls: 5,
      deny: 2,
      appliedDeny: 2,
      escalate: 0,
      error: 0,
      mismatch: 0,
    });
    expect(roadmapJev({ ...map, byIssue: {} }, CHILD)).toEqual({
      calls: 0,
      deny: 0,
      appliedDeny: 0,
      escalate: 0,
      error: 0,
      mismatch: 2,
    });
  });

  it('buildRequestLevel gắn huy hiệu cho thẻ gốc và thẻ việc con có dữ liệu, thẻ khác không có', () => {
    const level = buildRequestLevel({
      request: issue(ROOT, null, 'root'),
      descendants: [
        issue(CHILD, ROOT, 'c1'),
        issue(QUIET, ROOT, 'c2'),
        issue('bbbbbbbb-0000-4000-8000-000000000001', ROOT, 'c3'),
      ],
      jev: map,
    });
    expect(level.center.jev?.appliedDeny).toBe(2);
    const byId = new Map(level.nodes.map((n) => [n.id, n]));
    expect(byId.get(CHILD)?.jev).toMatchObject({ escalate: 1, mismatch: 2 });
    expect(byId.get(QUIET)?.jev).toMatchObject({ calls: 9 });
    expect(byId.get('bbbbbbbb-0000-4000-8000-000000000001')?.jev).toBeUndefined();
  });

  it('chưa có dữ liệu Jev (không phải owner hoặc Jev tắt) thì bản đồ không có huy hiệu nào', () => {
    const level = buildRequestLevel({ request: issue(ROOT, null, 'root'), descendants: [issue(CHILD, ROOT, 'c1')] });
    expect(level.center.jev).toBeUndefined();
    expect(level.nodes.every((n) => n.jev === undefined)).toBe(true);
  });
});

describe('chú thích bản đồ', () => {
  it('có mục Jev khi bản đồ có huy hiệu, không có khi không', () => {
    const { rerender } = render(<RoadmapLegend jev />);
    expect(document.querySelectorAll('[data-slot="roadmap-legend-jev"]')).toHaveLength(4);
    expect(screen.getByText('Jev: có lệnh bị chặn thật')).toBeTruthy();
    rerender(<RoadmapLegend />);
    expect(document.querySelectorAll('[data-slot="roadmap-legend-jev"]')).toHaveLength(0);
  });
});
