import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCreateBody, createRequest } from '@/features/issues/new/use-create-request';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

beforeAll(async () => {
  await initI18n();
});
afterEach(() => vi.restoreAllMocks());

const base = {
  companyId: 'c1',
  title: 'Sửa lỗi đăng nhập',
  description: 'mô tả',
  projectId: 'p1',
  assigneeAgentId: 'a-assistant',
  researchLabelId: 'l-research',
  draft: false,
  files: [] as File[],
};

describe('buildCreateBody', () => {
  it('Code và Bug không gửi labelIds', () => {
    for (const kind of ['code', 'bug'] as const) {
      const body = buildCreateBody({ ...base, kind });
      expect(body).toEqual({
        title: 'Sửa lỗi đăng nhập',
        description: 'mô tả',
        projectId: 'p1',
        assigneeAgentId: 'a-assistant',
        status: 'todo',
      });
      expect(body).not.toHaveProperty('labelIds');
    }
  });

  it('Nghiên cứu gửi nhãn research', () => {
    expect(buildCreateBody({ ...base, kind: 'research' })).toMatchObject({ labelIds: ['l-research'] });
  });

  it('Nghiên cứu mà không có nhãn thì ném lỗi, không gửi thiếu nhãn', () => {
    expect(() => buildCreateBody({ ...base, kind: 'research', researchLabelId: null })).toThrow();
  });

  it('câu lỗi thiếu nhãn research theo ngôn ngữ đang chọn', async () => {
    await setLanguage('en');
    expect(() => buildCreateBody({ ...base, kind: 'research', researchLabelId: null })).toThrow(
      'The company has no “research” label, so the Research type is unavailable.',
    );
    await setLanguage('vi');
    expect(() => buildCreateBody({ ...base, kind: 'research', researchLabelId: null })).toThrow(
      'Company chưa có nhãn “research” nên chưa chọn được loại Nghiên cứu.',
    );
  });

  it('lưu nháp là backlog; không bao giờ có policy hay reviewer', () => {
    const body = buildCreateBody({ ...base, kind: 'research', draft: true });
    expect(body.status).toBe('backlog');
    for (const key of ['executionPolicy', 'reviewerAgentId', 'approverUserId']) expect(body).not.toHaveProperty(key);
  });

  it('cắt khoảng trắng tiêu đề; mô tả rỗng thì bỏ khóa', () => {
    const body = buildCreateBody({ ...base, kind: 'code', title: '  Tên  ', description: '   ' });
    expect(body.title).toBe('Tên');
    expect(body).not.toHaveProperty('description');
  });
});

describe('createRequest', () => {
  it('tạo issue rồi upload từng file theo thứ tự', async () => {
    const order: string[] = [];
    const { calls } = mockServer({
      'POST /api/companies/c1/issues': () => {
        order.push('create');
        return { status: 201, body: { id: 'i1', identifier: 'TPS-9' } };
      },
      'POST /api/companies/c1/issues/i1/attachments': () => {
        order.push('upload');
        return { status: 201, body: { id: 'att' } };
      },
    });
    const files = [new File(['1'], 'a.png'), new File(['2'], 'b.txt')];
    const result = await createRequest({ ...base, kind: 'code', files });
    expect(order).toEqual(['create', 'upload', 'upload']);
    expect(result.issue.id).toBe('i1');
    expect(result.failedUploads).toEqual([]);
    const uploads = calls.filter((c) => c.url.endsWith('/attachments'));
    expect((uploads[0].body as FormData).get('file')).toHaveProperty('name', 'a.png');
    expect((uploads[1].body as FormData).get('file')).toHaveProperty('name', 'b.txt');
  });

  it('upload lỗi thì issue vẫn có, tên file lỗi được trả lại và các file sau vẫn thử', async () => {
    let n = 0;
    mockServer({
      'POST /api/companies/c1/issues': { status: 201, body: { id: 'i1', identifier: 'TPS-9' } },
      'POST /api/companies/c1/issues/i1/attachments': () =>
        ++n === 1 ? { status: 422, body: { error: 'Không nhận' } } : { status: 201, body: { id: 'x' } },
    });
    const result = await createRequest({
      ...base,
      kind: 'code',
      files: [new File(['1'], 'a.zip'), new File(['2'], 'b.png')],
    });
    expect(result.failedUploads).toEqual(['a.zip']);
    expect(n).toBe(2);
  });

  it('tạo issue lỗi thì ném lỗi nguyên văn và không upload', async () => {
    const { calls } = mockServer({
      'POST /api/companies/c1/issues': { status: 422, body: { error: 'Project không hợp lệ' } },
    });
    await expect(createRequest({ ...base, kind: 'code', files: [new File(['1'], 'a.png')] })).rejects.toThrow(
      'Project không hợp lệ',
    );
    expect(calls).toHaveLength(1);
  });
});
