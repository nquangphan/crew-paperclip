// Trang terminal của owner: xterm nối WebSocket tới phiên tmux của một project trên một máy đã ghép.
// Toàn màn hình (route có `handle.fullscreen`), luôn nền tối. Chỉ owner (server cũng chặn); khoá thì hỏi mật khẩu ngay
// giữa khung rồi tự nối. Nút tiêu đề đổi sang dự án/máy khác tại chỗ.
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import {
  Button,
  CenteredPage,
  ErrorState,
  Spinner,
  TerminalBackButton,
  TerminalBanner,
  TerminalConnecting,
  TerminalFontControl,
  TerminalPanel,
  TerminalPanelActions,
  TerminalShell,
  TerminalStatus,
} from '@/ds';
import { CircleAlert, RefreshCw } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access/use-company-access';
import { useT } from '@/i18n';
import { AccessoryKeys, useCoarsePointer } from './accessory-keys';
import { type MountedXterm, mountXterm } from './mount-xterm';
import { PasteTooLargeError, preparePaste } from './paste';
import { TargetSwitcher } from './target-switcher';
import { UnlockPanel } from './unlock-panel';
import { type TerminalSocketNotice, useTerminalSocket } from './use-terminal-socket';
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

export function TerminalPage() {
  const { t } = useT('terminal');
  const access = useCompanyAccess();
  const { machineId = '', projectId = '' } = useParams();
  if (access.loading) {
    return (
      <CenteredPage>
        <Spinner />
      </CenteredPage>
    );
  }
  if (access.error && !access.isOwner) {
    return (
      <CenteredPage>
        <ErrorState title={t('accessFailed')} message={access.error.message} onRetry={access.retry} />
      </CenteredPage>
    );
  }
  if (!access.isOwner) {
    return (
      <CenteredPage>
        <ErrorState title={t('ownerOnly')} message={t('ownerOnlyHint')} />
      </CenteredPage>
    );
  }
  return <TerminalView key={`${machineId}/${projectId}`} machineId={machineId} projectId={projectId} />;
}

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

function TerminalView({ machineId, projectId }: { machineId: string; projectId: string }) {
  const { t } = useT('terminal');
  const { company } = useCompany();
  const navigate = useNavigate();
  const location = useLocation();
  const machinesPath = companyPath(company.issuePrefix, 'machines');
  // Mở thẳng ở tab mới thì không có trang trước trong app: về trang Máy thay vì rời app.
  const goBack = () => (location.key === 'default' ? navigate(machinesPath) : navigate(-1));
  const coarse = useCoarsePointer();
  const targets = useQuery({
    queryKey: queryKeys.terminalTargets(company.id),
    queryFn: () => api.terminal.targets(company.id),
  });
  const target = targets.data?.find((x) => x.machineId === machineId && x.projectId === projectId);
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
    if (socket.status === 'open') xtermRef.current?.term.focus();
  }, [socket.status]);

  useEffect(() => {
    if (!pasteTooLarge) return;
    const timer = setTimeout(() => setPasteTooLarge(false), PASTE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [pasteTooLarge]);

  const sendKey = (data: string) => {
    send(data);
    xtermRef.current?.term.focus();
  };
  const onBack = () => {
    socket.close();
    goBack();
  };

  const hostname = target?.hostname ?? '';
  const missing = Boolean(targets.data && !target);
  let overlay: ReactNode = null;
  if (socket.status === 'locked') {
    overlay = <UnlockPanel onUnlocked={socket.reconnect} onCancel={onBack} />;
  } else if (socket.status === 'closed' || missing) {
    const notice = missing ? 'targetMissing' : (socket.notice ?? 'none');
    overlay = (
      <TerminalPanel
        icon={<CircleAlert />}
        title={t(CLOSED_TITLE[notice])}
        description={t(CLOSED_HINT[notice], { host: hostname })}
      >
        <TerminalPanelActions>
          <Button type="button" variant="ghost" onClick={onBack}>
            {t('backToMachines')}
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
      back={<TerminalBackButton label={t('backToMachines')} shortLabel={t('machines')} onClick={onBack} />}
      title={
        <TargetSwitcher
          targets={targets.data ?? []}
          current={target}
          fallbackTitle={t('title')}
          onSelect={(next) =>
            navigate(companyPath(company.issuePrefix, `terminal/${next.machineId}/${next.projectId}`), {
              replace: true,
            })
          }
        />
      }
      status={<TerminalStatus tone={socket.status} label={t(`status.${socket.status}`)} />}
      actions={
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
      }
      banner={
        <>
          {targets.error ? <TerminalBanner tone="warning">{t('targetsFailed')}</TerminalBanner> : null}
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
