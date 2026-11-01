// Một tab terminal trong khung nổi: xterm nối WebSocket tới phiên tmux của một project trên một máy đã ghép. Luôn nền
// tối. Khoá thì hỏi mật khẩu ngay giữa khung rồi tự nối. Tab không được chọn chỉ bị giấu, phiên vẫn nối.
// Nạp lười từ `terminal-dock.tsx` để trang khác không phải tải xterm.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { TerminalTarget } from '@/api/crew/terminal';
import { useCompany } from '@/app/hooks';
import { Button, TerminalBanner, TerminalConnecting, TerminalPanel, TerminalPanelActions, TerminalScreen } from '@/ds';
import { CircleAlert, RefreshCw } from '@/ds/icons';
import { useT } from '@/i18n';
import { AccessoryKeys, useCoarsePointer } from './accessory-keys';
import { type MountedXterm, mountXterm } from './mount-xterm';
import { PasteTooLargeError, preparePaste } from './paste';
import { UnlockPanel } from './unlock-panel';
import { type TerminalSocketNotice, type TerminalSocketStatus, useTerminalSocket } from './use-terminal-socket';
import { buildTerminalOptions, fontSizeFor } from './xterm-options';

/** Báo "dán quá lớn" tự ẩn sau chừng này mili giây. */
const PASTE_NOTICE_MS = 5000;

const CLOSED_TITLE: Record<TerminalSocketNotice | 'none', string> = {
  none: 'closed.title',
  targetMissing: 'closed.targetMissing',
  forbidden: 'closed.forbidden',
  connectFailed: 'closed.connectFailed',
  error: 'closed.title',
};

const CLOSED_HINT: Record<TerminalSocketNotice | 'none', string> = {
  none: 'closed.hint',
  targetMissing: 'closed.targetMissingHint',
  forbidden: 'closed.forbiddenHint',
  connectFailed: 'closed.connectFailedHint',
  error: 'closed.hint',
};

export interface TerminalSessionProps {
  machineId: string;
  projectId: string;
  /** Dự án trong danh sách mở được; undefined khi không còn sẵn sàng. */
  target: TerminalTarget | undefined;
  /** Tab đang được chọn và khung nổi đang hiện: trả tiêu điểm cho terminal. */
  active: boolean;
  /** Tab đang được chọn (khung nổi có thể đang ẩn). */
  selected: boolean;
  /** Bậc cỡ chữ chung của khung nổi. */
  fontScale: number;
  /** Tăng mỗi lần một tab mở khoá xong: mọi tab đang khoá (kể cả tab vừa mở) tự nối lại. */
  unlockGeneration: number;
  onUnlocked: () => void;
  /** Ẩn khung nổi (mọi phiên vẫn giữ). */
  onHide: () => void;
  onStatusChange: (status: TerminalSocketStatus) => void;
}

export function TerminalSession({
  machineId,
  projectId,
  target,
  active,
  selected,
  fontScale,
  unlockGeneration,
  onUnlocked,
  onHide,
  onStatusChange,
}: TerminalSessionProps) {
  const { t } = useT('terminal');
  const { company } = useCompany();
  const coarse = useCoarsePointer();
  const boxRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<MountedXterm | null>(null);
  const fontScaleRef = useRef(fontScale);
  const [pasteTooLarge, setPasteTooLarge] = useState(false);
  const socket = useTerminalSocket({
    companyId: company.id,
    machineId,
    projectId,
    onOutput: (data) => xtermRef.current?.term.write(data),
  });
  const { send, resize, status, reconnect } = socket;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const xterm = mountXterm(el, buildTerminalOptions(fontScaleRef.current), (size) => resize(size.cols, size.rows));
    xtermRef.current = xterm;
    // Gõ phím và dán qua xterm (xterm tự bọc bracketed paste khi chương trình bật chế độ đó).
    const input = xterm.term.onData(send);
    const size = xterm.fit();
    if (size) resize(size.cols, size.rows);
    // Dán bằng menu hay phím tắt: chặn trước xterm để bọc và chia khúc theo preparePaste.
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        for (const chunk of preparePaste(text)) send(chunk);
        setPasteTooLarge(false);
      } catch (err) {
        if (!(err instanceof PasteTooLargeError)) throw err;
        setPasteTooLarge(true);
      }
    };
    el.addEventListener('paste', onPaste, true);
    return () => {
      el.removeEventListener('paste', onPaste, true);
      input.dispose();
      xterm.dispose();
      xtermRef.current = null;
    };
  }, [send, resize]);

  useEffect(() => {
    if (fontScaleRef.current === fontScale) return;
    fontScaleRef.current = fontScale;
    const xterm = xtermRef.current;
    if (!xterm) return;
    // Tab đang giấu thì fit trả null; hiện lại thì ResizeObserver fit theo cỡ chữ mới.
    xterm.term.options.fontSize = fontSizeFor(fontScale);
    const size = xterm.fit();
    if (size) resize(size.cols, size.rows);
  }, [fontScale, resize]);

  // Hiện tab (chọn tab, mở khung, nối xong) thì trả tiêu điểm cho terminal để gõ được ngay.
  useEffect(() => {
    if (active && status === 'open') xtermRef.current?.term.focus();
  }, [active, status]);

  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);

  // Một tab vừa mở khoá (mở khoá theo phiên đăng nhập, chung mọi tab): tab nào đang khoá thì nối lại luôn.
  const unlockSeen = useRef(unlockGeneration);
  useEffect(() => {
    if (unlockSeen.current === unlockGeneration) return;
    unlockSeen.current = unlockGeneration;
    if (status === 'locked') reconnect();
  }, [unlockGeneration, status, reconnect]);

  useEffect(() => {
    if (!pasteTooLarge) return;
    const timer = setTimeout(() => setPasteTooLarge(false), PASTE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [pasteTooLarge]);

  const sendKey = (data: string) => {
    send(data);
    xtermRef.current?.term.focus();
  };
  const hostname = target?.hostname ?? '';
  let overlay: ReactNode = null;
  if (status === 'locked') {
    overlay = <UnlockPanel onUnlocked={onUnlocked} onCancel={onHide} />;
  } else if (status === 'closed' || !target) {
    const notice = !target ? 'targetMissing' : (socket.notice ?? 'none');
    overlay = (
      <TerminalPanel
        icon={<CircleAlert />}
        title={t(CLOSED_TITLE[notice])}
        description={t(CLOSED_HINT[notice], { host: hostname })}
      >
        <TerminalPanelActions>
          {notice === 'forbidden' ? (
            <Button type="button" onClick={() => window.location.reload()}>
              <RefreshCw />
              {t('reload')}
            </Button>
          ) : (
            <Button type="button" onClick={reconnect}>
              <RefreshCw />
              {t('reconnect')}
            </Button>
          )}
        </TerminalPanelActions>
      </TerminalPanel>
    );
  } else if (status === 'connecting') {
    overlay = <TerminalConnecting label={hostname ? t('connectingTo', { host: hostname }) : t('status.connecting')} />;
  }

  return (
    <TerminalScreen
      hidden={!selected}
      banner={
        <>
          {socket.notice === 'error' && status === 'open' ? (
            <TerminalBanner tone="warning">{t('serverError')}</TerminalBanner>
          ) : null}
          {pasteTooLarge ? <TerminalBanner tone="error">{t('pasteTooLarge')}</TerminalBanner> : null}
        </>
      }
      overlay={overlay}
      screenRef={boxRef}
      footer={coarse && status === 'open' ? <AccessoryKeys send={sendKey} /> : null}
    />
  );
}
