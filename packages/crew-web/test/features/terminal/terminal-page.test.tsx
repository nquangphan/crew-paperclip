// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { TerminalPage } from '@/features/terminal/terminal-page';
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

const mount = () => {
  const router = createMemoryRouter(
    [
      { path: '/:companyPrefix/terminal/:machineId/:projectId', element: <TerminalPage /> },
      { path: '/:companyPrefix/machines', element: <p>Trang Máy</p> },
    ],
    { initialEntries: [`/TPS/terminal/${MACHINE}/${PROJECT}`] },
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <RouterProvider router={router} />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
};

describe('trang Terminal', () => {
  it('terminal đang khoá (vé trả 423) thì hiện ô mật khẩu', async () => {
    const ws = vi.fn();
    vi.stubGlobal('WebSocket', ws);
    mockServer({
      ...TARGETS,
      'POST /api/crew/companies/c1/terminal/tickets': {
        status: 423,
        body: { error: 'Terminal đang khoá, hãy nhập mật khẩu để mở.', code: 'crew_terminal_locked' },
      },
    });
    mount();
    expect(await screen.findByLabelText('Mật khẩu')).toBeTruthy();
    expect(await screen.findByText(/Paperclip/)).toBeTruthy();
    expect(ws).not.toHaveBeenCalled();
  });

  it('người không phải owner thấy ErrorState', async () => {
    mockServer({
      ...TARGETS,
      ...accessRoute('c1', { userId: 'u2', membershipRole: 'viewer', contributor: false, canApprove: false }),
    });
    mount();
    expect(await screen.findByText('Chỉ owner mở được terminal')).toBeTruthy();
    expect(screen.queryByLabelText('Mật khẩu')).toBeNull();
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
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'closed', reason: 'shell_closed' }) });
      sockets[0].onclose?.();
    });
    expect(await screen.findByText(/Phiên terminal đã ngắt/)).toBeTruthy();
    expect(screen.queryByText(/shell_closed/)).toBeNull();
  });

  it('mở thẳng ở tab mới (không có trang trước) thì nút về của ô mật khẩu về trang Máy', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({
      ...TARGETS,
      'POST /api/crew/companies/c1/terminal/tickets': {
        status: 423,
        body: { error: 'x', code: 'crew_terminal_locked' },
      },
    });
    mount();
    const panel = await screen.findByRole('region', { name: 'Mở khoá terminal' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Về trang Máy' }));
    expect(await screen.findByText('Trang Máy')).toBeTruthy();
  });

  it('vé trả 403 (hết phiên hoặc mất quyền owner) thì bảo tải lại trang, không bảo dự án chưa sẵn sàng', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({
      ...TARGETS,
      'POST /api/crew/companies/c1/terminal/tickets': { status: 403, body: { error: 'x' } },
    });
    mount();
    expect(await screen.findByText('Hết phiên đăng nhập')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tải lại trang/ })).toBeTruthy();
    expect(screen.queryByText('Dự án chưa sẵn sàng trên máy này')).toBeNull();
  });

  it('nút tiêu đề liệt kê dự án theo máy và đổi sang dự án khác tại chỗ', async () => {
    vi.stubGlobal('WebSocket', vi.fn());
    mockServer({
      ...TARGETS,
      'POST /api/crew/companies/c1/terminal/tickets': {
        status: 423,
        body: { error: 'x', code: 'crew_terminal_locked' },
      },
    });
    mount();
    const trigger = await screen.findByRole('button', { name: 'Đổi dự án hoặc máy' });
    await screen.findByText('Paperclip');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Kidy School/ }));
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Đổi dự án hoặc máy' }).textContent).toMatch(/Kidy School/),
    );
  });
});
