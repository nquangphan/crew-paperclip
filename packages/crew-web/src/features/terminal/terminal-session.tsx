// Một phiên terminal của owner trong khung nổi: xterm nối WebSocket tới phiên tmux của một project trên một máy đã ghép.
// Luôn nền tối. Khoá thì hỏi mật khẩu ngay giữa khung rồi tự nối. Nút tiêu đề đổi sang dự án/máy khác tại chỗ.
// Nạp lười từ `terminal-dock.tsx` để trang khác không phải tải xterm.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { TerminalTarget } from '@/api/crew/terminal';
import { useCompany } from '@/app/hooks';
import {
  Button,
  TerminalBanner,
  TerminalConnecting,
  TerminalFontControl,
  TerminalHideButton,
  TerminalPanel,
  TerminalPanelActions,
  TerminalShell,
  TerminalStatus,
} from '@/ds';
import { CircleAlert, RefreshCw } from '@/ds/icons';
import { useT } from '@/i18n';
import { AccessoryKeys, useCoarsePointer } from './accessory-keys';
import { type MountedXterm, mountXterm } from './mount-xterm';
import { PasteTooLargeError, preparePaste } from './paste';
import { TargetSwitcher } from './target-switcher';
import { UnlockPanel } from './unlock-panel';
import { type TerminalSocketNotice, type TerminalSocketStatus, useTerminalSocket } from './use-terminal-socket';
import {
  buildTerminalOptions,
  FONT_SCALES,
  fontSizeFor,
  nextFontScale,
  readFontScale,
  saveFontScale,
} from './xterm-options';

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
  /** Danh sách dự án mở được (đã tải ở khung nổi). */
  targets: readonly TerminalTarget[];
  /** Khung nổi đang hiện: hiện lại thì trả tiêu điểm cho terminal. */
  visible: boolean;
  onSelectTarget: (target: TerminalTarget) => void;
  /** Ẩn khung nổi (phiên vẫn giữ). */
  onHide: () => void;
  /** Báo trạng thái kết nối cho nút tròn. */
  onStatusChange?: (status: TerminalSocketStatus) => void;
}

export function TerminalSession({
  machineId,
  projectId,
  targets,
  visible,
  onSelectTarget,
  onHide,
  onStatusChange,
}: TerminalSessionProps) {
  const { t } = useT('terminal');
  const { company } = useCompany();
  const coarse = useCoarsePointer();
  const target = targets.find((x) => x.machineId === machineId && x.projectId === projectId);
  const boxRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<MountedXterm | null>(null);
  const [fontScale, setFontScale] = useState(readFontScale);
  const fontScaleRef = useRef(fontScale);
  const [pasteTooLarge, setPasteTooLarge] = useState(false);
  const socket = useTerminalSocket({
    companyId: company.id,
    machineId,
    projectId,
    onOutput: (data) => xtermRef.current?.term.write(data),
  });
  const { send, resize } = socket;

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
    xterm.term.focus();
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
    saveFontScale(fontScale);
    const xterm = xtermRef.current;
    if (!xterm) return;
    // Khung không đổi cỡ nên ResizeObserver không báo: tự fit lại theo cỡ ô chữ mới.
    xterm.term.options.fontSize = fontSizeFor(fontScale);
    const size = xterm.fit();
    if (size) resize(size.cols, size.rows);
  }, [fontScale, resize]);

  // Nối xong (sau mở khoá hay nối lại) thì trả tiêu điểm cho terminal để gõ được ngay.
  useEffect(() => {
    if (socket.status === 'open' && visible) xtermRef.current?.term.focus();
  }, [socket.status, visible]);

  useEffect(() => {
    onStatusChange?.(socket.status);
  }, [socket.status, onStatusChange]);

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
  const missing = !target;
  let overlay: ReactNode = null;
  if (socket.status === 'locked') {
    overlay = <UnlockPanel onUnlocked={socket.reconnect} onCancel={onHide} />;
  } else if (socket.status === 'closed' || missing) {
    const notice = missing ? 'targetMissing' : (socket.notice ?? 'none');
    overlay = (
      <TerminalPanel
        icon={<CircleAlert />}
        title={t(CLOSED_TITLE[notice])}
        description={t(CLOSED_HINT[notice], { host: hostname })}
      >
        <TerminalPanelActions>
          <Button type="button" variant="ghost" onClick={onHide}>
            {t('hide')}
          </Button>
          {notice === 'forbidden' ? (
            <Button type="button" onClick={() => window.location.reload()}>
              <RefreshCw />
              {t('reload')}
            </Button>
          ) : (
            <Button type="button" onClick={socket.reconnect}>
              <RefreshCw />
              {t('reconnect')}
            </Button>
          )}
        </TerminalPanelActions>
      </TerminalPanel>
    );
  } else if (socket.status === 'connecting') {
    overlay = <TerminalConnecting label={hostname ? t('connectingTo', { host: hostname }) : t('status.connecting')} />;
  }

  return (
    <TerminalShell
      title={<TargetSwitcher targets={targets} current={target} fallbackTitle={t('title')} onSelect={onSelectTarget} />}
      status={<TerminalStatus tone={socket.status} label={t(`status.${socket.status}`)} />}
      actions={
        <>
          <TerminalFontControl
            size={fontSizeFor(fontScale)}
            label={t('fontSize')}
            smallerLabel={t('fontSmaller')}
            largerLabel={t('fontLarger')}
            canSmaller={fontScale !== FONT_SCALES[0]}
            canLarger={fontScale !== FONT_SCALES[FONT_SCALES.length - 1]}
            onSmaller={() => setFontScale((s) => nextFontScale(s, -1))}
            onLarger={() => setFontScale((s) => nextFontScale(s, 1))}
          />
          <TerminalHideButton label={t('hide')} onClick={onHide} />
        </>
      }
      banner={
        <>
          {socket.notice === 'error' && socket.status === 'open' ? (
            <TerminalBanner tone="warning">{t('serverError')}</TerminalBanner>
          ) : null}
          {pasteTooLarge ? <TerminalBanner tone="error">{t('pasteTooLarge')}</TerminalBanner> : null}
        </>
      }
      overlay={overlay}
      screenRef={boxRef}
      footer={coarse && socket.status === 'open' ? <AccessoryKeys send={sendKey} /> : null}
    />
  );
}
