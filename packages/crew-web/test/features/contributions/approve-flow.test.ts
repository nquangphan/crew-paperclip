import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, type Contribution, type ContributionApproval } from '@/api';
import {
  type ApproveDeps,
  ApproveError,
  approveContribution,
  contributionErrorKey,
  contributionFromError,
  type IssueApprovalChoices,
} from '@/features/contributions/approve-flow';
import { initI18n, setLanguage } from '@/i18n';
import { contribution } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});

const ISSUE = contribution({
  id: 'k1',
  kind: 'issue',
  projectId: 'p1',
  targetIssueId: null,
  title: 'Cần banner mới',
  body: 'Chi tiết banner',
});
const COMMENT = contribution({ id: 'k2', kind: 'comment', targetIssueId: 'i1', body: 'Thêm ảnh' });

const CHOICES: IssueApprovalChoices = {
  projectId: 'p1',
  assigneeAgentId: 'a-assistant',
  kind: 'code',
  researchLabelId: null,
  draft: false,
};

const approval = (c: Contribution): ContributionApproval => ({
  contribution: { ...c, status: 'approving' },
  materialize:
    c.kind === 'issue'
      ? {
          kind: 'issue',
          companyId: 'c1',
          projectId: c.projectId as string,
          title: c.title as string,
          description: c.body,
          idempotencyKey: `crew-contribution:${c.id}`,
        }
      : { kind: 'comment', issueId: c.targetIssueId as string, body: c.body as string, clientRequestId: c.id },
});

/** Deps giả ghi lại thứ tự gọi. */
function fakeDeps(over: Partial<ApproveDeps> = {}) {
  const order: string[] = [];
  const deps: ApproveDeps = {
    approve: vi.fn(async (_c: string, id: string) => {
      order.push('approve');
      return approval(id === ISSUE.id ? ISSUE : COMMENT);
    }),
    createIssue: vi.fn(async () => {
      order.push('createIssue');
      return { id: 'i-new' };
    }),
    addComment: vi.fn(async () => {
      order.push('addComment');
      return { id: 'cm-new' };
    }),
    complete: vi.fn(async (_c: string, id: string) => {
      order.push('complete');
      return { ...(id === ISSUE.id ? ISSUE : COMMENT), status: 'approved' as const };
    }),
    ...over,
  };
  return { deps, order };
}

describe('approveContribution', () => {
  it('yêu cầu: khóa → tạo issue qua route stock kèm idempotencyKey → complete', async () => {
    const { deps, order } = fakeDeps();
    const done = await approveContribution('c1', ISSUE, CHOICES, deps);
    expect(order).toEqual(['approve', 'createIssue', 'complete']);
    expect(done.status).toBe('approved');
    expect(deps.createIssue).toHaveBeenCalledWith('c1', {
      title: 'Cần banner mới',
      description: 'Chi tiết banner',
      projectId: 'p1',
      assigneeAgentId: 'a-assistant',
      status: 'todo',
      idempotencyKey: 'crew-contribution:k1',
    });
  });

  it('lưu nháp gửi backlog; loại Nghiên cứu gắn nhãn research; project do owner chọn', async () => {
    const { deps } = fakeDeps();
    await approveContribution(
      'c1',
      ISSUE,
      { ...CHOICES, projectId: 'p2', draft: true, kind: 'research', researchLabelId: 'l-r' },
      deps,
    );
    expect(deps.createIssue).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ status: 'backlog', projectId: 'p2', labelIds: ['l-r'] }),
    );
  });

  it('bình luận: khóa → đăng bình luận với clientRequestId = id mục → complete, không cờ reopen/resume', async () => {
    const { deps, order } = fakeDeps();
    await approveContribution('c1', COMMENT, null, deps);
    expect(order).toEqual(['approve', 'addComment', 'complete']);
    expect(deps.addComment).toHaveBeenCalledWith('i1', 'Thêm ảnh', 'k2');
    expect(deps.createIssue).not.toHaveBeenCalled();
  });

  it('bước đăng lỗi: ném ApproveError ở bước post, không gọi complete, giữ nguyên câu lỗi', async () => {
    const { deps, order } = fakeDeps({
      addComment: vi.fn(async () => {
        throw new ApiError(500, 'Lỗi máy chủ khi lưu bình luận');
      }),
    });
    const error = await approveContribution('c1', COMMENT, null, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApproveError);
    expect((error as ApproveError).step).toBe('post');
    expect((error as ApproveError).message).toBe('Lỗi máy chủ khi lưu bình luận');
    expect(order).toEqual(['approve']);
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('duyệt lại sau khi đứt giữa chừng dùng lại đúng khóa idempotent server trả', async () => {
    let fail = true;
    const { deps } = fakeDeps({
      createIssue: vi.fn(async () => {
        if (fail) {
          fail = false;
          throw new ApiError(0, 'Failed to fetch', 'network');
        }
        return { id: 'i-new' };
      }),
    });
    await expect(approveContribution('c1', ISSUE, CHOICES, deps)).rejects.toBeInstanceOf(ApproveError);
    await approveContribution('c1', ISSUE, CHOICES, deps);
    const keys = vi.mocked(deps.createIssue).mock.calls.map(([, body]) => body.idempotencyKey);
    expect(keys).toEqual(['crew-contribution:k1', 'crew-contribution:k1']);
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });

  it('complete trả 409 chưa thấy bản ghi: báo bấm Duyệt lại', async () => {
    const { deps } = fakeDeps({
      complete: vi.fn(async () => {
        throw new ApiError(409, 'not materialized', 'crew_contribution_not_materialized');
      }),
    });
    const error = await approveContribution('c1', COMMENT, null, deps).catch((e: unknown) => e);
    expect((error as ApproveError).step).toBe('complete');
    expect(contributionErrorKey(error)).toBe('errors.crew_contribution_not_materialized');
  });

  it('khóa lỗi (owner khác đang duyệt) thì không đăng gì', async () => {
    const { deps, order } = fakeDeps({
      approve: vi.fn(async () => {
        throw new ApiError(409, 'locked', 'crew_contribution_locked');
      }),
    });
    const error = await approveContribution('c1', ISSUE, CHOICES, deps).catch((e: unknown) => e);
    expect((error as ApproveError).step).toBe('lock');
    expect(contributionErrorKey(error)).toBe('errors.crew_contribution_locked');
    expect(order).toEqual([]);
  });

  it('yêu cầu loại Nghiên cứu mà company chưa có nhãn: lỗi trước khi khóa', async () => {
    const { deps } = fakeDeps();
    await expect(
      approveContribution('c1', ISSUE, { ...CHOICES, kind: 'research', researchLabelId: null }, deps),
    ).rejects.toThrow('research');
    expect(deps.approve).not.toHaveBeenCalled();
  });

  it('yêu cầu thiếu lựa chọn duyệt thì không khóa', async () => {
    const { deps } = fakeDeps();
    await expect(approveContribution('c1', ISSUE, null, deps)).rejects.toThrow();
    expect(deps.approve).not.toHaveBeenCalled();
  });
});

describe('contributionErrorKey và contributionFromError', () => {
  it('mã lỗi của router góp ý có câu riêng; 404 của router là không tìm thấy mục', () => {
    for (const code of [
      'crew_contribution_decided',
      'crew_contribution_not_approving',
      'crew_contribution_already_approved',
      'crew_contribution_invalid',
      'crew_contribution_invalid_target',
    ]) {
      expect(contributionErrorKey(new ApiError(409, 'x', code))).toBe(`errors.${code}`);
    }
    expect(contributionErrorKey(new ApiError(404, 'Not found'))).toBe('errors.notFound');
  });

  it('lỗi của route stock ở bước đăng hiện nguyên văn (kể cả 404 issue đích)', () => {
    expect(contributionErrorKey(new ApproveError('post', new ApiError(404, 'Issue not found')))).toBeNull();
    expect(contributionErrorKey(new ApproveError('post', new ApiError(422, 'Invalid assignee')))).toBeNull();
    expect(contributionErrorKey(new Error('mạng'))).toBeNull();
  });

  it('409 kèm mục mới nhất thì trả mục đó để làm tươi; lỗi khác thì null', () => {
    const latest = { ...COMMENT, status: 'approved' as const, resultCommentId: 'cm1' };
    const body = { error: 'đã duyệt', code: 'crew_contribution_already_approved', contribution: latest };
    const err = new ApiError(409, 'đã duyệt', 'crew_contribution_already_approved', body);
    expect(contributionFromError(err)).toEqual(latest);
    expect(contributionFromError(new ApproveError('lock', err))).toEqual(latest);
    expect(contributionFromError(new ApiError(409, 'x', 'y', { error: 'x' }))).toBeNull();
    expect(contributionFromError(new ApiError(500, 'x', null, body))).toBeNull();
  });
});
