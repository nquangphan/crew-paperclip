// Cập nhật trực tiếp (S0.5): WebSocket /api/companies/:c/events/ws như UI stock
// (ui/src/context/LiveUpdatesProvider.tsx). Sự kiện về thì invalidate query theo queryKeys; mất kết nối thì thử lại.
import type { LiveEvent } from '@paperclipai/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { createContext, createElement, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { queryKeys } from '@/api';
import { endpointPath } from '@/api/endpoints';

type QueryKey = readonly unknown[];
type Listener = (event: LiveEvent) => void;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function liveSocketUrl(companyId: string, loc: { protocol: string; host: string } = window.location): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.host}${endpointPath('live.events', { companyId })}`;
}

/** Chờ trước lần nối lại thứ `attempt` (1, 2, 4… giây, trần 30 giây). */
export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

/** Mã (TPS-7) mà các trang chi tiết đang mở dùng làm khóa cho issue có uuid này. */
export type IssueRefsOf = (issueId: string) => string[];

/**
 * Tìm trong cache các query chi tiết `issue(<mã>)` có dữ liệu là issue `issueId`. Nhiều sự kiện của server chỉ
 * mang uuid (bình luận mở lại, trả lời tương tác, run), nên không suy được mã từ sự kiện.
 */
export function cachedIssueRefs(queryClient: QueryClient): IssueRefsOf {
  return (issueId) =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey: ['issue'] })
      .filter((q) => q.queryKey.length === 2 && (q.state.data as { id?: unknown } | undefined)?.id === issueId)
      .map((q) => String(q.queryKey[1]))
      .filter((ref) => ref !== issueId);
}

function issueDetailKeys(issueId: string, identifier: string | null, refsOf?: IssueRefsOf): QueryKey[] {
  const keys: QueryKey[] = [queryKeys.issue(issueId), queryKeys.issueRuns(issueId), queryKeys.issueLiveRuns(issueId)];
  const refs = new Set(refsOf?.(issueId) ?? []);
  if (identifier && identifier !== issueId) refs.add(identifier);
  for (const ref of refs) keys.push(queryKeys.issue(ref));
  return keys;
}

/** Bảng ánh xạ loại sự kiện → khóa query cần làm mới. `refsOf` bù mã issue khi sự kiện chỉ có uuid. */
export function invalidationsFor(event: LiveEvent, companyId: string, refsOf?: IssueRefsOf): QueryKey[] {
  const p = rec(event.payload);
  switch (event.type) {
    case 'heartbeat.run.queued':
    case 'heartbeat.run.status':
    case 'heartbeat.run.progress': {
      const keys: QueryKey[] = [
        queryKeys.runs(companyId),
        queryKeys.liveRuns(companyId),
        queryKeys.agents(companyId),
        queryKeys.dashboard(companyId),
        queryKeys.sidebarBadges(companyId),
      ];
      const runId = str(p.runId);
      const agentId = str(p.agentId);
      const issueId = str(p.issueId);
      if (runId) keys.push(queryKeys.run(runId));
      if (agentId) keys.push(queryKeys.agent(agentId));
      if (issueId) keys.push(...issueDetailKeys(issueId, null, refsOf));
      return keys;
    }
    case 'agent.status': {
      const keys: QueryKey[] = [queryKeys.agents(companyId), queryKeys.dashboard(companyId)];
      const agentId = str(p.agentId);
      if (agentId) keys.push(queryKeys.agent(agentId));
      return keys;
    }
    case 'activity.logged': {
      const keys: QueryKey[] = [queryKeys.dashboard(companyId), queryKeys.sidebarBadges(companyId)];
      const entityType = str(p.entityType);
      const entityId = str(p.entityId);
      if (entityType === 'issue') {
        keys.push(queryKeys.issues(companyId), queryKeys.crew());
        const identifier = str(rec(p.details).identifier);
        if (entityId) keys.push(...issueDetailKeys(entityId, identifier, refsOf));
        else if (identifier) keys.push(queryKeys.issue(identifier));
      } else if (entityType === 'agent') {
        keys.push(queryKeys.agents(companyId));
        if (entityId) keys.push(queryKeys.agent(entityId));
      } else if (entityType === 'project') {
        keys.push(queryKeys.projects(companyId));
        if (entityId) keys.push(queryKeys.project(entityId));
      }
      return keys;
    }
    case 'plugin.ui.updated':
      return [queryKeys.crew()];
    default:
      return [];
  }
}

interface LiveEventsValue {
  connected: boolean;
  /** Nghe sự kiện thô (ví dụ transcript run trực tiếp). Trả hàm hủy. */
  subscribe: (listener: Listener) => () => void;
}

const LiveEventsContext = createContext<LiveEventsValue>({ connected: false, subscribe: () => () => {} });

export function LiveEventsProvider({ companyId, children }: { companyId: string; children?: ReactNode }) {
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      let next: WebSocket;
      try {
        next = new WebSocket(liveSocketUrl(companyId));
      } catch {
        scheduleRetry();
        return;
      }
      socket = next;
      next.onopen = () => {
        if (closed || socket !== next) return;
        // Sự kiện không phát lại: lấy lại dữ liệu đang xem để bù khoảng mất kết nối.
        if (attempt > 0) void queryClient.invalidateQueries({ type: 'active' });
        attempt = 0;
        setConnected(true);
      };
      next.onmessage = (message) => {
        if (typeof message.data !== 'string' || !message.data) return;
        let event: LiveEvent;
        try {
          event = JSON.parse(message.data) as LiveEvent;
        } catch {
          return;
        }
        if (event.companyId !== companyId) return;
        for (const queryKey of invalidationsFor(event, companyId, cachedIssueRefs(queryClient))) {
          void queryClient.invalidateQueries({ queryKey });
        }
        for (const listener of listeners.current) listener(event);
      };
      next.onclose = () => {
        if (socket !== next) return;
        socket = null;
        setConnected(false);
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (closed || retryTimer) return;
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, reconnectDelay(attempt));
    };

    // Trễ một nhịp để StrictMode dọn effect lần đầu trước khi mở socket.
    const startTimer = setTimeout(connect, 0);
    return () => {
      closed = true;
      clearTimeout(startTimer);
      if (retryTimer) clearTimeout(retryTimer);
      const s = socket;
      socket = null;
      s?.close();
    };
  }, [companyId, queryClient]);

  const value = useMemo<LiveEventsValue>(
    () => ({
      connected,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    }),
    [connected],
  );
  return createElement(LiveEventsContext.Provider, { value }, children);
}

export function useLiveEvents(): LiveEventsValue {
  return useContext(LiveEventsContext);
}
