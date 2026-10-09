// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RuntimeTab } from '@/features/agents/detail/runtime-tab';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { agent, data, environment, PIN_DIR, renderWith } from './helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const MACHINES = [
  {
    machineId: 'm1',
    hostname: 'mac-mini.local',
    lastSeenAt: '2026-10-10T00:00:00Z',
    latest: { checkouts: [{ path: '/Users/q/crew-agents/alpha/executor' }] },
  },
];

describe('RuntimeTab', () => {
  it('S11.4: hiển thị adapter, command, extraArgs, environment, máy; không có ô nhập', async () => {
    mockServer({
      'GET /api/companies/c-tps/environments': { body: [environment()] },
      ...data('crew.machines', MACHINES),
    });
    renderWith(<RuntimeTab agent={agent() as never} companyId="c-tps" />);
    expect(await screen.findByText('claude_local')).toBeTruthy();
    expect(screen.getByText('/Users/q/.crew/bin/crew-claude-run')).toBeTruthy();
    expect(screen.getByText(`--setting-sources project,local --plugin-dir ${PIN_DIR}`)).toBeTruthy();
    expect(await screen.findByText('mac-mini · 192.168.1.5')).toBeTruthy();
    expect(await screen.findByText('mac-mini.local')).toBeTruthy();
    expect(screen.getByText('/Users/q/crew-agents/alpha/executor')).toBeTruthy();
    expect(screen.getByText('1 run một lúc')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    // chỗ duy nhất sửa được là model (S11.5)
    expect(screen.getAllByRole('combobox').map((c) => c.id)).toEqual(['agent-model']);
  });

  it('agent không có environment thì báo chưa có', async () => {
    mockServer({ 'GET /api/companies/c-tps/environments': { body: [] }, ...data('crew.machines', []) });
    renderWith(<RuntimeTab agent={agent({ defaultEnvironmentId: null }) as never} companyId="c-tps" />);
    expect(await screen.findByText('Chưa gắn environment')).toBeTruthy();
  });

  it('đổi model nằm trong tab và gọi PATCH', async () => {
    mockServer({ 'GET /api/companies/c-tps/environments': { body: [] }, ...data('crew.machines', []) });
    renderWith(<RuntimeTab agent={agent() as never} companyId="c-tps" />);
    expect(await screen.findByRole('combobox', { name: 'Model mặc định' })).toBeTruthy();
  });
});
