// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IssueJevBlock } from '@/features/jev/issue-jev-block';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { renderPage } from '../agents/helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const ISSUE = '11111111-1111-4111-8111-111111111111';
const URL_SUMMARY = `/api/crew/companies/c-tps/jev/issues/${ISSUE}/summary`;

const event = (over: Record<string, unknown> = {}) => ({
  id: '7',
  eventId: 'e-7',
  machineId: '22222222-2222-4222-8222-222222222222',
  hostname: 'mac-mini',
  occurredAt: '2026-10-22T03:30:00.000Z',
  runId: 'aaaaaaaa-1111-4111-8111-111111111111',
  agentId: null,
  mode: 'shadow',
  category: 'force_push',
  verdict: 'deny',
  applied: 'allow',
  blocking: false,
  confidence: 0.91,
  reason: null,
  errorCode: null,
  latencyMs: 100,
  model: 'typesafe/jev-1.14',
  command: 'git push --force origin main',
  cwd: null,
  ownerLabel: null,
  labeledByUserId: null,
  labeledAt: null,
  receivedAt: '2026-10-22T03:30:01.000Z',
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  calls: 184,
  allow: 181,
  deny: 2,
  appliedDeny: 0,
  escalate: 1,
  error: 0,
  runs: 3,
  lastAt: '2026-10-22T03:30:00.000Z',
  items: [event()],
  shadow: { mismatch: 0, items: [] },
  ...over,
});

const mount = () => renderPage(<IssueJevBlock issueId={ISSUE} />, { route: 'issues/x', at: '/TPS/issues/x' });

describe('IssueJevBlock', () => {
  it('hiện một dòng tóm tắt; bấm mở thì có bảng ca, nhãn Đúng/Nhầm và link tới trang Jev', async () => {
    const s = mockServer({
      [`GET ${URL_SUMMARY}`]: { body: summary() },
      'POST /api/crew/companies/c-tps/jev/gate-events/7/label': { body: event({ ownerLabel: 'wrong' }) },
    });
    mount();
    const toggle = await screen.findByRole('button', { name: 'Jev: 184 lệnh · 2 chặn · 1 không chắc · 0 lỗi' });
    expect(screen.queryByTestId('jev-gate-event')).toBeNull();
    fireEvent.click(toggle);
    const row = await screen.findByTestId('jev-gate-event');
    expect(within(row).getByText('git push --force origin main')).toBeTruthy();
    expect(within(row).getByText('mac-mini')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Xem tất cả ở trang Jev' }).getAttribute('href')).toBe('/TPS/jev');
    fireEvent.click(within(row).getByRole('button', { name: 'Nhầm' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.url.endsWith('/7/label'))).toBe(true));
  });

  it('ca lệch C3 hiện sau khi mở', async () => {
    mockServer({
      [`GET ${URL_SUMMARY}`]: {
        body: summary({
          shadow: {
            mismatch: 1,
            items: [
              {
                id: '3',
                kind: 'liveness',
                runId: 'aaaaaaaa-1111-4111-8111-111111111111',
                regexLabel: 'blocked',
                jevLabel: 'progress',
                confidence: 0.8,
                escalated: false,
                status: 'done',
                errorCode: null,
                latencyMs: 1,
                inputExcerpt: null,
                mismatch: true,
                createdAt: '2026-10-22T03:30:00.000Z',
                evaluatedAt: null,
              },
            ],
          },
        }),
      },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Jev: 184 lệnh/ }));
    expect(await screen.findByTestId('jev-shadow-item')).toBeTruthy();
    expect(screen.getByText('1 ca Jev và regex cho nhãn khác nhau trong các run của issue này.')).toBeTruthy();
  });

  it('không có dữ liệu thì ẩn hẳn khối', async () => {
    const s = mockServer({
      [`GET ${URL_SUMMARY}`]: { body: summary({ enabled: false, calls: 0, deny: 0, escalate: 0, items: [] }) },
    });
    mount();
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/summary'))).toBe(true));
    await waitFor(() => expect(document.querySelector('[data-slot="issue-jev"]')).toBeNull());
  });

  it('lỗi tải (ví dụ 403) thì ẩn lặng lẽ, không báo lỗi trên trang issue', async () => {
    const s = mockServer({ [`GET ${URL_SUMMARY}`]: { status: 403, body: { error: 'forbidden' } } });
    mount();
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/summary'))).toBe(true));
    expect(document.querySelector('[data-slot="issue-jev"]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('người không phải owner không gọi API Jev và không thấy khối', async () => {
    const s = mockServer({
      [`GET ${URL_SUMMARY}`]: { body: summary() },
      ...accessRoute('c-tps', { userId: 'u2', membershipRole: 'operator', contributor: false, canApprove: false }),
    });
    mount();
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/access'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.calls.some((c) => c.url.endsWith('/summary'))).toBe(false);
    expect(document.querySelector('[data-slot="issue-jev"]')).toBeNull();
  });
});
