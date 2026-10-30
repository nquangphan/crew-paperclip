// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalSocket } from '@/features/terminal/use-terminal-socket';
import { mockServer } from '../../app/fetch-mock';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  frame(data: object) {
    if (data && (data as { type?: string }).type === 'ready') this.readyState = FakeSocket.OPEN;
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const TICKETS = 'POST /api/crew/companies/c1/terminal/tickets';
const ARGS = { companyId: 'c1', machineId: 'm1', projectId: 'p1', onOutput: () => {} };

/** Chạy hết timer đến hạn trong `ms` và các promise theo sau (xin vé là fetch giả). */
const tick = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const ticketCalls = (calls: { method: string; url: string }[]) =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith('/terminal/tickets')).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useTerminalSocket', () => {
  it('vé trả 423 thì khoá, không mở WebSocket', async () => {
    mockServer({ [TICKETS]: { status: 423, body: { error: 'x', code: 'crew_terminal_locked' } } });
    const { result } = renderHook(() => useTerminalSocket(ARGS));
    await tick();
    expect(result.current.status).toBe('locked');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('vé trả 4xx khác (404) thì đóng, báo thiếu máy/project và không nối lại', async () => {
    const { calls } = mockServer({
      [TICKETS]: { status: 404, body: { error: 'raw server text', code: 'crew_terminal_target_missing' } },
    });
    const { result } = renderHook(() => useTerminalSocket(ARGS));
    await tick();
    expect(result.current.status).toBe('closed');
    expect(result.current.notice).toBe('targetMissing');
    await tick(60_000);
    expect(ticketCalls(calls)).toBe(1);
  });

  it('server gửi khung closed thì đóng, không nối lại, không lộ lý do thô', async () => {
    const { calls } = mockServer({ [TICKETS]: { status: 201, body: { ticket: 't1', expiresAt: 'x' } } });
    const { result } = renderHook(() => useTerminalSocket(ARGS));
    await tick();
    const ws = FakeSocket.instances[0];
    expect(ws.url).toContain('ticket=t1');
    act(() => ws.frame({ type: 'ready' }));
    expect(result.current.status).toBe('open');
    act(() => {
      ws.frame({ type: 'closed', reason: 'shell_closed' });
      ws.drop();
    });
    expect(result.current.status).toBe('closed');
    expect(result.current.notice).toBeNull();
    await tick(60_000);
    expect(ticketCalls(calls)).toBe(1);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('khung error của server thành thông báo chung, không lộ câu thô', async () => {
    mockServer({ [TICKETS]: { status: 201, body: { ticket: 't1', expiresAt: 'x' } } });
    const { result } = renderHook(() => useTerminalSocket(ARGS));
    await tick();
    act(() => FakeSocket.instances[0].frame({ type: 'error', message: 'ssh: handshake failed' }));
    expect(result.current.notice).toBe('error');
  });

  it('rớt mạng (đóng bất thường) thì xin vé mới và nối lại sau reconnectDelay', async () => {
    const { calls } = mockServer({ [TICKETS]: { status: 201, body: { ticket: 't1', expiresAt: 'x' } } });
    const { result } = renderHook(() => useTerminalSocket(ARGS));
    await tick();
    act(() => FakeSocket.instances[0].frame({ type: 'ready' }));
    act(() => FakeSocket.instances[0].drop());
    expect(result.current.status).toBe('connecting');
    await tick(999);
    expect(FakeSocket.instances).toHaveLength(1);
    await tick(1);
    expect(ticketCalls(calls)).toBe(2);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
