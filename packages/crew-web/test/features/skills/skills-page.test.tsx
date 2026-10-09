// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SkillDetail } from '@/features/skills/skill-detail';
import { SkillsPage } from '@/features/skills/skills-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { agent, data, ID, renderPage } from '../agents/helpers';
import { M1, machine, SKILL_ID } from '../machines/fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const LIST_ITEM = {
  id: SKILL_ID,
  key: 'company/viet-test',
  slug: 'viet-test',
  name: 'Viết test',
  description: 'Viết test trước',
  sourceLabel: 'acme/skills',
  sourceBadge: 'github',
  attachedAgentCount: 2,
};
const DETAIL = {
  ...LIST_ITEM,
  markdown: '# Viết test\n\nLàm theo TDD.',
  sourceLocator: 'https://github.com/acme/skills',
  packageVersion: '1.2.0',
  currentVersionId: 'v1',
  usedByAgents: [
    { id: ID.executor, name: 'Executor Một', urlKey: 'executor-mot', adapterType: 'claude_local', desired: true },
  ],
};
const SYNC = [
  { skillId: SKILL_ID, machineId: M1, status: 'done', sha256: 'f'.repeat(64), finishedAt: '2026-10-10T01:00:00Z' },
];

describe('SkillsPage', () => {
  it('S14.1: liệt kê skill, số agent dùng và số máy đã đồng bộ', async () => {
    mockServer({
      'GET /api/companies/c-tps/skills': { body: [LIST_ITEM] },
      ...data('crew.machines', [machine()]),
      ...data('crew.skillSync', SYNC),
    });
    renderPage(<SkillsPage />, { route: 'skills', at: '/TPS/skills' });
    expect(await screen.findByRole('link', { name: 'Viết test' })).toBeTruthy();
    expect(screen.getByText('acme/skills')).toBeTruthy();
    expect(await screen.findByText('1/1 máy')).toBeTruthy();
  });

  it('nút Thêm skill mở hộp thoại thêm từ repo GitHub', async () => {
    mockServer({
      'GET /api/companies/c-tps/skills': { body: [] },
      ...data('crew.machines', []),
      ...data('crew.skillSync', []),
    });
    renderPage(<SkillsPage />, { route: 'skills', at: '/TPS/skills' });
    expect(await screen.findByText('Chưa có skill nào')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm skill' }));
    expect(await screen.findByLabelText('Địa chỉ repo GitHub')).toBeTruthy();
  });
});

describe('SkillDetail', () => {
  const routes = () => ({
    [`GET /api/companies/c-tps/skills/${SKILL_ID}`]: { body: DETAIL },
    'GET /api/companies/c-tps/agents': {
      body: [agent(), agent({ id: ID.reviewer, name: 'Reviewer', urlKey: 'reviewer' })],
    },
    ...data('crew.machines', [machine()]),
    ...data('crew.skillSync', SYNC),
    ...data('crew.machineJobs', []),
  });
  const mount = () => renderPage(<SkillDetail />, { route: 'skills/:skillId', at: `/TPS/skills/${SKILL_ID}` });

  it('hiện SKILL.md và trạng thái đồng bộ theo máy', async () => {
    mockServer(routes());
    mount();
    expect(await screen.findByText('Viết test trước')).toBeTruthy();
    expect(await screen.findByText('Làm theo TDD.')).toBeTruthy();
    expect(await screen.findByText('Đã có trên mac-mini, hash ffffffffffff')).toBeTruthy();
  });

  it('S14.3: bật skill cho agent đọc danh sách hiện tại rồi POST skills/sync với khóa skill', async () => {
    const snapshot = {
      adapterType: 'claude_local',
      supported: true,
      mode: 'ephemeral',
      desiredSkills: ['crew/review'],
      entries: [],
      warnings: [],
    };
    const s = mockServer({
      ...routes(),
      [`GET /api/agents/${ID.reviewer}/skills`]: { body: snapshot },
      [`POST /api/agents/${ID.reviewer}/skills/sync`]: { body: snapshot },
    });
    mount();
    fireEvent.click(await screen.findByRole('switch', { name: 'Reviewer' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.url.includes('/skills/sync'))).toBe(true));
    const post = s.calls.find((c) => c.method === 'POST' && c.url.includes('/skills/sync'));
    expect(post?.body).toEqual({ desiredSkills: ['crew/review', 'company/viet-test'], mode: 'replace' });
  });

  it('tắt skill của agent đang dùng bỏ khóa khỏi danh sách', async () => {
    const snapshot = {
      adapterType: 'claude_local',
      supported: true,
      mode: 'ephemeral',
      desiredSkills: ['crew/review', 'company/viet-test'],
      entries: [],
      warnings: [],
    };
    const s = mockServer({
      ...routes(),
      [`GET /api/agents/${ID.executor}/skills`]: { body: snapshot },
      [`POST /api/agents/${ID.executor}/skills/sync`]: { body: snapshot },
    });
    mount();
    const on = await screen.findByRole('switch', { name: 'Executor Một' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(on);
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.url.includes('/skills/sync'))).toBe(true));
    expect(s.calls.find((c) => c.method === 'POST' && c.url.includes('/skills/sync'))?.body).toEqual({
      desiredSkills: ['crew/review'],
      mode: 'replace',
    });
  });

  it('server từ chối thì hiện lỗi nguyên văn', async () => {
    mockServer({
      ...routes(),
      [`GET /api/agents/${ID.reviewer}/skills`]: { status: 403, body: { error: 'Không đủ quyền' } },
    });
    mount();
    fireEvent.click(await screen.findByRole('switch', { name: 'Reviewer' }));
    expect(await screen.findByText('Không đủ quyền')).toBeTruthy();
  });
});
