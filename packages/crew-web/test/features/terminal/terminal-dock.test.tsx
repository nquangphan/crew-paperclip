// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { TerminalTargetsBlock } from '@/features/machines/terminal-targets-block';
import { addTab, removeTab, TerminalDockProvider } from '@/features/terminal/terminal-dock';
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

const launcher = () => screen.findByRole('button', { name: /^(Mở|Ẩn) terminal/ });
const panel = () => document.querySelector('[data-slot="terminal-dock"]') as HTMLElement | null;
const tickets = (s: { calls: { url: string }[] }) => s.calls.filter((c) => c.url.includes('/terminal/tickets')).length;

/** WebSocket giả: mỗi phiên tạo một socket; `ready` để phiên chuyển sang đã kết nối. */
function fakeSockets() {
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
  return sockets;
}
const TICKET_OK = {
  'POST /api/crew/companies/c1/terminal/tickets': { status: 201, body: { ticket: 't1', expiresAt: 'x' } },
};

async function openProject(name: RegExp) {
  const list = await screen.findByRole('region', { name: 'mac-mini' });
  fireEvent.click(within(list).getByRole('button', { name }));
}

describe('khung nổi terminal', () => {
  it('bấm nút tròn lần đầu không tự mở terminal nào, chỉ hiện danh sách dự án để chọn', async () => {
    const ws = vi.fn();
    vi.stubGlobal('WebSocket', ws);
    const s = mockServer({ ...TARGETS, ...LOCKED });
    mount();
    const button = await launcher();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByText('Chưa mở terminal nào')).toBeTruthy();
    expect(screen.getByText('Trang đang xem')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(tickets(s)).toBe(0);
    expect(ws).not.toHaveBeenCalled();
  });

  it('chọn dự án thì mở tab; terminal khoá thì hỏi mật khẩu ngay trong khung', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({ ...TARGETS, ...LOCKED });
    mount();
    fireEvent.click(await launcher());
    await openProject(/Paperclip/);
    expect(await screen.findByLabelText('Mật khẩu')).toBeTruthy();
    const tabs = within(screen.getByRole('tablist', { name: 'Các terminal đang mở' })).getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].textContent).toMatch(/Paperclip/);
    await vi.waitFor(() => expect(tabs[0].textContent).toMatch(/Đang khoá/));
    expect(screen.getByText('1 terminal · 0 đang kết nối')).toBeTruthy();
  });

  it('mở hai dự án: đếm số đang mở, số đang kết nối và trạng thái từng tab; nút tròn hiện số đó', async () => {
    const sockets = fakeSockets();
    mockServer({ ...TARGETS, ...TICKET_OK });
    mount();
    fireEvent.click(await launcher());
    await openProject(/Paperclip/);
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Mở thêm terminal' }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Kidy School/ }));
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    act(() => sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) }));
    expect(await screen.findByText('2 terminal · 1 đang kết nối')).toBeTruthy();
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual([
      expect.stringMatching(/Paperclip.*mac-mini.*Đã kết nối/),
      expect.stringMatching(/Kidy School.*mac-mini.*Đang kết nối/),
    ]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(panel() as HTMLElement).getByRole('button', { name: 'Ẩn terminal' }));
    const button = await launcher();
    expect(button.getAttribute('aria-label')).toBe('Mở terminal (2 đang mở, 1 đang kết nối)');
    expect(button.textContent).toContain('1/2');
  });

  it('ẩn khung hay đổi tab chỉ giấu, không nối lại; đóng tab thì bỏ tab, hết tab thì về danh sách chọn', async () => {
    const sockets = fakeSockets();
    const s = mockServer({ ...TARGETS, ...TICKET_OK });
    mount();
    fireEvent.click(await launcher());
    await openProject(/Paperclip/);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const before = tickets(s);
    fireEvent.click(within(panel() as HTMLElement).getByRole('button', { name: 'Ẩn terminal' }));
    expect(panel()?.hidden).toBe(true);
    fireEvent.click(await launcher());
    expect(panel()?.hidden).toBe(false);
    expect(tickets(s)).toBe(before);
    expect(sockets).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng terminal Paperclip' }));
    expect(await screen.findByText('Chưa mở terminal nào')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
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
    expect(screen.queryByRole('button', { name: /terminal/ })).toBeNull();
  });

  it('server đóng phiên thì tab báo đã ngắt, không hiện lý do thô', async () => {
    const sockets = fakeSockets();
    mockServer({ ...TARGETS, ...TICKET_OK });
    mount();
    fireEvent.click(await launcher());
    await openProject(/Paperclip/);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'closed', reason: 'shell_closed' }) });
      sockets[0].onclose?.();
    });
    expect(await screen.findByText(/Phiên terminal đã ngắt/)).toBeTruthy();
    expect(within(screen.getByRole('tablist')).getByRole('tab').textContent).toMatch(/Đã ngắt/);
    expect(screen.queryByText(/shell_closed/)).toBeNull();
  });

  it('vé trả 403 (hết phiên hoặc mất quyền owner) thì bảo tải lại trang', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({ ...TARGETS, 'POST /api/crew/companies/c1/terminal/tickets': { status: 403, body: { error: 'x' } } });
    mount();
    fireEvent.click(await launcher());
    await openProject(/Paperclip/);
    expect(await screen.findByText('Hết phiên đăng nhập')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tải lại trang/ })).toBeTruthy();
  });

  it('nút Mở terminal trên trang Máy mở tab ở đúng dự án đó', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({ ...TARGETS, ...LOCKED });
    mount(<TerminalTargetsBlock companyId="c1" />);
    const section = await screen.findByRole('region', { name: 'Terminal' });
    const row = (await within(section).findByText('Kidy School')).closest('div')?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Mở terminal' }));
    const tab = await screen.findByRole('tab');
    expect(tab.textContent).toMatch(/Kidy School/);
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});

describe('phiên trên máy', () => {
  const SESSIONS = {
    'GET /api/crew/companies/c1/terminal/sessions': {
      body: {
        items: [
          {
            machineId: MACHINE,
            hostname: 'mac-mini',
            projectKey: 'kidy-school',
            projectId: OTHER_PROJECT,
            projectName: 'Kidy School',
            attached: 2,
            createdAt: '2026-11-01T00:25:08.000Z',
            activityAt: '2026-11-01T14:51:23.000Z',
          },
          {
            machineId: MACHINE,
            hostname: 'mac-mini',
            projectKey: 'du-an-cu',
            projectId: null,
            projectName: null,
            attached: 0,
            createdAt: '2026-11-01T00:25:08.000Z',
            activityAt: '2026-11-01T14:51:23.000Z',
          },
        ],
        machines: [
          { machineId: MACHINE, hostname: 'mac-mini', ok: true },
          { machineId: '44444444-4444-4444-8444-444444444444', hostname: 'macbook', ok: false },
        ],
      },
    },
  };

  it('đếm phiên đang sống trên máy, hiện người đang xem, máy không hỏi được; Mở thì mở tab cho phiên đó', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({ ...TARGETS, ...LOCKED, ...SESSIONS });
    mount();
    fireEvent.click(await launcher());
    expect(await screen.findByText('2 phiên trên máy')).toBeTruthy();
    // Danh sách chọn ghi chú dự án đang có phiên trên máy.
    const list = await screen.findByRole('region', { name: 'mac-mini' });
    expect(within(list).getByRole('button', { name: /Kidy School.*đang chạy trên máy/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Phiên trên máy' }));
    const mini = await screen.findByRole('region', { name: 'mac-mini' });
    expect(within(mini).getByText(/2 cửa sổ đang xem/)).toBeTruthy();
    expect(within(mini).getByText('du-an-cu')).toBeTruthy();
    expect(within(mini).getByText(/dự án không còn sẵn sàng.*không ai đang xem/)).toBeTruthy();
    const opens = within(mini).getAllByRole('button', { name: 'Mở' });
    expect(opens[1].hasAttribute('disabled')).toBe(true);
    expect(within(screen.getByRole('region', { name: 'macbook' })).getByText(/Không hỏi được máy này/)).toBeTruthy();
    fireEvent.click(opens[0]);
    const tab = await screen.findByRole('tab');
    expect(tab.textContent).toMatch(/Kidy School/);
    expect(screen.getByRole('button', { name: 'Phiên trên máy' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('xem phiên trên máy không gỡ tab đang mở (không đóng socket, không xin vé mới)', async () => {
    const closed = vi.fn();
    const sockets: unknown[] = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;
        readyState = 1;
        onmessage = null;
        onclose = null;
        constructor() {
          sockets.push(this);
        }
        send() {}
        close() {
          closed();
        }
      },
    );
    const s = mockServer({ ...TARGETS, ...TICKET_OK, ...SESSIONS });
    mount();
    fireEvent.click(await launcher());
    await openProject(/Paperclip/);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const before = tickets(s);
    fireEvent.click(screen.getByRole('button', { name: 'Phiên trên máy' }));
    await screen.findByText(/2 cửa sổ đang xem/);
    fireEvent.click(screen.getByRole('button', { name: 'Phiên trên máy' }));
    expect(await screen.findByRole('tab')).toBeTruthy();
    expect(closed).not.toHaveBeenCalled();
    expect(tickets(s)).toBe(before);
  });

  it('Tắt phiên: hỏi xác nhận, gọi tắt đúng phiên, đóng tab đang mở cho phiên đó', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    const s = mockServer({
      ...TARGETS,
      ...LOCKED,
      ...SESSIONS,
      'POST /api/crew/companies/c1/terminal/sessions/kill': { body: { killed: true } },
    });
    mount();
    fireEvent.click(await launcher());
    await openProject(/Kidy School/);
    expect(await screen.findByRole('tab')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Phiên trên máy' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tắt phiên Kidy School' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Kidy School trên mac-mini sẽ tắt hẳn/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tắt phiên' }));
    await vi.waitFor(() =>
      expect(s.calls.find((c) => c.url.endsWith('/terminal/sessions/kill'))?.body).toEqual({
        machineId: MACHINE,
        projectKey: 'kidy-school',
      }),
    );
    await vi.waitFor(() => expect(screen.queryByRole('tab')).toBeNull());
  });

  it('Tắt phiên khi terminal đang khoá thì báo cần mở khoá trước', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({
      ...TARGETS,
      ...SESSIONS,
      'POST /api/crew/companies/c1/terminal/sessions/kill': {
        status: 423,
        body: { error: 'Terminal đang khoá', code: 'crew_terminal_locked' },
      },
    });
    mount();
    fireEvent.click(await launcher());
    fireEvent.click(await screen.findByRole('button', { name: 'Phiên trên máy' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tắt phiên du-an-cu' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Tắt phiên' }));
    expect(await screen.findByText(/Cần mở khoá terminal trước khi tắt phiên/)).toBeTruthy();
  });
});

describe('addTab / removeTab', () => {
  const base = { open: true, started: true, tabs: [], activeKey: null };
  const a = { machineId: 'm', projectId: 'a' };
  const b = { machineId: 'm', projectId: 'b' };
  const c = { machineId: 'm', projectId: 'c' };

  it('mở lại dự án đã có thì chỉ chọn tab đó, không thêm tab trùng', () => {
    const s = addTab(addTab(addTab(base, a), b), a);
    expect(s.tabs).toEqual([a, b]);
    expect(s.activeKey).toBe('m/a');
  });

  it('đóng tab đang chọn thì chọn tab bên phải, hết thì bên trái, hết tab thì không chọn gì', () => {
    let s = addTab(addTab(addTab(base, a), b), c);
    s = { ...s, activeKey: 'm/b' };
    s = removeTab(s, 'm/b');
    expect(s.activeKey).toBe('m/c');
    s = removeTab(s, 'm/c');
    expect(s.activeKey).toBe('m/a');
    s = removeTab(s, 'm/a');
    expect(s).toMatchObject({ tabs: [], activeKey: null });
  });

  it('đóng tab khác không đổi tab đang chọn', () => {
    const s = removeTab(addTab(addTab(base, a), b), 'm/a');
    expect(s.activeKey).toBe('m/b');
  });
});
