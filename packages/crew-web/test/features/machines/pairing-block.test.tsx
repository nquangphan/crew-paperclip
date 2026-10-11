// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CrewMachinePairing } from '@/api';
import { MachinesPage } from '@/features/machines/machines-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { data, renderPage } from '../agents/helpers';
import { M1, machine, ROUTE } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const ENV = '44444444-4444-4444-8444-444444444444';
const PAIRED = { pairedAt: '2026-10-11T00:30:00.000Z', revokedAt: null, environmentId: ENV, tailscaleIp: '100.64.0.7' };
const REVOKED = { ...PAIRED, revokedAt: '2026-10-11T02:05:00.000Z' };
const ARCHIVE = `PATCH /api/environments/${ENV}`;
const READ_ENV = `GET /api/environments/${ENV}`;
const environment = (config: Record<string, unknown>) => ({
  body: { id: ENV, name: 'may-macbook', status: 'active', config },
});
const UNPAIR = `${ROUTE}/machines/${M1}/unpair`;
const mount = () => renderPage(<MachinesPage />, { route: 'machines', at: '/TPS/machines' });
const REMOVED_UNPAIRED = {
  pairedAt: null,
  revokedAt: '2026-10-11T02:05:00.000Z',
  environmentId: null,
  tailscaleIp: null,
} as const;
const base = (pairing: CrewMachinePairing | null, extra: Record<string, unknown> = {}) => ({
  ...data('crew.machines', [machine({ pairing })]),
  ...data('crew.machineJobs', []),
  'GET /api/plugins/crew.core/api/runtime-switches?companyId=c-tps': { body: { machines: [] } },
  [READ_ENV]: environment({ host: '100.64.0.7', port: 2222 }),
  ...extra,
});
const writes = (s: { calls: { method: string; url: string }[] }) =>
  s.calls.filter((c) => c.method !== 'GET' && !c.url.includes('/data/')).map((c) => `${c.method} ${c.url}`);

describe('nhãn ghép và nút Gỡ máy', () => {
  it('máy còn ghép hiện "Đã ghép" theo giờ Việt Nam và nút Gỡ máy cho owner', async () => {
    mockServer(base(PAIRED));
    mount();
    expect(await screen.findByText('Đã ghép 11/10/2026 07:30')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Gỡ máy' })).toBeTruthy();
  });

  it('viewer không thấy nút Gỡ máy nhưng vẫn thấy nhãn', async () => {
    const s = mockServer(
      base(
        PAIRED,
        accessRoute('c-tps', { userId: 'u2', membershipRole: 'viewer', contributor: false, canApprove: false }),
      ),
    );
    mount();
    expect(await screen.findByText(/^Đã ghép/)).toBeTruthy();
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/access'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20)); // để vai trò viewer áp vào cây React
    expect(screen.queryByRole('button', { name: 'Gỡ máy' })).toBeNull();
  });

  it('máy đã gỡ hiện "Đã gỡ" và không có nút', async () => {
    mockServer(base(REVOKED));
    mount();
    expect(await screen.findByText('Đã gỡ 11/10/2026 09:05')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gỡ máy' })).toBeNull();
  });

  it('máy chưa ghép (dùng secret company) không có nhãn nhưng owner có nút Gỡ máy', async () => {
    mockServer(base(null));
    mount();
    expect(await screen.findByText('mac-mini')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Gỡ máy' })).toBeTruthy();
    expect(screen.queryByText(/^Đã (ghép|gỡ)/)).toBeNull();
  });

  it('viewer không thấy nút Gỡ máy trên máy chưa ghép', async () => {
    const s = mockServer(
      base(
        null,
        accessRoute('c-tps', { userId: 'u2', membershipRole: 'viewer', contributor: false, canApprove: false }),
      ),
    );
    mount();
    expect(await screen.findByText('mac-mini')).toBeTruthy();
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/access'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20)); // để vai trò viewer áp vào cây React
    expect(screen.queryByRole('button', { name: 'Gỡ máy' })).toBeNull();
  });

  it('máy chưa ghép: xác nhận có cảnh báo secret chung và "Ghép lại", chỉ gọi unpair, không đọc hay archive environment', async () => {
    const s = mockServer(
      base(null, { [UNPAIR]: { body: { environmentId: null, revokedAt: '2026-10-11T02:05:00.000Z' } } }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ máy' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/đang gửi bản tin bằng secret chung của company/)).toBeTruthy();
    expect(within(dialog).getByText(/kể cả bản tin ký bằng secret chung/)).toBeTruthy();
    expect(within(dialog).getByText(/bấm "Ghép lại"/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gỡ máy' }));
    await waitFor(() => expect(writes(s)).toEqual([UNPAIR]));
    expect(s.calls.find((c) => c.url.endsWith('/unpair'))?.body).toEqual({ companyId: 'c-tps' });
    expect(s.calls.some((c) => c.url.startsWith('/api/environments'))).toBe(false);
  });

  it('máy chưa ghép: unpair lỗi hiện nguyên văn và nút còn đó', async () => {
    mockServer(base(null, { [UNPAIR]: { status: 404, body: { error: 'Không có máy này trong company' } } }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ máy' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gỡ máy' }));
    expect(await screen.findByText('Không có máy này trong company')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gỡ máy' })).toBeTruthy();
  });

  it('máy chưa ghép đã bị gỡ hiện "Đã gỡ" và không có nút', async () => {
    mockServer(base(REMOVED_UNPAIRED));
    mount();
    expect(await screen.findByText('Đã gỡ 11/10/2026 09:05')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gỡ máy' })).toBeNull();
  });

  it('bấm Gỡ máy phải xác nhận; hủy thì không gọi gì', async () => {
    const s = mockServer(base(PAIRED));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ máy' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/sẽ không nhận run mới và bản tin của nó bị từ chối/)).toBeTruthy();
    expect(within(dialog).getByText(/bấm "Ghép lại"/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(writes(s)).toEqual([]);
  });

  it('xác nhận thì archive environment trước (PATCH, không DELETE) rồi mới unpair', async () => {
    const s = mockServer(
      base(PAIRED, {
        [ARCHIVE]: { body: { id: ENV, status: 'archived' } },
        [UNPAIR]: { body: { environmentId: ENV, revokedAt: '2026-10-11T02:05:00.000Z' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ máy' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gỡ máy' }));
    await waitFor(() => expect(writes(s)).toHaveLength(2));
    expect(writes(s)).toEqual([`PATCH /api/environments/${ENV}`, UNPAIR]);
    const readAt = s.calls.findIndex((c) => c.method === 'GET' && c.url === `/api/environments/${ENV}`);
    expect(readAt).toBeGreaterThanOrEqual(0);
    expect(readAt).toBeLessThan(s.calls.findIndex((c) => c.method === 'PATCH'));
    expect(s.calls.find((c) => c.url.endsWith('/unpair'))?.body).toEqual({ companyId: 'c-tps' });
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'archived' });
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('host của environment khác IP Tailscale đã ghép thì báo lỗi, không archive và không unpair', async () => {
    const s = mockServer(
      base(PAIRED, {
        [READ_ENV]: environment({ host: '100.100.1.2', port: 2222 }),
        [ARCHIVE]: { body: { id: ENV, status: 'archived' } },
        [UNPAIR]: { body: { environmentId: ENV, revokedAt: '2026-10-11T02:05:00.000Z' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ máy' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gỡ máy' }));
    expect(
      await screen.findByText(
        'Environment may-macbook trỏ tới 100.100.1.2, không phải 100.64.0.7 của máy này. Không gỡ để tránh archive nhầm máy khác.',
      ),
    ).toBeTruthy();
    expect(writes(s)).toEqual([]);
    expect(screen.getByRole('button', { name: 'Gỡ máy' })).toBeTruthy();
  });

  it('không đọc được host (server che config) thì cũng không archive', async () => {
    const s = mockServer(base(PAIRED, { [READ_ENV]: environment({}), [ARCHIVE]: { body: { id: ENV } } }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ máy' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gỡ máy' }));
    expect(await screen.findByText(/trỏ tới \?, không phải 100\.64\.0\.7/)).toBeTruthy();
    expect(writes(s)).toEqual([]);
  });

  it('archive lỗi thì hiện nguyên văn, không unpair; bấm lại đi tiếp', async () => {
    let archiveOk = false;
    const s = mockServer(
      base(PAIRED, {
        [ARCHIVE]: () => (archiveOk ? { body: { id: ENV } } : { status: 500, body: { error: 'Máy chủ bận, thử lại' } }),
        [UNPAIR]: { body: { environmentId: ENV, revokedAt: '2026-10-11T02:05:00.000Z' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ máy' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gỡ máy' }));
    expect(await screen.findByText('Máy chủ bận, thử lại')).toBeTruthy();
    expect(writes(s)).toEqual([`PATCH /api/environments/${ENV}`]);
    expect(screen.getByRole('button', { name: 'Gỡ máy' })).toBeTruthy();

    archiveOk = true;
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ máy' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gỡ máy' }));
    await waitFor(() => expect(writes(s)).toHaveLength(3));
    expect(writes(s)[2]).toBe(UNPAIR);
  });

  it('unpair lỗi 404 hiện nguyên văn của server và nút còn đó', async () => {
    mockServer(
      base(PAIRED, {
        [ARCHIVE]: { body: { id: ENV } },
        [UNPAIR]: { status: 404, body: { error: 'Máy chưa được ghép' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ máy' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gỡ máy' }));
    expect(await screen.findByText('Máy chưa được ghép')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gỡ máy' })).toBeTruthy();
  });
});
