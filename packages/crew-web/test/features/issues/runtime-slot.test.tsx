// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RuntimeSlot } from '@/features/issues/detail/crew/runtime-slot';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { ISSUE, wrap } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const DATA = '/api/plugins/crew.core/data';
const base = {
  runId: null,
  machineId: 'm1',
  fromAgentId: null,
  fromAgentName: null,
  toAgentId: 'a1',
  toAgentName: 'Executor Alpha',
  fromRuntime: null,
  toRuntime: 'claude_local',
  model: 'claude-sonnet-5',
  complexity: 'small',
  trigger: null,
  reason: 'việc nhỏ',
};
const SELECT = { ...base, id: 'd1', role: 'executor', kind: 'select', decidedAt: '2026-10-10T01:00:00.000Z' };
const FALLBACK = {
  ...base,
  id: 'd2',
  role: 'executor',
  kind: 'fallback',
  fromAgentName: 'Executor Alpha',
  toAgentName: 'Executor Codex',
  fromRuntime: 'claude_local',
  toRuntime: 'codex_local',
  model: 'gpt-6-sol',
  trigger: 'quota',
  reason: 'Claude hết quota, chuyển sang Codex',
  decidedAt: '2026-10-10T03:30:00.000Z',
};
const REFUSED = {
  ...base,
  id: 'd3',
  role: 'reviewer',
  kind: 'fallback_refused',
  fromAgentName: 'Reviewer Codex',
  fromRuntime: 'codex_local',
  toAgentName: null,
  toRuntime: null,
  model: null,
  complexity: null,
  trigger: 'auth',
  reason: 'Issue cũ không có reviewer Claude trong stage',
  decidedAt: '2026-10-10T04:00:00.000Z',
};

describe('RuntimeSlot', () => {
  it('gọi crew.runtimeDecisions kèm companyId và issueId, hiện các dòng theo thứ tự server trả', async () => {
    const s = mockServer({ [`POST ${DATA}/crew.runtimeDecisions`]: { body: { data: [REFUSED, FALLBACK, SELECT] } } });
    render(wrap(<RuntimeSlot issue={ISSUE as never} />));
    const region = await screen.findByRole('region', { name: 'Runtime' });
    const call = s.calls.find((c) => c.url.endsWith('/crew.runtimeDecisions'));
    expect(call?.body).toEqual({ companyId: 'c1', params: { companyId: 'c1', issueId: 'i1' } });
    const rows = within(region).getAllByTestId('runtime-decision');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toMatch(/Reviewer/);
    expect(rows[0].textContent).toMatch(/Từ chối chuyển/);
    expect(rows[2].textContent).toMatch(/Chọn/);
    expect(rows[2].textContent).toMatch(/claude-sonnet-5/);
  });

  it('dòng chuyển runtime hiện từ và sang, tên agent, nguyên nhân và lý do; giờ theo Asia/Ho_Chi_Minh', async () => {
    mockServer({ [`POST ${DATA}/crew.runtimeDecisions`]: { body: { data: [FALLBACK] } } });
    render(wrap(<RuntimeSlot issue={ISSUE as never} />));
    const row = await screen.findByTestId('runtime-decision');
    expect(row.textContent).toMatch(/Executor/);
    expect(row.textContent).toMatch(/Chuyển/);
    expect(row.textContent).toMatch(/Claude/);
    expect(row.textContent).toMatch(/Codex/);
    expect(row.textContent).toMatch(/Executor Alpha/);
    expect(row.textContent).toMatch(/Executor Codex/);
    expect(row.textContent).toMatch(/hết quota/i);
    expect(row.textContent).toMatch(/Claude hết quota, chuyển sang Codex/);
    // 03:30 UTC = 10:30 giờ Việt Nam
    expect(row.textContent).toMatch(/10:30/);
  });

  it('không có quyết định thì không render gì', async () => {
    const s = mockServer({ [`POST ${DATA}/crew.runtimeDecisions`]: { body: { data: [] } } });
    render(wrap(<RuntimeSlot issue={ISSUE as never} />));
    await waitFor(() => expect(s.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region', { name: 'Runtime' })).toBeNull();
  });

  it('lỗi tải hiện nguyên văn trong khối Runtime', async () => {
    mockServer({ [`POST ${DATA}/crew.runtimeDecisions`]: { status: 500, body: { error: 'plugin chưa sẵn sàng' } } });
    render(wrap(<RuntimeSlot issue={ISSUE as never} />));
    expect(await screen.findByText(/plugin chưa sẵn sàng/)).toBeTruthy();
  });
});
