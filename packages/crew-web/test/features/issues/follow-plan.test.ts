import { describe, expect, it } from 'vitest';
import { canFollowPlan, followPlanInitial, parsePlanSource } from '@/features/issues/new/follow-plan';

const SUMMARY = [
  'Viết kế hoạch đăng nhập.',
  '',
  '### Kế hoạch',
  '- File kế hoạch: `plans/261023-1500-login/plan.md`',
  '- Pull request: https://github.com/acme/app/pull/42',
].join('\n');

const ISSUE = {
  id: 'i1',
  identifier: 'TPS-7',
  title: 'Kế hoạch đăng nhập',
  description: SUMMARY,
  projectId: 'p1',
  parentId: null,
  status: 'done',
  labels: [{ id: 'l-plan', name: 'plan' }],
};

describe('parsePlanSource', () => {
  it('đọc đường dẫn plan và link pull request từ mục tổng kết', () => {
    expect(parsePlanSource(SUMMARY)).toEqual({
      path: 'plans/261023-1500-login/plan.md',
      prUrl: 'https://github.com/acme/app/pull/42',
    });
  });

  it('thiếu dòng nào thì phần đó null', () => {
    expect(parsePlanSource('- Pull request: https://github.com/a/b/pull/1')).toEqual({
      path: null,
      prUrl: 'https://github.com/a/b/pull/1',
    });
    expect(parsePlanSource('- File kế hoạch: `docs/plan.md`')).toEqual({ path: 'docs/plan.md', prUrl: null });
    expect(parsePlanSource(null)).toEqual({ path: null, prUrl: null });
  });

  it('bỏ link không phải http(s) và đường dẫn rỗng', () => {
    expect(parsePlanSource('- Pull request: javascript:alert(1)\n- File kế hoạch: ``')).toEqual({
      path: null,
      prUrl: null,
    });
  });
});

describe('followPlanInitial', () => {
  it('điền project, loại Code, tiêu đề và mô tả đủ ba dòng', () => {
    expect(followPlanInitial(ISSUE)).toEqual({
      projectId: 'p1',
      kind: 'code',
      title: 'Làm theo kế hoạch: Kế hoạch đăng nhập',
      description: [
        'crew-from-plan plans/261023-1500-login/plan.md',
        'Kế hoạch: TPS-7 · PR: https://github.com/acme/app/pull/42',
        'Merge PR kế hoạch trước khi bắt đầu làm.',
      ].join('\n'),
    });
  });

  it('không đọc được path thì bỏ dòng crew-from-plan, vẫn còn mã issue và PR', () => {
    const initial = followPlanInitial({ ...ISSUE, description: '- Pull request: https://github.com/a/b/pull/1' });
    expect(initial.description).toBe(
      'Kế hoạch: TPS-7 · PR: https://github.com/a/b/pull/1\nMerge PR kế hoạch trước khi bắt đầu làm.',
    );
  });

  it('không có PR thì chỉ còn mã issue, không nhắc merge', () => {
    const initial = followPlanInitial({ ...ISSUE, description: '- File kế hoạch: `p.md`' });
    expect(initial.description).toBe('crew-from-plan p.md\nKế hoạch: TPS-7');
  });

  it('thiếu cả hai thì mô tả chỉ có mã issue; không project thì chuỗi rỗng', () => {
    const initial = followPlanInitial({ ...ISSUE, description: '', projectId: null });
    expect(initial.description).toBe('Kế hoạch: TPS-7');
    expect(initial.projectId).toBe('');
  });
});

describe('canFollowPlan', () => {
  it('chỉ gốc nhãn plan đã xong', () => {
    expect(canFollowPlan(ISSUE)).toBe(true);
    expect(canFollowPlan({ ...ISSUE, status: 'in_review' })).toBe(false);
    expect(canFollowPlan({ ...ISSUE, parentId: 'i0' })).toBe(false);
    expect(canFollowPlan({ ...ISSUE, labels: [{ id: 'l', name: 'docs' }] })).toBe(false);
    expect(canFollowPlan({ ...ISSUE, labels: [] })).toBe(false);
  });
});
