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
  kindLabelIds: { research: 'l-research', docs: 'l-docs', plan: 'l-plan' },
  draft: false,
  files: [] as File[],
  machineId: null,
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

  it('Lập kế hoạch gửi nhãn plan', () => {
    expect(buildCreateBody({ ...base, kind: 'plan' })).toMatchObject({ labelIds: ['l-plan'] });
    expect(() => buildCreateBody({ ...base, kind: 'plan', kindLabelIds: { ...base.kindLabelIds, plan: null } })).toThrow(
      'Company chưa có nhãn “plan” nên chưa chọn được loại Lập kế hoạch.',
    );
  });

  it('Viết tài liệu gửi nhãn docs', () => {
    expect(buildCreateBody({ ...base, kind: 'docs' })).toMatchObject({ labelIds: ['l-docs'] });
  });

  it('Nghiên cứu hay Viết tài liệu mà không có nhãn thì ném lỗi, không gửi thiếu nhãn', () => {
    expect(() =>
      buildCreateBody({ ...base, kind: 'research', kindLabelIds: { research: null, docs: 'l-docs', plan: null } }),
    ).toThrow();
    expect(() =>
      buildCreateBody({ ...base, kind: 'docs', kindLabelIds: { research: 'l-research', docs: null, plan: null } }),
    ).toThrow('Company chưa có nhãn “docs” nên chưa chọn được loại Viết tài liệu.');
  });

  it('câu lỗi thiếu nhãn research theo ngôn ngữ đang chọn', async () => {
    await setLanguage('en');
    expect(() => buildCreateBody({ ...base, kind: 'research', kindLabelIds: { research: null, docs: null, plan: null } })).toThrow(
      'The company has no “research” label, so the Research type is unavailable.',
    );
    await setLanguage('vi');
    expect(() => buildCreateBody({ ...base, kind: 'research', kindLabelIds: { research: null, docs: null, plan: null } })).toThrow(
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

  it('có máy: tạo nháp, ghim máy, upload, rồi mới chuyển Cần làm', async () => {
    const order: string[] = [];
    mockServer({
      'POST /api/companies/c1/issues': (init) => {
        order.push(`create:${JSON.parse(String(init?.body)).status}`);
        return { status: 201, body: { id: 'i1', identifier: 'TPS-9', status: 'backlog' } };
      },
      'PUT /api/crew/companies/c1/issues/i1/machine': () => {
        order.push('pin');
        return { body: { rootIssueId: 'i1', isRoot: true, locked: false, pin: null } };
      },
      'POST /api/companies/c1/issues/i1/attachments': () => {
        order.push('upload');
        return { status: 201, body: { id: 'att' } };
      },
      'PATCH /api/issues/i1': () => {
        order.push('todo');
        return { body: { id: 'i1', identifier: 'TPS-9', status: 'todo' } };
      },
    });
    const result = await createRequest({ ...base, kind: 'code', machineId: 'm-mini', files: [new File(['1'], 'a.png')] });
    expect(order).toEqual(['create:backlog', 'pin', 'upload', 'todo']);
    expect(result).toMatchObject({ machineError: null, failedUploads: [], issue: { status: 'todo' } });
  });

  it('ghim máy lỗi: yêu cầu ở lại nháp, lỗi trả về, không chuyển Cần làm', async () => {
    const { calls } = mockServer({
      'POST /api/companies/c1/issues': { status: 201, body: { id: 'i1', identifier: 'TPS-9', status: 'backlog' } },
      'PUT /api/crew/companies/c1/issues/i1/machine': {
        status: 409,
        body: { error: 'Project chưa có origin repo: nhập ở trang project → Máy.' },
      },
    });
    const result = await createRequest({ ...base, kind: 'code', machineId: 'm-mini', files: [] });
    expect(result.machineError).toContain('Project chưa có origin repo');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
