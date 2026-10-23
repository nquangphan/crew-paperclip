// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MachineSlot } from '@/features/issues/detail/crew/machine-slot';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { ISSUE, wrap } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const ROOT = { ...ISSUE, id: 'i0', parentId: null, ancestors: [] };
const URL = '/api/crew/companies/c1/issues/i0/machine';
const CHILD_URL = '/api/crew/companies/c1/issues/i1/machine';
const view = (pin: unknown, extra: Record<string, unknown> = {}) => ({
  rootIssueId: 'i0',
  isRoot: true,
  locked: false,
  pin,
  ...extra,
});
const AUTO = {
  machineId: 'm-mini',
  hostname: 'Phans-Mac-mini',
  source: 'auto',
  reason: { rule: 'ready', running: 2, load1: 3.9, cpuCount: 10, memFreePct: 54 },
  pinnedAt: '2026-10-24T01:00:00.000Z',
};

describe('dòng Máy trên trang yêu cầu', () => {
  it('máy tự chọn hiện các số lúc chọn', async () => {
    mockServer({ [`GET ${URL}`]: { body: view(AUTO, { locked: true }) } });
    render(wrap(<MachineSlot issue={ROOT as never} />));
    expect((await screen.findByTestId('issue-machine')).textContent).toBe(
      'Phans-Mac-mini · tự chọn (2 run, load 3,9, RAM trống 54%)',
    );
    expect(screen.queryByRole('button', { name: 'Đổi máy' })).toBeNull();
  });

  it('máy owner chọn và cây chưa có máy', async () => {
    mockServer({ [`GET ${URL}`]: { body: view({ ...AUTO, source: 'owner', reason: {} }) } });
    render(wrap(<MachineSlot issue={ROOT as never} />));
    expect((await screen.findByTestId('issue-machine')).textContent).toBe('Phans-Mac-mini · Đại Ca chọn');
    cleanup();
    mockServer({ [`GET ${URL}`]: { body: view(null) } });
    render(wrap(<MachineSlot issue={ROOT as never} />));
    expect((await screen.findByTestId('issue-machine')).textContent).toBe('Chưa chọn máy (tự chọn trước run đầu tiên)');
  });

  it('owner đổi máy được khi cây chưa có run', async () => {
    const { calls } = mockServer({
      [`GET ${URL}`]: { body: view(AUTO) },
      'GET /api/crew/companies/c1/machines': {
        body: {
          items: [
            {
              machineId: 'm-book',
              hostname: 'Phans-MacBook-Pro',
              online: true,
              status: 'ready',
              running: 1,
              load1: 2,
              cpuCount: 12,
              memFreePct: 60,
            },
          ],
        },
      },
      [`PUT ${URL}`]: {
        body: view({ ...AUTO, machineId: 'm-book', hostname: 'Phans-MacBook-Pro', source: 'owner', reason: {} }),
      },
    });
    render(wrap(<MachineSlot issue={ROOT as never} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi máy' }));
    const trigger = await screen.findByRole('combobox', { name: 'Máy' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'Phans-MacBook-Pro · 1 run · load 2' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(screen.getByTestId('issue-machine').textContent).toBe('Phans-MacBook-Pro · Đại Ca chọn'),
    );
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ machineId: 'm-book' });
  });

  it('không phải owner thì không có nút Đổi máy', async () => {
    mockServer({
      ...accessRoute('c1', { userId: 'u3', membershipRole: 'operator', contributor: false, canApprove: false }),
      [`GET ${URL}`]: { body: view(AUTO) },
    });
    render(wrap(<MachineSlot issue={ROOT as never} />));
    await screen.findByTestId('issue-machine');
    expect(screen.queryByRole('button', { name: 'Đổi máy' })).toBeNull();
  });

  it('yêu cầu con (owner) hiện máy của cây nhưng không có nút Đổi máy', async () => {
    mockServer({ [`GET ${CHILD_URL}`]: { body: view(AUTO, { isRoot: false }) } });
    render(wrap(<MachineSlot issue={ISSUE as never} />));
    expect((await screen.findByTestId('issue-machine')).textContent).toContain('Phans-Mac-mini · tự chọn');
    expect(screen.queryByRole('button', { name: 'Đổi máy' })).toBeNull();
  });

  it('lỗi đọc thì ẩn dòng', async () => {
    mockServer({ [`GET ${URL}`]: { status: 503, body: { error: 'chưa có bảng' } } });
    const { container } = render(wrap(<MachineSlot issue={ROOT as never} />));
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
