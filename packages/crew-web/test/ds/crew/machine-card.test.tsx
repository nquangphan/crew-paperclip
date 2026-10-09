// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CrewMachine } from '@/api/crew/types';
import { MachineCard } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';
import fixtures from './__fixtures__/machines.json';

const full = fixtures.full as unknown as CrewMachine['latest'];
const legacy = fixtures.legacy as unknown as CrewMachine['latest'];
const latestAt = '2026-10-10T04:20:00.000Z';
const at = (minutes: number) => new Date(Date.parse(latestAt) + minutes * 60_000);

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

describe('MachineCard', () => {
  it('cách 4 phút hiện "Mất liên lạc"', () => {
    render(<MachineCard report={full} latestAt={latestAt} now={at(4)} />);
    expect(screen.getByText('Mất liên lạc')).toBeTruthy();
    expect(screen.queryByText('Trực tuyến')).toBeNull();
  });
  it('đúng 3 phút vẫn trực tuyến', () => {
    render(<MachineCard report={full} latestAt={latestAt} now={at(3)} />);
    expect(screen.getByText('Trực tuyến')).toBeTruthy();
  });
  it('hiện hostname, tải, claude, app, superpowers, TCC và cảnh báo', () => {
    render(<MachineCard report={full} latestAt={latestAt} now={at(1)} />);
    expect(screen.getByText('mac-mini')).toBeTruthy();
    expect(screen.getByText(/Tải 1 phút: 1\.5 \/ 8 CPU/)).toBeTruthy();
    expect(screen.getByText(/Claude 2\.1\.9 · đã đăng nhập · gói max/)).toBeTruthy();
    expect(screen.getByText(/App 2P Crew 1\.4\.0/)).toBeTruthy();
    expect(screen.getByText(/ghim 5\.2\.0/)).toBeTruthy();
    expect(screen.getByText(/Accessibility · com\.2p\.crew/)).toBeTruthy();
    expect(screen.getByText('Cảnh báo: Đĩa gần đầy')).toBeTruthy();
    expect(screen.getByText('Lỗi: Thiếu git')).toBeTruthy();
    expect(screen.getByText(/1 checkout/)).toBeTruthy();
  });
  it('report thiếu checkouts và app vẫn render', () => {
    render(<MachineCard report={legacy} latestAt={latestAt} now={at(1)} />);
    expect(screen.getByText('mac-cu')).toBeTruthy();
    expect(screen.getByText(/Chạy bằng CLI/)).toBeTruthy();
    expect(screen.getAllByText(/Không rõ/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/checkout/)).toBeNull();
  });
  it('vẽ biểu đồ tải 24 giờ khi có dữ liệu', () => {
    render(<MachineCard report={full} latestAt={latestAt} now={at(1)} load24h={fixtures.load24h} />);
    expect(screen.getByRole('img')).toBeTruthy();
  });
  it('tiếng Anh', async () => {
    await setLanguage('en');
    render(<MachineCard report={full} latestAt={latestAt} now={at(5)} />);
    expect(screen.getByText('Offline')).toBeTruthy();
  });
});
