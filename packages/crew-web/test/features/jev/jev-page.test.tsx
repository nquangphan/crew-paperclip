// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { JevPage } from '@/features/jev/jev-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { data, renderPage } from '../agents/helpers';

beforeAll(async () => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const BASE = '/api/crew/companies/c-tps/jev';
const M1 = '11111111-1111-4111-8111-111111111111';
const FAKE_KEY = 'sk-or-test-0000000000000000';

const settings = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  gateMode: 'shadow',
  model: 'typesafe/jev-1.14',
  threshold: 0.5,
  timeoutMs: 2500,
  serverShadow: false,
  hasKey: false,
  keyFingerprint: null,
  version: 3,
  updatedAt: null,
  machines: [
    { machineId: M1, appliedVersion: 3, keyOk: true, lastPullAt: '2026-10-22T03:30:00.000Z', lastEventsAt: null },
  ],
  ...over,
});

const counts = { done: 0, mismatch: 0, escalated: 0, error: 0, pending: 0 };
const stats = (over: Record<string, unknown> = {}) => ({
  days: 7,
  gate: {
    calls: 3,
    allow: 2,
    deny: 1,
    escalate: 0,
    error: 0,
    appliedDeny: 0,
    p50Ms: 120,
    p95Ms: 340,
    byCategory: [{ category: 'git_destructive', calls: 3, deny: 1, appliedDeny: 0 }],
    byDay: [],
  },
  shadow: { liveness: counts, runtime: counts },
  ...over,
});

const gateEvent = (over: Record<string, unknown> = {}) => ({
  id: '41',
  eventId: 'e-1',
  machineId: M1,
  occurredAt: '2026-10-22T03:30:00.000Z',
  runId: null,
  agentId: null,
  mode: 'shadow',
  category: 'git_destructive',
  verdict: 'deny',
  applied: false,
  blocking: false,
  confidence: 0.91,
  reason: null,
  errorCode: null,
  latencyMs: 120,
  model: 'typesafe/jev-1.14',
  command: 'git push --force origin main',
  cwd: null,
  ownerLabel: null,
  labeledByUserId: null,
  labeledAt: null,
  receivedAt: '2026-10-22T03:30:01.000Z',
  ...over,
});

const baseRoutes = (over: Record<string, unknown> = {}) => ({
  ...data('crew.machines', []),
  [`GET ${BASE}/settings`]: { body: settings() },
  [`GET ${BASE}/stats`]: { body: stats() },
  [`GET ${BASE}/gate-events`]: { body: { items: [], nextBefore: null } },
  [`GET ${BASE}/shadow`]: { body: { items: [], nextBefore: null } },
  ...over,
});

const mount = () => renderPage(<JevPage />, { route: 'jev', at: '/TPS/jev' });

describe('JevPage', () => {
  it('người không phải owner nhận câu "chỉ owner" và không gọi API Jev', async () => {
    const s = mockServer({
      ...baseRoutes(),
      ...accessRoute('c-tps', { userId: 'u2', membershipRole: 'operator', contributor: false, canApprove: false }),
    });
    mount();
    expect(await screen.findByText('Trang này chỉ owner xem được')).toBeTruthy();
    expect(s.calls.filter((c) => c.url.includes('/jev/'))).toEqual([]);
  });

  it('ô key là password, tắt autocomplete, không điền sẵn; hiện vân tay khi đã có key', async () => {
    mockServer(
      baseRoutes({ [`GET ${BASE}/settings`]: { body: settings({ hasKey: true, keyFingerprint: 'abcdef012345' }) } }),
    );
    mount();
    const input = (await screen.findByLabelText('Key mới')) as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.value).toBe('');
    expect(screen.getByText('Đã có key · vân tay abcdef012345')).toBeTruthy();
  });

  it('Lưu và kiểm thử: gửi test:true, xóa trắng ô ngay, không để key trên màn', async () => {
    let hasKey = false;
    const s = mockServer(
      baseRoutes({
        [`GET ${BASE}/settings`]: () => ({
          body: settings(hasKey ? { hasKey: true, keyFingerprint: 'abcdef012345' } : {}),
        }),
        [`PUT ${BASE}/key`]: () => {
          hasKey = true;
          return { body: { hasKey: true, keyFingerprint: 'abcdef012345', test: 'ok' } };
        },
      }),
    );
    mount();
    const input = (await screen.findByLabelText('Key mới')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: FAKE_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu và kiểm thử' }));
    expect(input.value).toBe('');
    expect(await screen.findByText('Đã có key · vân tay abcdef012345')).toBeTruthy();
    expect(screen.getByText('Đã lưu key và Jev trả lời được.')).toBeTruthy();
    const put = s.calls.find((c) => c.method === 'PUT' && c.url.endsWith('/key'));
    expect(put?.body).toEqual({ apiKey: FAKE_KEY, test: true });
    expect(document.body.innerHTML).not.toContain(FAKE_KEY);
  });

  it('kiểm thử lỗi 401 hiện "Key sai hoặc bị thu hồi"', async () => {
    mockServer(
      baseRoutes({
        [`PUT ${BASE}/key`]: {
          body: { hasKey: true, keyFingerprint: 'abcdef012345', test: 'error', errorCode: 'auth' },
        },
      }),
    );
    mount();
    fireEvent.change(await screen.findByLabelText('Key mới'), { target: { value: FAKE_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu và kiểm thử' }));
    expect(await screen.findByText('Key sai hoặc bị thu hồi')).toBeTruthy();
  });

  it('Xóa key hỏi xác nhận rồi gọi DELETE', async () => {
    const s = mockServer(
      baseRoutes({
        [`GET ${BASE}/settings`]: { body: settings({ hasKey: true, keyFingerprint: 'abcdef012345' }) },
        [`DELETE ${BASE}/key`]: { body: { hasKey: false } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa key' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa key' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/key'))).toBe(true));
  });

  it('timeout ngoài 500–3000 hiện lỗi ở ô và không gọi PUT', async () => {
    const s = mockServer(baseRoutes());
    mount();
    fireEvent.change(await screen.findByLabelText('Timeout (ms)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    expect(await screen.findByText('Timeout phải là số nguyên từ 500 đến 3000 ms.')).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('lưu cấu hình gửi đủ trường và báo phiên bản mới', async () => {
    const s = mockServer(
      baseRoutes({
        [`PUT ${BASE}/settings`]: { body: settings({ version: 4, threshold: 0.7 }) },
      }),
    );
    mount();
    fireEvent.change(await screen.findByLabelText('Ngưỡng'), { target: { value: '0.7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    expect(await screen.findByText(/Đã lưu cấu hình, phiên bản 4/)).toBeTruthy();
    const put = s.calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings'));
    expect(put?.body).toEqual({
      enabled: true,
      gateMode: 'shadow',
      model: 'typesafe/jev-1.14',
      threshold: 0.7,
      timeoutMs: 2500,
      serverShadow: false,
    });
  });

  it('bảng máy: máy đã nhận bản hiện tại và máy còn ở bản cũ', async () => {
    mockServer(
      baseRoutes({
        [`GET ${BASE}/settings`]: {
          body: settings({
            hasKey: true,
            keyFingerprint: 'abcdef012345',
            machines: [
              {
                machineId: M1,
                appliedVersion: 3,
                keyOk: true,
                lastPullAt: '2026-10-22T03:30:00.000Z',
                lastEventsAt: null,
              },
              {
                machineId: '22222222-2222-4222-8222-222222222222',
                appliedVersion: 2,
                keyOk: false,
                lastPullAt: null,
                lastEventsAt: null,
              },
            ],
          }),
        },
      }),
    );
    mount();
    expect(await screen.findByText('Đã nhận bản 3')).toBeTruthy();
    expect(screen.getByText('Đang ở bản 2 (mới nhất 3)')).toBeTruthy();
    expect(screen.getByText('Key khớp')).toBeTruthy();
    // 03:30Z là 10:30 giờ Việt Nam.
    expect(screen.getByText('22/10/2026 10:30')).toBeTruthy();
  });

  it('số liệu theo ngày và bảng nhóm', async () => {
    mockServer(baseRoutes());
    mount();
    const totals = await screen.findByTestId('jev-totals');
    expect(within(totals).getByText('120 ms')).toBeTruthy();
    expect(within(totals).getByText('340 ms')).toBeTruthy();
    expect(screen.getByText('git_destructive')).toBeTruthy();
  });

  it('ca deny: hiện lệnh, bấm Nhầm gửi nhãn wrong', async () => {
    const s = mockServer(
      baseRoutes({
        [`GET ${BASE}/gate-events`]: { body: { items: [gateEvent()], nextBefore: null } },
        [`POST ${BASE}/gate-events/41/label`]: { body: gateEvent({ ownerLabel: 'wrong' }) },
      }),
    );
    mount();
    const row = await screen.findByTestId('jev-gate-event');
    expect(within(row).getByText('git push --force origin main')).toBeTruthy();
    expect(within(row).getByText('Chưa áp')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Nhầm' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.url.endsWith('/41/label'))).toBe(true));
    expect(s.calls.find((c) => c.url.endsWith('/41/label'))?.body).toEqual({ label: 'wrong' });
  });

  it('dòng log bị Mac bỏ hiện rõ số dòng, mã skipped_bg có nhãn tiếng Việt', async () => {
    mockServer(
      baseRoutes({
        [`GET ${BASE}/gate-events`]: {
          body: {
            items: [
              gateEvent({ id: '2', verdict: 'escalate', errorCode: 'dropped', reason: 'dropped:7', command: '' }),
              gateEvent({ id: '3', errorCode: 'skipped_bg' }),
            ],
            nextBefore: null,
          },
        },
      }),
    );
    mount();
    expect(await screen.findByText('Mac bỏ 7 dòng log chưa gửi')).toBeTruthy();
    expect(screen.getByText('Bỏ qua Jev (đủ tiến trình nền)')).toBeTruthy();
  });

  it('ca lệch C3: hiện nhãn regex và nhãn Jev, link tới run', async () => {
    mockServer(
      baseRoutes({
        [`GET ${BASE}/shadow`]: {
          body: {
            items: [
              {
                id: '9',
                kind: 'liveness',
                runId: 'aaaaaaaa-1111-4111-8111-111111111111',
                regexLabel: 'blocked',
                jevLabel: 'progress',
                confidence: 0.82,
                escalated: false,
                status: 'done',
                errorCode: null,
                latencyMs: 300,
                inputExcerpt: null,
                mismatch: true,
                createdAt: '2026-10-22T03:30:00.000Z',
                evaluatedAt: '2026-10-22T03:31:00.000Z',
              },
            ],
            nextBefore: null,
          },
        },
      }),
    );
    mount();
    const row = await screen.findByTestId('jev-shadow-item');
    expect(within(row).getByText('blocked')).toBeTruthy();
    expect(within(row).getByText('progress')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'aaaaaaaa' }).getAttribute('href')).toBe(
      '/TPS/runs/aaaaaaaa-1111-4111-8111-111111111111',
    );
  });
});
