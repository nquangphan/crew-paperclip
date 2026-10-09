// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api';
import {
  invalidationsFor,
  LiveEventsProvider,
  liveSocketUrl,
  reconnectDelay,
  useLiveEvents,
} from '@/app/live/live-events';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

const C = 'c1';

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const seen: unknown[] = [];
  function Probe() {
    const live = useLiveEvents();
    useEffect(() => live.subscribe((e) => seen.push(e)), [live]);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <LiveEventsProvider companyId={C}>
        <Probe />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  act(() => {
    vi.advanceTimersByTime(1);
  });
  return { spy, seen };
}

const keysOf = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c: unknown[]) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

describe('live events', () => {
  it('URL WebSocket theo origin, wss khi https', () => {
    expect(liveSocketUrl('c 1', { protocol: 'https:', host: 'crew.example.com' })).toBe(
      'wss://crew.example.com/api/companies/c%201/events/ws',
    );
    expect(liveSocketUrl('c1', { protocol: 'http:', host: '127.0.0.1:5183' })).toBe(
      'ws://127.0.0.1:5183/api/companies/c1/events/ws',
    );
  });

  it('issue đổi (activity.logged issue.updated) invalidate chi tiết issue và danh sách', () => {
    const { spy } = mount();
    const socket = FakeSocket.all[0];
    expect(socket.url).toMatch(/\/api\/companies\/c1\/events\/ws$/);
    act(() => {
      socket.emit({
        id: 1,
        companyId: C,
        type: 'activity.logged',
        createdAt: '2026-10-10T00:00:00Z',
        payload: { entityType: 'issue', entityId: 'i1', action: 'issue.updated', details: { identifier: 'TPS-7' } },
      });
    });
    const keys = keysOf(spy);
    expect(keys).toContain(JSON.stringify(queryKeys.issue('i1')));
    expect(keys).toContain(JSON.stringify(queryKeys.issue('TPS-7')));
    expect(keys).toContain(JSON.stringify(queryKeys.issues(C)));
    expect(keys).toContain(JSON.stringify(queryKeys.sidebarBadges(C)));
  });

  it('sự kiện của company khác bị bỏ qua; subscriber nhận sự kiện của company đang xem', () => {
    const { spy, seen } = mount();
    act(() => {
      FakeSocket.all[0].emit({ id: 2, companyId: 'other', type: 'agent.status', createdAt: '', payload: {} });
      FakeSocket.all[0].emit({ id: 3, companyId: C, type: 'agent.status', createdAt: '', payload: { agentId: 'a1' } });
    });
    expect(seen).toHaveLength(1);
    expect(keysOf(spy)).toContain(JSON.stringify(queryKeys.agent('a1')));
  });

  it('mất kết nối thì thử lại theo backoff 1–30 giây', () => {
    mount();
    expect(FakeSocket.all).toHaveLength(1);
    act(() => FakeSocket.all[0].onclose?.());
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(FakeSocket.all).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeSocket.all).toHaveLength(2);
    expect([1, 2, 3, 5, 6, 10].map(reconnectDelay)).toEqual([1000, 2000, 4000, 16000, 30000, 30000]);
  });

  it('bảng ánh xạ run: run, agent, issue của run', () => {
    const keys = invalidationsFor(
      {
        id: 1,
        companyId: C,
        type: 'heartbeat.run.status',
        createdAt: '',
        payload: { runId: 'r1', agentId: 'a1', issueId: 'i9' },
      },
      C,
    ).map((k) => JSON.stringify(k));
    for (const k of [queryKeys.run('r1'), queryKeys.agent('a1'), queryKeys.issueRuns('i9'), queryKeys.runs(C)]) {
      expect(keys).toContain(JSON.stringify(k));
    }
    expect(invalidationsFor({ id: 1, companyId: C, type: 'heartbeat.run.log', createdAt: '', payload: {} }, C)).toEqual(
      [],
    );
  });
});
