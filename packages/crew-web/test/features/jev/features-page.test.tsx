// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { JevPage } from '@/features/jev/jev-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, renderPage } from '../agents/helpers';

beforeAll(async () => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const BASE = '/api/crew/companies/c-tps/jev';

const settings = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  gateMode: 'shadow',
  model: 'typesafe/jev-1.14',
  threshold: 0.5,
  timeoutMs: 2500,
  serverShadow: false,
  features: { complexity: 'shadow', approval_note: 'on', request_type: 'shadow', inbox_attention: 'off' },
  hasKey: true,
  keyFingerprint: 'abcdef012345',
  version: 3,
  updatedAt: null,
  machines: [],
  ...over,
});

const zero = { done: 0, mismatch: 0, escalated: 0, error: 0, pending: 0 };
const gateStats = {
  days: 7,
  gate: {
    calls: 0,
    allow: 0,
    deny: 0,
    escalate: 0,
    error: 0,
    appliedDeny: 0,
    p50Ms: null,
    p95Ms: null,
    byCategory: [],
    byDay: [],
  },
  shadow: { liveness: zero, runtime: zero },
};

const STAT_ROWS = {
  days: 7,
  rows: [
    {
      feature: 'approval_note',
      mode: 'on',
      total: 12,
      mismatch: 3,
      escalated: 1,
      error: 2,
      shown: 3,
      p50Ms: 410,
      p95Ms: 980,
      outcomes: {},
    },
    {
      feature: 'approval_note',
      mode: 'shadow',
      total: 8,
      mismatch: 1,
      escalated: 0,
      error: 0,
      shown: 0,
      p50Ms: 350,
      p95Ms: 700,
      outcomes: {},
    },
  ],
};

const MISMATCH = {
  items: [
    {
      id: '31',
      feature: 'complexity',
      issueId: null,
      mode: 'on',
      jevLabel: 'yes',
      confidence: 0.82,
      escalated: false,
      errorCode: null,
      latencyMs: 400,
      baseline: 'small',
      mismatch: true,
      shown: true,
      ownerOutcome: null,
      inputExcerpt: 'Sửa bảng users thêm cột role',
      createdAt: '2026-10-22T03:30:00.000Z',
    },
  ],
  nextBefore: null,
};

const routes = (over: Record<string, unknown> = {}) => ({
  ...data('crew.machines', []),
  [`GET ${BASE}/settings`]: { body: settings() },
  [`GET ${BASE}/stats`]: { body: gateStats },
  [`GET ${BASE}/gate-events`]: { body: { items: [], nextBefore: null } },
  [`GET ${BASE}/shadow`]: { body: { items: [], nextBefore: null } },
  [`GET ${BASE}/judgments/stats`]: { body: STAT_ROWS },
  [`GET ${BASE}/judgments`]: { body: MISMATCH },
  ...over,
});

const mount = () => renderPage(<JevPage />, { route: 'jev', at: '/TPS/jev' });
const puts = (s: ReturnType<typeof mockServer>) =>
  s.calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/settings'));

describe('công tắc chung', () => {
  it('nút "Tắt toàn bộ Jev" nổi bật, phải xác nhận, rồi lưu enabled=false giữ nguyên các trường khác', async () => {
    const s = mockServer(routes({ [`PUT ${BASE}/settings`]: { body: settings({ enabled: false, version: 4 }) } }));
    mount();
    const off = await screen.findByRole('button', { name: 'Tắt toàn bộ Jev' });
    expect(screen.getByText('Jev đang bật')).toBeTruthy();
    fireEvent.click(off);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/cổng chặn lệnh trên máy.*so sánh C3.*cả bốn tính năng/s)).toBeTruthy();
    expect(puts(s)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tắt toàn bộ Jev' }));
    await waitFor(() => expect(puts(s)).toHaveLength(1));
    expect(puts(s)[0].body).toEqual({
      enabled: false,
      gateMode: 'shadow',
      model: 'typesafe/jev-1.14',
      threshold: 0.5,
      timeoutMs: 2500,
      serverShadow: false,
      features: { complexity: 'shadow', approval_note: 'on', request_type: 'shadow', inbox_attention: 'off' },
    });
    expect(await screen.findByText('Jev đang tắt toàn bộ')).toBeTruthy();
    expect(screen.getByText(/Công tắc chung đang tắt nên chưa tính năng nào chạy/)).toBeTruthy();
  });

  it('Hủy trong hộp xác nhận thì không lưu gì', async () => {
    const s = mockServer(routes());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Tắt toàn bộ Jev' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hủy' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(puts(s)).toHaveLength(0);
  });

  it('đang tắt thì có nút Bật lại Jev, bấm là lưu enabled=true không hỏi', async () => {
    const s = mockServer(
      routes({
        [`GET ${BASE}/settings`]: { body: settings({ enabled: false }) },
        [`PUT ${BASE}/settings`]: { body: settings({ version: 4 }) },
      }),
    );
    mount();
    expect(await screen.findByText('Jev đang tắt toàn bộ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tắt toàn bộ Jev' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bật lại Jev' }));
    await waitFor(() => expect(puts(s)).toHaveLength(1));
    expect((puts(s)[0].body as { enabled: boolean }).enabled).toBe(true);
  });

  it('server từ chối thì hiện lỗi và công tắc giữ nguyên', async () => {
    mockServer(routes({ [`PUT ${BASE}/settings`]: { status: 503, body: { error: 'Jev chưa sẵn sàng' } } }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Tắt toàn bộ Jev' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Tắt toàn bộ Jev' }));
    expect(await screen.findByText('Jev chưa sẵn sàng')).toBeTruthy();
    expect(screen.getByText('Jev đang bật')).toBeTruthy();
  });
});

describe('bốn tính năng', () => {
  it('liệt kê đủ bốn tính năng với chế độ hiện tại và một dòng giải thích mỗi cái', async () => {
    mockServer(routes());
    mount();
    for (const id of ['complexity', 'approval_note', 'request_type', 'inbox_attention']) {
      expect(await screen.findByTestId(`jev-feature-${id}`)).toBeTruthy();
    }
    expect(screen.getByRole('combobox', { name: 'Chế độ của Hỏi lại lời nhắn Duyệt' }).textContent).toBe('Bật');
    expect(screen.getByRole('combobox', { name: 'Chế độ của Kiểm mức complexity' }).textContent).toBe('Chỉ ghi log');
    expect(screen.getByRole('combobox', { name: 'Chế độ của Cần Đại Ca để ý' }).textContent).toBe('Tắt');
    expect(screen.getByText(/Đọc lời nhắn khi Duyệt hoặc Yêu cầu sửa/)).toBeTruthy();
  });

  it('thiếu khóa trong features được coi là shadow', async () => {
    mockServer(routes({ [`GET ${BASE}/settings`]: { body: settings({ features: undefined }) } }));
    mount();
    await screen.findByTestId('jev-feature-complexity');
    for (const name of ['Kiểm mức complexity', 'Gợi ý loại yêu cầu']) {
      expect(screen.getByRole('combobox', { name: `Chế độ của ${name}` }).textContent).toBe('Chỉ ghi log');
    }
  });

  it('đổi chế độ lưu ngay, chỉ đổi đúng tính năng đó', async () => {
    const s = mockServer(routes({ [`PUT ${BASE}/settings`]: { body: settings({ version: 4 }) } }));
    mount();
    const trigger = await screen.findByRole('combobox', { name: 'Chế độ của Gợi ý loại yêu cầu' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Bật' }));
    await waitFor(() => expect(puts(s)).toHaveLength(1));
    expect((puts(s)[0].body as { features: unknown; enabled: boolean }).features).toEqual({
      complexity: 'shadow',
      approval_note: 'on',
      request_type: 'on',
      inbox_attention: 'off',
    });
    expect((puts(s)[0].body as { enabled: boolean }).enabled).toBe(true);
  });

  it('thống kê gộp shadow + on: tổng, lệch, không chắc, lỗi, p50/p95', async () => {
    mockServer(routes());
    mount();
    const stats = await screen.findByTestId('jev-feature-stats-approval_note');
    expect(within(stats).getByText('20 lượt')).toBeTruthy();
    expect(within(stats).getByText('4 lệch')).toBeTruthy();
    expect(within(stats).getByText('1 không chắc')).toBeTruthy();
    expect(within(stats).getByText('2 lỗi')).toBeTruthy();
    expect(within(stats).getByText('p50 410 ms · p95 980 ms')).toBeTruthy();
    expect(within(screen.getByTestId('jev-feature-complexity')).getByText('Chưa có lượt nào.')).toBeTruthy();
  });

  it.each([
    ['HTTP 500', { status: 500, body: { error: 'x' } }],
    ['sai dạng', { body: 'không phải JSON thống kê' }],
    ['404 (server cũ)', { status: 404, body: { error: 'no' } }],
  ])('thống kê %s: trang vẫn dùng được, không báo lỗi to', async (_n, reply) => {
    mockServer(routes({ [`GET ${BASE}/judgments/stats`]: reply }));
    mount();
    await screen.findByTestId('jev-feature-complexity');
    expect(await screen.findAllByText(/Chưa có (số liệu|lượt nào)\./)).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Tắt toàn bộ Jev' })).toBeTruthy();
  });
});

describe('ca lệch của từng tính năng', () => {
  it('hiện bảng ca lệch của tính năng đang chọn và gọi đúng bộ lọc', async () => {
    const s = mockServer(routes());
    mount();
    const row = await screen.findByTestId('jev-mismatch-row');
    expect(within(row).getByText('small')).toBeTruthy();
    expect(within(row).getByText('yes')).toBeTruthy();
    expect(within(row).getByText('0.82')).toBeTruthy();
    expect(within(row).getByText('Sửa bảng users thêm cột role')).toBeTruthy();
    const call = s.calls.find((c) => c.url.includes('/jev/judgments?'));
    expect(call?.url).toContain('feature=complexity');
    expect(call?.url).toContain('mismatch=true');
  });

  it('đổi tab sang tính năng khác thì hỏi lại theo tính năng đó', async () => {
    const s = mockServer(routes());
    mount();
    await screen.findByTestId('jev-mismatch-row');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Gợi ý loại yêu cầu' }), { button: 0 });
    await waitFor(() => expect(s.calls.some((c) => c.url.includes('feature=request_type'))).toBe(true));
  });

  it('không có ca lệch thì báo rỗng; lỗi thì một dòng nhẹ', async () => {
    mockServer(routes({ [`GET ${BASE}/judgments`]: { body: { items: [], nextBefore: null } } }));
    mount();
    expect(await screen.findByText('Chưa có ca lệch nào')).toBeTruthy();
    cleanup();
    mockServer(routes({ [`GET ${BASE}/judgments`]: { status: 503, body: { error: 'x' } } }));
    mount();
    expect(await screen.findByText('Chưa tải được danh sách ca lệch.')).toBeTruthy();
  });
});
