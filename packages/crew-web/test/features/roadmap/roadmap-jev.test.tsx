// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JevRequestMap } from '@/api';
import { jevBadgeTone, RoadmapComplexityFlag, RoadmapJevBadge, RoadmapLegend } from '@/ds';
import { buildRequestLevel, roadmapJev, roadmapJevComplexity } from '@/features/roadmap/roadmap-model';
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
    // Response sai dạng (proxy trả JSON lạ): không ném lỗi, không huy hiệu.
    expect(roadmapJev({} as JevRequestMap, ROOT)).toBeUndefined();
    expect(roadmapJev({ byIssue: null } as unknown as JevRequestMap, ROOT)).toBeUndefined();
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

describe('cờ complexity "Jev: nên là large"', () => {
  const flagMap = {
    ...map,
    complexityFlags: {
      [CHILD]: { kind: 'jev', jevSaysLarge: true, declared: 'small', reason: 'Chạm migration CSDL.' },
      [QUIET]: { kind: 'vision', jevSaysLarge: false, declared: 'small', reason: 'Việc có ảnh.' },
    },
  } as unknown as JevRequestMap;

  it('roadmapJevComplexity lấy cờ theo issue, thiếu hay sai dạng thì không có', () => {
    expect(roadmapJevComplexity(flagMap, CHILD.toUpperCase())).toEqual({
      kind: 'jev',
      declared: 'small',
      reason: 'Chạm migration CSDL.',
    });
    expect(roadmapJevComplexity(flagMap, ROOT)).toBeUndefined();
    expect(roadmapJevComplexity(undefined, CHILD)).toBeUndefined();
    expect(roadmapJevComplexity(map, CHILD)).toBeUndefined();
    expect(roadmapJevComplexity({ ...map, complexityFlags: 'x' } as never, CHILD)).toBeUndefined();
  });

  it('buildRequestLevel gắn cờ cho đúng thẻ', () => {
    const level = buildRequestLevel({
      request: issue(ROOT, null, 'root'),
      descendants: [issue(CHILD, ROOT, 'c1'), issue(QUIET, ROOT, 'c2')],
      jev: flagMap,
    });
    const byId = new Map(level.nodes.map((n) => [n.id, n]));
    expect(byId.get(CHILD)?.jevComplexity?.kind).toBe('jev');
    expect(byId.get(QUIET)?.jevComplexity?.kind).toBe('vision');
    expect(level.center.jevComplexity).toBeUndefined();
  });

  it('thẻ hiện chữ cảnh báo, tooltip có mức đã khai và lý do, màu cảnh báo (không tím/xanh ngọc)', () => {
    const { container } = render(
      <RoadmapComplexityFlag flag={{ kind: 'jev', declared: 'small', reason: 'Chạm migration CSDL.' }} />,
    );
    const el = document.querySelector('[data-slot="roadmap-jev-complexity"]') as HTMLElement;
    expect(el.textContent).toBe('Jev: nên là large');
    expect(el.title).toBe('Jev: nên là large. Trợ Lý xếp: small. Chạm migration CSDL.');
    expect(container.innerHTML).not.toMatch(/in_progress|in_review|qc_verified/);
    expect(el.style.color).toBe('var(--roadmap-tone-todo)');
  });

  it('không có lý do thì dùng câu mặc định; vision có tiêu đề riêng', () => {
    render(<RoadmapComplexityFlag flag={{ kind: 'vision', declared: null, reason: null }} />);
    const el = document.querySelector('[data-slot="roadmap-jev-complexity"]') as HTMLElement;
    expect(el.textContent).toBe('Jev: model không xem được ảnh');
    expect(el.title).toBe('Jev: model không xem được ảnh. Jev thấy việc này chạm vùng nhạy cảm.');
  });

  it('chú thích có mục cờ chỉ khi bản đồ có thẻ mang cờ', () => {
    const { rerender } = render(<RoadmapLegend jevComplexity />);
    expect(document.querySelectorAll('[data-slot="roadmap-legend-complexity"]')).toHaveLength(1);
    rerender(<RoadmapLegend />);
    expect(document.querySelector('[data-slot="roadmap-legend-complexity"]')).toBeNull();
  });
});
