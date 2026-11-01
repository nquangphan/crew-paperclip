// Kết nối WebSocket tới phiên tmux trên Mac. Mỗi lần nối xin vé mới (dùng một lần, 60 giây) rồi mở
// /api/crew/companies/:c/terminal/ws?ticket=&cols=&rows=. Rớt mạng thì nối lại; tmux tự vẽ lại màn hình khi gắn vào.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/api';
import { endpointPath } from '@/api/endpoints';
import { reconnectDelay } from '@/app/live/live-events';
import type { TerminalSize } from './mount-xterm';

export type TerminalSocketStatus = 'connecting' | 'open' | 'closed' | 'locked';

type ServerFrame = { type: 'ready' } | { type: 'output'; data: string } | { type: 'closed' } | { type: 'error' };

/**
 * Điều trang cần báo thêm. Lý do và câu lỗi thô của server (`shell_closed`, lỗi ssh…) không hiện cho người dùng;
 * trang dịch `notice` thành câu i18n.
 * - `targetMissing`: vé trả 4xx khác (máy/project không còn sẵn sàng): nối lại cũng vô ích.
 * - `forbidden`: vé trả 401/403 (hết phiên đăng nhập hoặc không còn là owner): phải tải lại trang để đăng nhập lại.
 * - `error`: server báo lỗi trong phiên.
 * - `connectFailed`: nhiều lần liền có vé mà WebSocket đóng trước khi `ready` (server từ chối, máy lỗi SSH…):
 *   lỗi cố định nên thôi nối lại, chờ người dùng bấm Nối lại.
 */
export type TerminalSocketNotice = 'targetMissing' | 'forbidden' | 'error' | 'connectFailed';

/** Số lần liền WebSocket đóng trước khi `ready` thì thôi tự nối lại. */
export const MAX_FAILED_CONNECTS = 5;

/** Lưới mặc định trước khi khung terminal đo được kích thước. */
const DEFAULT_SIZE: TerminalSize = { cols: 80, rows: 24 };

export function terminalSocketUrl(
  companyId: string,
  ticket: string,
  size: TerminalSize,
  loc: { protocol: string; host: string } = window.location,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  const qs = new URLSearchParams({ ticket, cols: String(size.cols), rows: String(size.rows) });
  return `${scheme}://${loc.host}${endpointPath('terminal.ws', { companyId })}?${qs}`;
}

export interface TerminalSocket {
  status: TerminalSocketStatus;
  notice: TerminalSocketNotice | null;
  send(data: string): void;
  /** Ghi nhớ cỡ lưới (dùng cho lần nối sau) và báo server khi đang mở. */
  resize(cols: number, rows: number): void;
  /** Tự đóng: không nối lại. */
  close(): void;
  /** Nối lại từ đầu (sau khi mở khoá, hoặc người dùng bấm Nối lại). */
  reconnect(): void;
}

export function useTerminalSocket({
  companyId,
  machineId,
  projectId,
  onOutput,
}: {
  companyId: string;
  machineId: string;
  projectId: string;
  onOutput: (data: string) => void;
}): TerminalSocket {
  const [status, setStatus] = useState<TerminalSocketStatus>('connecting');
  const [notice, setNotice] = useState<TerminalSocketNotice | null>(null);
  const [generation, setGeneration] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const sizeRef = useRef<TerminalSize>(DEFAULT_SIZE);
  const stopRef = useRef<() => void>(() => {});
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` chỉ để nối lại từ đầu.
  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let failedConnects = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (stopped || retryTimer) return;
      attempt += 1;
      setStatus('connecting');
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, reconnectDelay(attempt));
    };

    /** WebSocket đóng trước khi `ready`: đếm, đủ số lần liền thì dừng hẳn thay vì nối lại mãi. */
    const connectFailed = () => {
      failedConnects += 1;
      if (failedConnects >= MAX_FAILED_CONNECTS) {
        setNotice('connectFailed');
        setStatus('closed');
        return;
      }
      scheduleRetry();
    };

    const connect = async () => {
      if (stopped) return;
      setStatus('connecting');
      let ticket: string;
      try {
        ticket = (await api.terminal.ticket(companyId, { machineId, projectId })).ticket;
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.status === 423) {
          setStatus('locked');
        } else if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setNotice('forbidden');
          setStatus('closed');
        } else if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          // Máy/project không còn sẵn sàng: nối lại cũng vô ích.
          setNotice('targetMissing');
          setStatus('closed');
        } else {
          scheduleRetry();
        }
        return;
      }
      if (stopped) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(terminalSocketUrl(companyId, ticket, sizeRef.current));
      } catch {
        connectFailed();
        return;
      }
      socketRef.current = ws;
      let serverClosed = false;
      let wasReady = false;
      ws.onmessage = (event) => {
        if (socketRef.current !== ws || typeof event.data !== 'string') return;
        let frame: ServerFrame;
        try {
          frame = JSON.parse(event.data) as ServerFrame;
        } catch {
          return;
        }
        if (frame.type === 'output') onOutputRef.current(frame.data);
        else if (frame.type === 'ready') {
          attempt = 0;
          failedConnects = 0;
          wasReady = true;
          setNotice(null);
          setStatus('open');
          // Cỡ có thể đổi trong lúc chờ vé: báo lại cho chắc.
          ws.send(JSON.stringify({ type: 'resize', ...sizeRef.current }));
        } else if (frame.type === 'closed') {
          serverClosed = true;
        } else if (frame.type === 'error') setNotice('error');
      };
      ws.onclose = () => {
        if (socketRef.current !== ws) return;
        socketRef.current = null;
        if (stopped) return;
        if (serverClosed) setStatus('closed');
        else if (wasReady) scheduleRetry();
        else connectFailed();
      };
    };

    stopRef.current = () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      const ws = socketRef.current;
      socketRef.current = null;
      ws?.close();
    };
    // Trễ một nhịp để StrictMode dọn effect lần đầu trước khi xin vé.
    const startTimer = setTimeout(() => void connect(), 0);
    return () => {
      clearTimeout(startTimer);
      stopRef.current();
    };
  }, [companyId, machineId, projectId, generation]);

  const sendFrame = useCallback((frame: object) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }, []);

  return {
    status,
    notice,
    send: useCallback((data: string) => sendFrame({ type: 'input', data }), [sendFrame]),
    resize: useCallback(
      (cols: number, rows: number) => {
        sizeRef.current = { cols, rows };
        sendFrame({ type: 'resize', cols, rows });
      },
      [sendFrame],
    ),
    close: useCallback(() => {
      stopRef.current();
      setStatus('closed');
    }, []),
    reconnect: useCallback(() => {
      setNotice(null);
      setGeneration((g) => g + 1);
    }, []),
  };
}
