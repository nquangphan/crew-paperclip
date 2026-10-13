import type { Issue } from '@paperclipai/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  type AddChildDeps,
  AddChildStaleError,
  addChildAvailability,
  buildChildBody,
  newAddChildProgress,
  runAddChild,
} from '@/features/issues/new/add-child';

const ROOT = { id: 'i-root', status: 'in_progress', parentId: null, projectId: 'p1', executionState: null };

describe('addChildAvailability', () => {
  it('mở khi gốc Crew đang ở bước Trợ Lý (Cần làm, Đang làm, Bị chặn)', () => {
    for (const status of ['todo', 'in_progress', 'blocked']) {
      expect(addChildAvailability({ ...ROOT, status }, true)).toEqual({ kind: 'open' });
    }
    // Sau Yêu cầu sửa: gốc về Trợ Lý, state `changes_requested` không phải stage đang chờ.
    expect(addChildAvailability({ ...ROOT, executionState: { status: 'changes_requested' } }, true)).toEqual({
      kind: 'open',
    });
  });

  it('ẩn với yêu cầu không phải gốc Crew, việc con, yêu cầu đã xong hay đã hủy', () => {
    expect(addChildAvailability(ROOT, false)).toEqual({ kind: 'hidden' });
    expect(addChildAvailability({ ...ROOT, parentId: 'i-0' }, true)).toEqual({ kind: 'hidden' });
    expect(addChildAvailability({ ...ROOT, status: 'done' }, true)).toEqual({ kind: 'hidden' });
    expect(addChildAvailability({ ...ROOT, status: 'cancelled' }, true)).toEqual({ kind: 'hidden' });
  });

  it('nháp và yêu cầu đã qua bước Trợ Lý: nút vẫn hiện, dialog giải thích', () => {
    expect(addChildAvailability({ ...ROOT, status: 'backlog' }, true)).toEqual({ kind: 'blocked', reason: 'draft' });
    expect(addChildAvailability({ ...ROOT, status: 'in_review' }, true)).toEqual({ kind: 'blocked', reason: 'review' });
    expect(addChildAvailability({ ...ROOT, executionState: { status: 'pending' } }, true)).toEqual({
      kind: 'blocked',
      reason: 'review',
    });
  });
});

describe('buildChildBody', () => {
  const input = {
    root: { id: 'i-root', projectId: 'p1' },
    title: '  Thêm nút  ',
    description: 'chi tiết',
    idempotencyKey: 'k1',
  };

  it('việc con chưa giao ai, không policy, không nhãn, không marker; chống trùng bằng khóa idempotent', () => {
    expect(buildChildBody(input)).toEqual({
      title: 'Thêm nút',
      description: 'chi tiết',
      parentId: 'i-root',
      projectId: 'p1',
      status: 'todo',
      idempotencyKey: 'k1',
      allowDuplicate: true,
    });
  });

  it('bỏ mô tả rỗng và project trống; mô tả gửi nguyên văn', () => {
    const body = buildChildBody({ ...input, root: { id: 'i-root', projectId: null }, description: '   ' });
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('projectId');
    expect(buildChildBody({ ...input, description: '    code thụt lề\n' }).description).toBe('    code thụt lề\n');
  });

  it('tiêu đề rỗng thì ném lỗi, không gửi', () => {
    expect(() => buildChildBody({ ...input, title: '  ' })).toThrow();
  });
});

describe('runAddChild', () => {
  const CHILD = { id: 'i-child', identifier: 'TPS-9', title: 'Thêm nút' } as Issue;
  const file = new File(['x'], 'a.png', { type: 'image/png' });
  const input = {
    title: 'Thêm nút',
    description: '',
    files: [file],
    idempotencyKey: 'k1',
    commentRequestId: 'c1',
    commentBody: (child: Issue) => `Đã thêm việc con ${child.identifier}`,
  };
  const deps = (over: Partial<AddChildDeps> = {}): AddChildDeps => ({
    getRoot: vi.fn(async () => ROOT),
    create: vi.fn(async () => CHILD),
    upload: vi.fn(async () => []),
    comment: vi.fn(async () => ({})),
    ...over,
  });

  it('đọc lại gốc, tạo con, upload đính kèm vào con, rồi bình luận trên gốc', async () => {
    const d = deps();
    const result = await runAddChild(d, input, newAddChildProgress());
    expect(result).toEqual({ child: CHILD, failedUploads: [] });
    expect(d.create).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'i-root', idempotencyKey: 'k1' }));
    expect(d.upload).toHaveBeenCalledWith('i-child', [file]);
    expect(d.comment).toHaveBeenCalledWith('Đã thêm việc con TPS-9', 'c1');
  });

  it('gốc đã sang bước khác lúc gửi: không tạo gì, báo lý do và trạng thái', async () => {
    const d = deps({ getRoot: vi.fn(async () => ({ ...ROOT, status: 'in_review' })) });
    await expect(runAddChild(d, input, newAddChildProgress())).rejects.toMatchObject({
      reason: 'review',
      status: 'in_review',
    });
    expect(d.create).not.toHaveBeenCalled();
    const closed = deps({ getRoot: vi.fn(async () => ({ ...ROOT, status: 'done' })) });
    await expect(runAddChild(closed, input, newAddChildProgress())).rejects.toBeInstanceOf(AddChildStaleError);
  });

  it('bình luận lỗi: bấm lại chỉ gửi bình luận, không tạo con thứ hai, không upload lại', async () => {
    const comment = vi.fn().mockRejectedValueOnce(new Error('mạng lỗi')).mockResolvedValueOnce({});
    const d = deps({ comment, upload: vi.fn(async () => ['b.pdf']) });
    const progress = newAddChildProgress();
    await expect(runAddChild(d, input, progress)).rejects.toThrow('mạng lỗi');
    expect(progress.child).toBe(CHILD);
    const result = await runAddChild(d, input, progress);
    expect(result).toEqual({ child: CHILD, failedUploads: ['b.pdf'] });
    expect(d.getRoot).toHaveBeenCalledTimes(1);
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(d.upload).toHaveBeenCalledTimes(1);
    expect(comment).toHaveBeenCalledTimes(2);
    expect(comment.mock.calls[1]).toEqual(comment.mock.calls[0]);
  });

  it('tạo lỗi thì không upload, không bình luận; bấm lại tạo lại cùng khóa idempotent', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('422')).mockResolvedValueOnce(CHILD);
    const d = deps({ create });
    const progress = newAddChildProgress();
    await expect(runAddChild(d, input, progress)).rejects.toThrow('422');
    expect(d.upload).not.toHaveBeenCalled();
    expect(d.comment).not.toHaveBeenCalled();
    await runAddChild(d, input, progress);
    expect(create.mock.calls[1]?.[0]).toEqual(create.mock.calls[0]?.[0]);
  });
});
