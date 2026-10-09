// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SkillsTab } from '@/features/agents/detail/skills-tab';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { agent, ID, renderWith } from './helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const SNAPSHOT = {
  adapterType: 'claude_local',
  supported: true,
  mode: 'ephemeral',
  desiredSkills: ['crew/brainstorm'],
  entries: [
    { key: 'crew/brainstorm', runtimeName: 'brainstorm', desired: true, managed: true, state: 'configured' },
    { key: 'crew/review', runtimeName: 'review', desired: false, managed: true, state: 'available' },
    { key: 'user/local', runtimeName: 'local', desired: false, managed: false, state: 'external', readOnly: true },
  ],
  warnings: [],
};
const SKILLS = `/api/agents/${ID.executor}/skills`;

describe('SkillsTab', () => {
  it('liệt kê skill, skill ngoài company chỉ đọc', async () => {
    mockServer({ [`GET ${SKILLS}`]: { body: SNAPSHOT } });
    renderWith(<SkillsTab agent={agent() as never} companyId="c-tps" />);
    const on = await screen.findByRole('switch', { name: 'crew/brainstorm' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'crew/review' }).getAttribute('aria-checked')).toBe('false');
    expect((screen.getByRole('switch', { name: 'user/local' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('bật skill gọi POST /skills/sync với danh sách mới (mode replace)', async () => {
    const s = mockServer({
      [`GET ${SKILLS}`]: { body: SNAPSHOT },
      [`POST ${SKILLS}/sync`]: {
        body: { ...SNAPSHOT, desiredSkills: ['crew/brainstorm', 'crew/review'] },
      },
    });
    renderWith(<SkillsTab agent={agent() as never} companyId="c-tps" />);
    fireEvent.click(await screen.findByRole('switch', { name: 'crew/review' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    const post = s.calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ desiredSkills: ['crew/brainstorm', 'crew/review'], mode: 'replace' });
    expect(post?.url).toContain('companyId=c-tps');
  });

  it('tắt skill bỏ khỏi danh sách', async () => {
    const s = mockServer({
      [`GET ${SKILLS}`]: { body: SNAPSHOT },
      [`POST ${SKILLS}/sync`]: { body: { ...SNAPSHOT, desiredSkills: [] } },
    });
    renderWith(<SkillsTab agent={agent() as never} companyId="c-tps" />);
    fireEvent.click(await screen.findByRole('switch', { name: 'crew/brainstorm' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({ desiredSkills: [], mode: 'replace' });
  });

  it('lỗi sync hiện nguyên văn', async () => {
    mockServer({
      [`GET ${SKILLS}`]: { body: SNAPSHOT },
      [`POST ${SKILLS}/sync`]: { status: 422, body: { error: 'Skill không tồn tại' } },
    });
    renderWith(<SkillsTab agent={agent() as never} companyId="c-tps" />);
    fireEvent.click(await screen.findByRole('switch', { name: 'crew/review' }));
    expect(await screen.findByText('Skill không tồn tại')).toBeTruthy();
  });

  it('adapter không hỗ trợ skill thì báo', async () => {
    mockServer({ [`GET ${SKILLS}`]: { body: { ...SNAPSHOT, supported: false, entries: [] } } });
    renderWith(<SkillsTab agent={agent() as never} companyId="c-tps" />);
    expect(await screen.findByText('Adapter của agent này không hỗ trợ đồng bộ skill.')).toBeTruthy();
  });
});
