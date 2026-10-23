// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FollowPlanAction } from '@/features/issues/new/follow-plan-action';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { ISSUE, mount } from './detail-fixtures';

vi.mock('@/features/readiness', () => ({
  useProjectReadiness: () => ({
    isLoading: false,
    data: [{ projectId: 'p1', state: 'ready', failed: [], agents: [] }],
  }),
}));

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
});
afterEach(cleanup);

const PLAN = {
  ...ISSUE,
  id: 'i-plan',
  identifier: 'TPS-7',
  title: 'Kế hoạch đăng nhập',
  parentId: null,
  ancestors: [],
  status: 'done',
  labels: [{ id: 'l-plan', name: 'plan' }],
  description:
    'Xong.\n\n### Kế hoạch\n- File kế hoạch: `plans/261023-1500-login/plan.md`\n- Pull request: https://github.com/acme/app/pull/42',
};

const routes = (over: Record<string, unknown> = {}) =>
  ({
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': { body: [{ id: 'a-assist', name: 'Trợ Lý Alpha' }] },
    'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: { assistantAgentId: 'a-assist' } } },
    'GET /api/companies/c1/labels': { body: [{ id: 'l-plan', name: 'plan' }] },
    'POST /api/companies/c1/issues': { status: 201, body: { id: 'i-new', identifier: 'TPS-8' } },
    ...over,
  }) as Parameters<typeof mockServer>[0];

const BUTTON = 'Làm theo kế hoạch này';

describe('FollowPlanAction', () => {
  it('gốc nhãn plan đã xong: bấm mở hộp Yêu cầu mới loại Code điền sẵn, tạo xong báo mã yêu cầu mới', async () => {
    const s = mockServer(routes());
    mount(<FollowPlanAction issue={PLAN as never} />);
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Tiêu đề') as HTMLInputElement).value).toBe(
      'Làm theo kế hoạch: Kế hoạch đăng nhập',
    );
    expect((within(dialog).getByLabelText('Mô tả') as HTMLTextAreaElement).value).toBe(
      [
        'crew-from-plan plans/261023-1500-login/plan.md',
        'Kế hoạch: TPS-7 · PR: https://github.com/acme/app/pull/42',
        'Merge PR kế hoạch trước khi bắt đầu làm.',
      ].join('\n'),
    );
    expect(within(dialog).getByRole('combobox', { name: 'Loại' }).textContent).toBe('Code');
    expect(await within(dialog).findByText('Trợ Lý Alpha')).toBeTruthy();
    const create = within(dialog).getByRole('button', { name: 'Tạo' }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = s.calls.find((c) => c.method === 'POST' && c.url === '/api/companies/c1/issues');
    expect(post?.body).toMatchObject({ projectId: 'p1', assigneeAgentId: 'a-assist' });
    expect(post?.body).not.toHaveProperty('labelIds');
    expect(await screen.findByText('Đã tạo yêu cầu TPS-8.')).toBeTruthy();
  });

  it('không có nút khi chưa xong, không nhãn plan, là việc con hoặc người xem chỉ đọc', async () => {
    const cases: [object, Record<string, unknown>][] = [
      [{ ...PLAN, status: 'in_review' }, {}],
      [{ ...PLAN, labels: [{ id: 'l-docs', name: 'docs' }] }, {}],
      [{ ...PLAN, parentId: 'i0' }, {}],
      [PLAN, accessRoute('c1', { userId: 'u1', membershipRole: 'viewer', contributor: false })],
    ];
    for (const [issue, extra] of cases) {
      const s = mockServer(routes(extra));
      mount(<FollowPlanAction issue={issue as never} />);
      await waitFor(() => expect(s.calls.length).toBeGreaterThanOrEqual(0));
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
      cleanup();
    }
  });
});
