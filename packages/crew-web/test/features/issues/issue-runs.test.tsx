// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IssueRuns } from '@/features/issues/detail/issue-runs';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

// Nguồn: GET /api/issues/:id/runs (server/src/services/activity.ts runsForIssue).
const RUNS = [
  { runId: 'run-running-1234', status: 'running', agentId: 'a1', startedAt: '2026-10-10T01:00:00.000Z' },
  { runId: 'run-queued-5678', status: 'queued', agentId: 'a1', startedAt: null },
  { runId: 'run-done-90abcd', status: 'succeeded', agentId: 'a2', startedAt: '2026-10-09T01:00:00.000Z' },
];

describe('IssueRuns (S6.15)', () => {
  it('liệt kê run, link tới trang run', async () => {
    mockServer({ 'GET /api/issues/i1/runs': { body: RUNS } });
    mount(<IssueRuns issueId="i1" agentNames={{ a1: 'Executor Alpha', a2: 'Reviewer Alpha' }} />);
    const rows = await screen.findAllByTestId('issue-run');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByRole('link').getAttribute('href')).toBe('/TPS/runs/run-running-1234');
    expect(within(rows[0]).getByText(/Executor Alpha/)).toBeTruthy();
  });

  it('chỉ run running/queued có nút Dừng run', async () => {
    mockServer({ 'GET /api/issues/i1/runs': { body: RUNS } });
    mount(<IssueRuns issueId="i1" agentNames={{}} />);
    await screen.findAllByTestId('issue-run');
    expect(screen.getAllByRole('button', { name: 'Dừng run' })).toHaveLength(2);
    expect(within(screen.getAllByTestId('issue-run')[2]).queryByRole('button')).toBeNull();
  });

  it('dừng run phải xác nhận rồi POST /heartbeat-runs/:id/cancel', async () => {
    const s = mockServer({
      'GET /api/issues/i1/runs': { body: RUNS },
      'POST /api/heartbeat-runs/run-running-1234/cancel': { body: {} },
    });
    mount(<IssueRuns issueId="i1" agentNames={{}} />);
    await screen.findAllByTestId('issue-run');
    fireEvent.click(screen.getAllByRole('button', { name: 'Dừng run' })[0]);
    const dialog = await screen.findByRole('alertdialog');
    expect(s.calls.some((c) => c.url.includes('/cancel'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dừng run' }));
    await waitFor(() => expect(s.calls.filter((c) => c.url.endsWith('/cancel'))).toHaveLength(1));
  });

  it('không dừng nếu bấm Hủy trong hộp xác nhận', async () => {
    const s = mockServer({ 'GET /api/issues/i1/runs': { body: RUNS } });
    mount(<IssueRuns issueId="i1" agentNames={{}} />);
    await screen.findAllByTestId('issue-run');
    fireEvent.click(screen.getAllByRole('button', { name: 'Dừng run' })[0]);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hủy' }));
    expect(s.calls.some((c) => c.url.includes('/cancel'))).toBe(false);
  });

  it('lỗi dừng run hiện nguyên văn', async () => {
    mockServer({
      'GET /api/issues/i1/runs': { body: RUNS },
      'POST /api/heartbeat-runs/run-running-1234/cancel': { status: 409, body: { error: 'run đã kết thúc' } },
    });
    mount(<IssueRuns issueId="i1" agentNames={{}} />);
    await screen.findAllByTestId('issue-run');
    fireEvent.click(screen.getAllByRole('button', { name: 'Dừng run' })[0]);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Dừng run' }));
    expect(await screen.findByText(/run đã kết thúc/)).toBeTruthy();
  });
});
