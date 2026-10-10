// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SkillDetail } from '@/features/skills/skill-detail';
import { SkillsPage } from '@/features/skills/skills-page';
import { SyncStatus } from '@/features/skills/sync-status';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { agent, data, ID, renderPage, renderWith } from '../agents/helpers';
import { job, M1, M2, machine, ROUTE, SKILL_ID } from '../machines/fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const BASE = `/api/companies/c-tps/skills/${SKILL_ID}`;
const FORK_ID = '44444444-4444-4444-8444-444444444444';
const SKILL_MD = '---\nname: viet-test\n---\n# Viết test\n\nLàm theo TDD.';

const GITHUB = {
  id: SKILL_ID,
  key: 'github/acme/viet-test',
  slug: 'viet-test',
  name: 'Viết test',
  description: 'Viết test trước',
  tagline: null,
  categories: [],
  markdown: SKILL_MD,
  sourceType: 'github',
  sourceBadge: 'github',
  sourceLabel: 'acme/skills',
  sourceLocator: 'https://github.com/acme/skills',
  packageVersion: '1.2.0',
  currentVersionId: 'v1',
  editable: false,
  editableReason: 'Skill GitHub chỉ đọc',
  fileInventory: [{ path: 'SKILL.md', kind: 'skill' }],
  metadata: { skillSourceId: 'src1', skillSourcePath: 'skills/viet-test/SKILL.md' },
  usedByAgents: [
    { id: ID.executor, name: 'Executor Một', urlKey: 'executor-mot', adapterType: 'claude_local', desired: true },
  ],
  attachedAgentCount: 1,
};
const LOCAL = {
  ...GITHUB,
  key: 'company/viet-test',
  sourceType: 'local_path',
  sourceBadge: 'paperclip',
  sourceLabel: null,
  sourceLocator: null,
  editable: true,
  editableReason: null,
  metadata: null,
  fileInventory: [
    { path: 'SKILL.md', kind: 'skill' },
    { path: 'references/cach-viet.md', kind: 'reference' },
  ],
};
const SYNC_DONE = [
  {
    skillId: SKILL_ID,
    machineId: M1,
    kind: 'skill-sync',
    status: 'done',
    sha256: 'f'.repeat(64),
    finishedAt: '2026-10-10T01:00:00Z',
  },
];

function routes(detail: object, extra: Record<string, object> = {}) {
  return {
    [`GET ${BASE}`]: { body: detail },
    'GET /api/companies/c-tps/agents': { body: [agent()] },
    ...data('crew.machines', [machine()]),
    ...data('crew.skillSync', SYNC_DONE),
    ...data('crew.machineJobs', []),
    [`${ROUTE}/machine-jobs`]: { status: 201, body: job({ id: 'jx' }) },
    ...extra,
  };
}
const mount = () => renderPage(<SkillDetail />, { route: 'skills/:skillId', at: `/TPS/skills/${SKILL_ID}` });
const jobBodies = (calls: { url: string; body: unknown }[]) =>
  calls.filter((c) => c.url.endsWith('/machine-jobs')).map((c) => c.body as Record<string, unknown>);

describe('Sửa skill (S14.5)', () => {
  it('skill GitHub: không có trình sửa nội dung; có Cập nhật từ nguồn, Tạo bản sửa được, Đổi nguồn', async () => {
    mockServer(routes(GITHUB));
    mount();
    expect(await screen.findByText('Skill GitHub chỉ đọc')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu file' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Nội dung/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Kiểm cập nhật' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo bản sửa được' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thêm từ nguồn mới' })).toBeTruthy();
  });

  it('sửa thông tin gửi PATCH skill với mô tả, tagline, nhóm', async () => {
    const s = mockServer(routes(GITHUB, { [`PATCH ${BASE}`]: { body: GITHUB } }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thông tin' }));
    fireEvent.change(await screen.findByLabelText('Mô tả'), { target: { value: 'Mô tả mới' } });
    fireEvent.change(screen.getByLabelText('Câu giới thiệu ngắn'), { target: { value: 'TDD' } });
    fireEvent.change(screen.getByLabelText('Nhóm'), { target: { value: 'test, chất lượng ,' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH' && c.url === BASE)).toBe(true));
    expect(s.calls.find((c) => c.method === 'PATCH' && c.url === BASE)?.body).toEqual({
      description: 'Mô tả mới',
      tagline: 'TDD',
      categories: ['test', 'chất lượng'],
    });
  });

  it('skill sửa được: lưu SKILL.md gửi PATCH files rồi xếp skill-sync cho mọi máy có app', async () => {
    const s = mockServer(
      routes(LOCAL, {
        ...data('crew.machines', [machine(), machine({ machineId: M2, hostname: 'macbook', jobsAgent: false })]),
        [`GET ${BASE}/files?path=SKILL.md`]: {
          body: {
            skillId: SKILL_ID,
            path: 'SKILL.md',
            kind: 'skill',
            content: SKILL_MD,
            editable: true,
            markdown: true,
          },
        },
        [`PATCH ${BASE}/files`]: { body: { skillId: SKILL_ID, path: 'SKILL.md', content: 'x', editable: true } },
      }),
    );
    mount();
    const box = await screen.findByRole('textbox', { name: 'Nội dung SKILL.md' });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(SKILL_MD));
    fireEvent.change(box, { target: { value: `${SKILL_MD}\nThêm dòng.` } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu file' }));
    expect(await screen.findByText('Đã lưu SKILL.md')).toBeTruthy();
    expect(s.calls.find((c) => c.method === 'PATCH' && c.url === `${BASE}/files`)?.body).toEqual({
      path: 'SKILL.md',
      content: `${SKILL_MD}\nThêm dòng.`,
    });
    await waitFor(() => expect(jobBodies(s.calls)).toHaveLength(1));
    expect(jobBodies(s.calls)[0]).toMatchObject({ machineId: M1, kind: 'skill-sync' });
  });

  it('đổi name: thành tên skill Superpowers thì chặn, không gọi API', async () => {
    const s = mockServer(
      routes(LOCAL, {
        [`GET ${BASE}/files?path=SKILL.md`]: {
          body: {
            skillId: SKILL_ID,
            path: 'SKILL.md',
            kind: 'skill',
            content: SKILL_MD,
            editable: true,
            markdown: true,
          },
        },
      }),
    );
    mount();
    const box = await screen.findByRole('textbox', { name: 'Nội dung SKILL.md' });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(SKILL_MD));
    fireEvent.change(box, { target: { value: '---\nname: brainstorming\n---\n' } });
    expect(await screen.findByText('Tên brainstorming trùng skill Superpowers đã ghim, không lưu được')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu file' }) as HTMLButtonElement).disabled).toBe(true);
    expect(s.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('server báo 409 khi lưu thì báo có người vừa sửa, không ghi đè', async () => {
    mockServer(
      routes(LOCAL, {
        [`GET ${BASE}/files?path=SKILL.md`]: {
          body: {
            skillId: SKILL_ID,
            path: 'SKILL.md',
            kind: 'skill',
            content: SKILL_MD,
            editable: true,
            markdown: true,
          },
        },
        [`PATCH ${BASE}/files`]: { status: 409, body: { error: 'Skill changed' } },
      }),
    );
    mount();
    const box = await screen.findByRole('textbox', { name: 'Nội dung SKILL.md' });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(SKILL_MD));
    fireEvent.change(box, { target: { value: `${SKILL_MD}!` } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu file' }));
    expect(await screen.findByText('Có người vừa sửa, tải lại')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
  });

  it('xóa file cần gõ đúng đường dẫn, gửi DELETE files target file', async () => {
    const s = mockServer(
      routes(LOCAL, {
        [`GET ${BASE}/files?path=SKILL.md`]: {
          body: {
            skillId: SKILL_ID,
            path: 'SKILL.md',
            kind: 'skill',
            content: SKILL_MD,
            editable: true,
            markdown: true,
          },
        },
        [`GET ${BASE}/files?path=references%2Fcach-viet.md`]: {
          body: {
            skillId: SKILL_ID,
            path: 'references/cach-viet.md',
            kind: 'reference',
            content: 'x',
            editable: true,
            markdown: true,
          },
        },
        [`DELETE ${BASE}/files`]: { body: { path: 'references/cach-viet.md', target: 'file', deletedPaths: [] } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'references/cach-viet.md' }));
    await screen.findByRole('textbox', { name: 'Nội dung references/cach-viet.md' });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa file' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Xóa file' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'references/cach-viet.md' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(s.calls.find((c) => c.method === 'DELETE')?.body).toEqual({
      path: 'references/cach-viet.md',
      target: 'file',
    });
  });
});

describe('Cập nhật từ nguồn, tạo bản sửa được (S14.6)', () => {
  it('kiểm cập nhật thấy bản mới → Cập nhật từ nguồn → xếp skill-sync', async () => {
    const s = mockServer(
      routes(GITHUB, {
        [`GET ${BASE}/update-status`]: {
          body: { supported: true, reason: null, hasUpdate: true, latestRef: 'abcdef1234567', currentRef: 'aaa' },
        },
        [`POST ${BASE}/install-update`]: { body: GITHUB },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm cập nhật' }));
    expect(await screen.findByText('Có bản mới abcdef1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật từ nguồn' }));
    expect(await screen.findByText('Đã cập nhật từ nguồn')).toBeTruthy();
    expect(s.calls.find((c) => c.url === `${BASE}/install-update`)?.body).toEqual({});
    await waitFor(() => expect(jobBodies(s.calls)).toHaveLength(1));
  });

  it('nguồn đã mới nhất thì không có nút Cập nhật từ nguồn', async () => {
    mockServer(
      routes(GITHUB, {
        [`GET ${BASE}/update-status`]: { body: { supported: true, reason: null, hasUpdate: false } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm cập nhật' }));
    expect(await screen.findByText('Đã là bản mới nhất')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cập nhật từ nguồn' })).toBeNull();
  });

  it('tạo bản sửa được: precheck → fork chuyển agent đang dùng → mở bản mới, gợi ý xóa bản cũ', async () => {
    const s = mockServer(
      routes(GITHUB, {
        [`GET ${BASE}/fork-precheck`]: {
          body: {
            skillId: SKILL_ID,
            agentUsageCount: 1,
            usedByAgents: GITHUB.usedByAgents,
            existingForks: [],
          },
        },
        [`POST ${BASE}/fork`]: {
          status: 201,
          body: { skill: { ...LOCAL, id: FORK_ID, name: 'Viết test (sửa)' }, reassignments: [] },
        },
        [`GET /api/companies/c-tps/skills/${FORK_ID}`]: {
          body: { ...LOCAL, id: FORK_ID, name: 'Viết test (sửa)', forkedFromSkillId: SKILL_ID },
        },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo bản sửa được' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Chuyển 1 agent đang dùng sang bản mới')).toBeTruthy();
    const name = within(dialog).getByLabelText('Tên bản mới');
    fireEvent.change(name, { target: { value: 'brainstorming' } });
    expect(within(dialog).getByText('Trùng skill Superpowers brainstorming, không tạo được')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Viết test (sửa)' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo bản sửa được' }));
    await waitFor(() => expect(s.calls.some((c) => c.url === `${BASE}/fork`)).toBe(true));
    expect(s.calls.find((c) => c.url === `${BASE}/fork`)?.body).toEqual({
      name: 'Viết test (sửa)',
      reassignAgentIds: [ID.executor],
    });
    expect(await screen.findByText('Bản gốc vẫn còn')).toBeTruthy();
    await waitFor(() =>
      expect(jobBodies(s.calls).some((b) => (b.payload as { skillId: string }).skillId === FORK_ID)).toBe(true),
    );
  });
});

describe('Xóa skill (S14.7)', () => {
  it('cần gõ đúng slug; chạy gỡ agent → bỏ chọn nguồn → DELETE → skill-remove, rồi về danh sách', async () => {
    const snapshot = { desiredSkills: ['crew/review', GITHUB.key], entries: [], warnings: [] };
    const s = mockServer(
      routes(GITHUB, {
        [`GET /api/agents/${ID.executor}/skills`]: { body: snapshot },
        [`POST /api/agents/${ID.executor}/skills/sync`]: { body: snapshot },
        'GET /api/companies/c-tps/skill-sources/src1': {
          body: {
            id: 'src1',
            revision: 3,
            excludedFolders: [],
            entries: [{ path: 'skills/viet-test/SKILL.md', selection: 'selected' }],
          },
        },
        'PATCH /api/companies/c-tps/skill-sources/src1': { body: {} },
        [`DELETE ${BASE}`]: { body: GITHUB },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa skill' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Executor Một')).toBeTruthy();
    expect(within(dialog).getByText('mac-mini')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Xóa skill' }) as HTMLButtonElement;
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Viết test' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'viet-test' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(await screen.findByText('đích')).toBeTruthy();
    const order = s.calls
      .filter((c) => c.method !== 'GET' && !c.url.includes('/plugins/crew.core/data/'))
      .map((c) => `${c.method} ${c.url.split('?')[0]}`);
    expect(order).toEqual([
      `POST /api/agents/${ID.executor}/skills/sync`,
      'PATCH /api/companies/c-tps/skill-sources/src1',
      `DELETE ${BASE}`,
      `POST /api/plugins/crew.core/api/machine-jobs`,
    ]);
    expect(jobBodies(s.calls)[0]).toEqual({
      companyId: 'c-tps',
      machineId: M1,
      kind: 'skill-remove',
      payload: { kind: 'skill-remove', skillId: SKILL_ID, slug: 'viet-test' },
    });
  });

  it('lỗi giữa chừng thì báo nguyên văn và có Chạy tiếp, không làm lại bước đã xong', async () => {
    let deletes = 0;
    const s = mockServer(
      routes(
        { ...LOCAL, usedByAgents: [] },
        {
          [`DELETE ${BASE}`]: () => {
            deletes += 1;
            return deletes === 1 ? { status: 500, body: { error: 'Máy chủ bận' } } : { body: LOCAL };
          },
        },
      ),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa skill' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'viet-test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa skill' }));
    expect(await screen.findByText('Máy chủ bận')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chạy tiếp' }));
    expect(await screen.findByText('đích')).toBeTruthy();
    expect(s.calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
    expect(jobBodies(s.calls)).toHaveLength(1);
  });
});

describe('Skill ghim và trạng thái gỡ', () => {
  it('khối Skill ghim liệt kê skill Superpowers, chỉ đọc, không có nút nào bên trong', async () => {
    mockServer({
      'GET /api/companies/c-tps/skills': { body: [] },
      ...data('crew.machines', [machine()]),
      ...data('crew.skillSync', []),
      ...data('crew.machineJobs', []),
    });
    renderPage(<SkillsPage />, { route: 'skills', at: '/TPS/skills' });
    const block = await screen.findByRole('region', { name: 'Skill ghim (Superpowers)' });
    expect(within(block).getByText('brainstorming')).toBeTruthy();
    expect(within(block).getByText('writing-plans')).toBeTruthy();
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
  });

  it('danh sách hiện bản chép của skill đã xóa: đang gỡ, hoặc chờ app trên máy chưa nhận việc', async () => {
    mockServer({
      'GET /api/companies/c-tps/skills': { body: [] },
      ...data('crew.machines', [machine(), machine({ machineId: M2, hostname: 'macbook', jobsAgent: false })]),
      ...data('crew.skillSync', [
        { skillId: SKILL_ID, machineId: M1, jobId: 'j1', kind: 'skill-remove', status: 'queued', sha256: null },
        { skillId: SKILL_ID, machineId: M2, jobId: 'j2', kind: 'skill-sync', status: 'done', sha256: null },
      ]),
      ...data('crew.machineJobs', [
        job({
          id: 'j1',
          kind: 'skill-remove',
          payload: { kind: 'skill-remove', skillId: SKILL_ID, slug: 'viet-test' },
        }),
        job({ id: 'j2', machineId: M2, status: 'done' }),
      ]),
    });
    renderPage(<SkillsPage />, { route: 'skills', at: '/TPS/skills' });
    expect(await screen.findByText('viet-test: đang chờ gỡ khỏi mac-mini')).toBeTruthy();
    expect(screen.getByText('viet-test: chờ app 2P Crew trên macbook để gỡ')).toBeTruthy();
  });

  it('SyncStatus hiện đúng việc gỡ đang chờ và lỗi gỡ', async () => {
    mockServer({
      ...data('crew.skillSync', [
        {
          skillId: SKILL_ID,
          machineId: M1,
          jobId: 'j1',
          kind: 'skill-remove',
          status: 'claimed',
          sha256: 'a'.repeat(64),
        },
        {
          skillId: SKILL_ID,
          machineId: M2,
          jobId: 'j2',
          kind: 'skill-remove',
          status: 'failed',
          sha256: null,
          errorText: 'không xóa được',
        },
      ]),
      ...data('crew.machineJobs', []),
    });
    renderWith(
      <SyncStatus
        skill={{ id: SKILL_ID, slug: 'viet-test', version: '1' }}
        machines={[machine(), machine({ machineId: M2, hostname: 'macbook' })]}
      />,
    );
    expect(await screen.findByText('Đang gỡ khỏi mac-mini')).toBeTruthy();
    expect(screen.getByText('Lỗi gỡ khỏi macbook: không xóa được')).toBeTruthy();
    expect(screen.queryByText(/Đã có trên/)).toBeNull();
  });

  it('bảng bật skill cho agent không có agent đã gỡ, trừ agent đang bật skill này', async () => {
    const removedRun = (agentId: string) => ({
      id: `rm-${agentId}`,
      companyId: 'c-tps',
      kind: 'remove-agent',
      projectKey: 'agent-x',
      projectId: null,
      machineId: M1,
      input: { agentId, agentName: 'x', projectId: null, role: null },
      steps: {},
      status: 'done',
      runningStep: null,
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    });
    mockServer(
      routes(GITHUB, {
        'GET /api/companies/c-tps/agents': {
          body: [
            agent({ status: 'paused' }),
            agent({ id: ID.spare, name: 'Agent Đã Gỡ', urlKey: 'agent-da-go', status: 'paused' }),
            agent({ id: ID.reviewer, name: 'Reviewer', urlKey: 'reviewer' }),
          ],
        },
        ...data('crew.setupRuns', [removedRun(ID.executor), removedRun(ID.spare)]),
      }),
    );
    mount();
    expect(await screen.findByRole('switch', { name: 'Reviewer' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'Agent Đã Gỡ' })).toBeNull());
    expect(screen.getByRole('switch', { name: 'Executor Một' })).toBeTruthy();
  });
});
