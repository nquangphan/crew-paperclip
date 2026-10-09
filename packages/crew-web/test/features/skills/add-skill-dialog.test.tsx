// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AddSkillDialog } from '@/features/skills/add-skill-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, renderWith } from '../agents/helpers';
import { job, M1, M2, machine, ROUTE, SKILL_ID } from '../machines/fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const COMMIT = 'a'.repeat(40);
const URL_REPO = 'https://github.com/acme/skills';
const P_MY = 'skills/my-skill/SKILL.md';
const P_BRAIN = 'skills/brainstorming/SKILL.md';
const candidate = (path: string, name: string) => ({
  path,
  name,
  description: `Mô tả ${name}`,
  fileCount: 2,
  error: null,
  warnings: [],
});
const DISCOVERY = {
  repositoryId: 'r1',
  repositoryUrl: URL_REPO,
  fullName: 'acme/skills',
  trackingRef: 'main',
  commitSha: COMMIT,
  candidates: [candidate(P_BRAIN, 'brainstorming'), candidate(P_MY, 'my-skill')],
  warnings: [],
};
const SOURCES = '/api/companies/c-tps/skill-sources';

function server(machines: unknown[], extra: Record<string, never | object> = {}) {
  return mockServer({
    ...data('crew.machines', machines),
    [`POST ${SOURCES}/discover`]: { body: DISCOVERY },
    [`POST ${SOURCES}`]: {
      status: 201,
      body: { id: 'src1', entries: [{ path: P_MY, skillId: SKILL_ID, selection: 'selected', name: 'my-skill' }] },
    },
    [`GET /api/companies/c-tps/skills/${SKILL_ID}`]: {
      body: { id: SKILL_ID, slug: 'my-skill', packageVersion: '1.2.0', currentVersionId: 'v1' },
    },
    [`POST ${ROUTE}/machine-jobs`]: { status: 201, body: job({ id: 'jx' }) },
    ...extra,
  });
}

async function scan() {
  fireEvent.change(screen.getByLabelText('Địa chỉ repo GitHub'), { target: { value: URL_REPO } });
  fireEvent.click(screen.getByRole('button', { name: 'Quét repo' }));
  await screen.findByText('my-skill');
}
const mount = () => renderWith(<AddSkillDialog open onOpenChange={() => {}} />);

describe('AddSkillDialog (S14.2)', () => {
  it('chọn skill từ nguồn → create → một việc skill-sync cho mỗi máy có jobsAgent', async () => {
    const s = server([
      machine(),
      machine({ machineId: M2, hostname: 'mac-studio' }),
      machine({ machineId: 'x', hostname: 'cli-only', jobsAgent: false }),
    ]);
    mount();
    await scan();
    fireEvent.click(screen.getByRole('checkbox', { name: 'my-skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm skill' }));
    await waitFor(() => expect(s.calls.filter((c) => c.url.endsWith('/machine-jobs'))).toHaveLength(2));
    const create = s.calls.find((c) => c.method === 'POST' && c.url.endsWith('/skill-sources'));
    expect(create?.body).toEqual({
      repositoryUrl: URL_REPO,
      trackingRef: 'main',
      commitSha: COMMIT,
      selectedPaths: [P_MY],
    });
    const jobs = s.calls.filter((c) => c.url.endsWith('/machine-jobs')).map((c) => c.body as Record<string, unknown>);
    expect(jobs.map((j) => j.machineId).sort()).toEqual([M1, M2].sort());
    expect(jobs[0]).toMatchObject({
      companyId: 'c-tps',
      kind: 'skill-sync',
      payload: { kind: 'skill-sync', skillId: SKILL_ID, slug: 'my-skill', version: '1.2.0' },
    });
  });

  it('không máy nào có jobsAgent thì tạo skill nhưng không xếp việc, báo "Chờ app 2P Crew"', async () => {
    const s = server([machine({ jobsAgent: false })]);
    mount();
    await scan();
    fireEvent.click(screen.getByRole('checkbox', { name: 'my-skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm skill' }));
    expect(await screen.findByText(/Chờ app 2P Crew/)).toBeTruthy();
    expect(s.calls.some((c) => c.url.endsWith('/machine-jobs'))).toBe(false);
    expect(s.calls.some((c) => c.method === 'POST' && c.url.endsWith('/skill-sources'))).toBe(true);
  });

  it('tên trùng skill Superpowers (brainstorming) bị chặn, không gọi create', async () => {
    const s = server([machine()]);
    mount();
    await scan();
    const clash = screen.getByRole('checkbox', { name: 'brainstorming' }) as HTMLButtonElement;
    expect(clash.disabled).toBe(true);
    expect(screen.getByText(/Trùng skill Superpowers brainstorming/)).toBeTruthy();
    fireEvent.click(clash);
    expect((screen.getByRole('button', { name: 'Thêm skill' }) as HTMLButtonElement).disabled).toBe(true);
    expect(s.calls.some((c) => c.url.endsWith('/skill-sources'))).toBe(false);
  });

  it('chưa biết danh sách Superpowers của máy thì cảnh báo nhưng vẫn cho thêm', async () => {
    server([machine({ skills: null })]);
    mount();
    await scan();
    expect(screen.getByText('Chưa biết danh sách skill Superpowers của máy')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'brainstorming' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('create bị từ chối thì hiện lỗi nguyên văn và không xếp việc', async () => {
    const s = server([machine()], { [`POST ${SOURCES}`]: { status: 422, body: { error: 'Skill đã tồn tại' } } });
    mount();
    await scan();
    fireEvent.click(screen.getByRole('checkbox', { name: 'my-skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm skill' }));
    expect(await screen.findByText('Skill đã tồn tại')).toBeTruthy();
    expect(s.calls.some((c) => c.url.endsWith('/machine-jobs'))).toBe(false);
  });

  it('xem trước gọi preview với commit đã quét và hiện nội dung SKILL.md', async () => {
    const s = server([machine()], {
      [`POST ${SOURCES}/preview`]: {
        body: { file: { path: P_MY }, content: '# Nội dung thử', truncated: false, commitSha: COMMIT },
      },
    });
    mount();
    await scan();
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước my-skill' }));
    expect(await screen.findByText('Nội dung thử')).toBeTruthy();
    expect(s.calls.find((c) => c.url.endsWith('/preview'))?.body).toEqual({
      repositoryUrl: URL_REPO,
      trackingRef: 'main',
      commitSha: COMMIT,
      skillPath: P_MY,
      filePath: P_MY,
    });
  });

  it('quét lỗi (repo không hợp lệ) hiện lỗi nguyên văn', async () => {
    mockServer({
      ...data('crew.machines', [machine()]),
      [`POST ${SOURCES}/discover`]: { status: 400, body: { error: 'Enter an HTTPS GitHub repository or branch URL.' } },
    });
    mount();
    fireEvent.change(screen.getByLabelText('Địa chỉ repo GitHub'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Quét repo' }));
    expect(await screen.findByText('Enter an HTTPS GitHub repository or branch URL.')).toBeTruthy();
  });
});
