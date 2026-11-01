// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { TerminalTargetsBlock } from '@/features/machines/terminal-targets-block';
import { TerminalDockProvider } from '@/features/terminal/terminal-dock';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';

// jsdom không có canvas/ResizeObserver: thay lớp gắn xterm bằng terminal giả.
vi.mock('@/features/terminal/mount-xterm', () => ({
  mountXterm: () => ({
    term: {
      onData: () => ({ dispose: () => {} }),
      write: () => {},
      focus: () => {},
      options: {},
    },
    fit: () => ({ cols: 80, rows: 24 }),
    dispose: () => {},
  }),
}));

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const MACHINE = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT = '33333333-3333-4333-8333-333333333333';
const TARGETS = {
  'GET /api/crew/companies/c1/terminal/targets': {
    body: {
      items: [
        {
          machineId: MACHINE,
          hostname: 'mac-mini',
          projectId: PROJECT,
          projectName: 'Paperclip',
          projectKey: 'paperclip',
          branch: 'main',
        },
        {
          machineId: MACHINE,
          hostname: 'mac-mini',
          projectId: OTHER_PROJECT,
          projectName: 'Kidy School',
          projectKey: 'kidy-school',
          branch: null,
        },
      ],
    },
  },
};
const LOCKED = {
  'POST /api/crew/companies/c1/terminal/tickets': {
    status: 423,
    body: { error: 'Terminal đang khoá, hãy nhập mật khẩu để mở.', code: 'crew_terminal_locked' },
  },
};

const mount = (children: React.ReactNode = <p>Trang đang xem</p>) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
          <TerminalDockProvider>{children}</TerminalDockProvider>
        </CompanyContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const launcher = () => screen.findByRole('button', { name: /terminal$/ });
const panel = () => document.querySelector('[data-slot="terminal-dock"]') as HTMLElement | null;

describe('khung nổi terminal', () => {
  it('owner có nút tròn; bấm mở khung, terminal khoá thì hỏi mật khẩu ngay trong khung', async () => {
    const ws = vi.fn();
    vi.stubGlobal('WebSocket', ws);
    mockServer({ ...TARGETS, ...LOCKED });
    mount();
    const button = await launcher();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByLabelText('Mật khẩu')).toBeTruthy();
    expect(screen.getByText('Trang đang xem')).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(ws).not.toHaveBeenCalled();
  });

  it('ẩn chỉ giấu khung, không gỡ phiên; bấm nút tròn lại hiện đúng phiên cũ', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    const s = mockServer({ ...TARGETS, ...LOCKED });
    mount();
    fireEvent.click(await launcher());
    const region = await screen.findByRole('region', { name: 'Mở khoá terminal' });
    fireEvent.click(within(region).getByRole('button', { name: 'Ẩn terminal' }));
    expect(panel()?.hidden).toBe(true);
    const tickets = s.calls.filter((c) => c.url.includes('/terminal/tickets')).length;
    fireEvent.click(await launcher());
    expect(panel()?.hidden).toBe(false);
    expect(screen.getByLabelText('Mật khẩu')).toBeTruthy();
    expect(s.calls.filter((c) => c.url.includes('/terminal/tickets')).length).toBe(tickets);
  });

  it('không phải owner thì không có nút tròn', async () => {
    mockServer({
      ...TARGETS,
      ...accessRoute('c1', { userId: 'u2', membershipRole: 'viewer', contributor: false, canApprove: false }),
    });
    mount();
    await screen.findByText('Trang đang xem');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole('button', { name: /terminal$/ })).toBeNull();
  });

  it('server đóng phiên thì hiện câu hướng dẫn, không hiện lý do thô', async () => {
    const sockets: { onmessage: ((e: { data: string }) => void) | null; onclose: (() => void) | null }[] = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;
        readyState = 1;
        onmessage: ((e: { data: string }) => void) | null = null;
        onclose: (() => void) | null = null;
        constructor() {
          sockets.push(this);
        }
        send() {}
        close() {}
      },
    );
    mockServer({
      ...TARGETS,
      'POST /api/crew/companies/c1/terminal/tickets': { status: 201, body: { ticket: 't1', expiresAt: 'x' } },
    });
    mount();
    fireEvent.click(await launcher());
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'closed', reason: 'shell_closed' }) });
      sockets[0].onclose?.();
    });
    expect(await screen.findByText(/Phiên terminal đã ngắt/)).toBeTruthy();
    expect(screen.queryByText(/shell_closed/)).toBeNull();
  });

  it('vé trả 403 (hết phiên hoặc mất quyền owner) thì bảo tải lại trang', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({ ...TARGETS, 'POST /api/crew/companies/c1/terminal/tickets': { status: 403, body: { error: 'x' } } });
    mount();
    fireEvent.click(await launcher());
    expect(await screen.findByText('Hết phiên đăng nhập')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tải lại trang/ })).toBeTruthy();
  });

  it('nút tiêu đề đổi sang dự án khác tại chỗ và nhớ lựa chọn', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({ ...TARGETS, ...LOCKED });
    mount();
    fireEvent.click(await launcher());
    const trigger = await screen.findByRole('button', { name: 'Đổi dự án hoặc máy' });
    await vi.waitFor(() => expect(trigger.textContent).toMatch(/Paperclip/));
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Kidy School/ }));
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Đổi dự án hoặc máy' }).textContent).toMatch(/Kidy School/),
    );
    expect(localStorage.getItem('crew.terminal.dockTarget.c1')).toContain(OTHER_PROJECT);
  });

  it('nút Mở terminal trên trang Máy mở khung nổi ở đúng dự án đó', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({ ...TARGETS, ...LOCKED });
    mount(<TerminalTargetsBlock companyId="c1" />);
    const section = await screen.findByRole('region', { name: 'Terminal' });
    const row = (await within(section).findByText('Kidy School')).closest('div')?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Mở terminal' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Đổi dự án hoặc máy' }).textContent).toMatch(/Kidy School/),
    );
  });
});
