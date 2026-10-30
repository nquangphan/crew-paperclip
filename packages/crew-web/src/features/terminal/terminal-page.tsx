// Trang terminal của owner: xterm nối WebSocket tới phiên tmux của một project trên một máy đã ghép.
// Chỉ owner (server cũng chặn); khoá thì hỏi mật khẩu rồi tự nối.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import { Alert, Badge, Button, ErrorState, Spinner, TerminalShell } from '@/ds';
import { Minus, Plus, X } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access/use-company-access';
import { useT } from '@/i18n';
import { AccessoryKeys, useCoarsePointer } from './accessory-keys';
import { type MountedXterm, mountXterm } from './mount-xterm';
import { PasteTooLargeError, preparePaste } from './paste';
import { UnlockDialog } from './unlock-dialog';
import { type TerminalSocketStatus, useTerminalSocket } from './use-terminal-socket';
import {
  buildTerminalOptions,
  currentMode,
  fontSizeFor,
  nextFontScale,
  readFontScale,
  saveFontScale,
} from './xterm-options';

export function TerminalPage() {
  const { t } = useT('terminal');
  const access = useCompanyAccess();
  const { machineId = '', projectId = '' } = useParams();
  if (access.loading) return <Spinner />;
  if (access.error && !access.isOwner) {
    return <ErrorState title={t('accessFailed')} message={access.error.message} onRetry={access.retry} />;
  }
  if (!access.isOwner) return <ErrorState title={t('ownerOnly')} message={t('ownerOnlyHint')} />;
  return <TerminalView key={`${machineId}/${projectId}`} machineId={machineId} projectId={projectId} />;
}

const STATUS_VARIANT: Record<TerminalSocketStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  connecting: 'secondary',
  open: 'default',
  closed: 'outline',
  locked: 'destructive',
};

function TerminalView({ machineId, projectId }: { machineId: string; projectId: string }) {
  const { t } = useT('terminal');
  const { company } = useCompany();
  const navigate = useNavigate();
  const location = useLocation();
  // Mở thẳng ở tab mới thì không có trang trước trong app: về trang Máy thay vì rời app.
  const goBack = () =>
    location.key === 'default' ? navigate(companyPath(company.issuePrefix, 'machines')) : navigate(-1);
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
    const xterm = mountXterm(el, buildTerminalOptions(currentMode(), fontScaleRef.current), (size) =>
      resize(size.cols, size.rows),
    );
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

  const sendKey = (data: string) => {
    send(data);
    xtermRef.current?.term.focus();
  };
  const onClose = () => {
    socket.close();
    goBack();
  };

  return (
    <>
      <TerminalShell
        title={target?.projectName ?? t('title')}
        detail={target ? `${target.hostname} · ${target.branch}` : undefined}
        status={<Badge variant={STATUS_VARIANT[socket.status]}>{t(`status.${socket.status}`)}</Badge>}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('fontSmaller')}
              title={t('fontSmaller')}
              onClick={() => setFontScale((s) => nextFontScale(s, -1))}
            >
              <Minus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('fontLarger')}
              title={t('fontLarger')}
              onClick={() => setFontScale((s) => nextFontScale(s, 1))}
            >
              <Plus />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              <X />
              {t('close')}
            </Button>
          </>
        }
        notices={
          <>
            {targets.error ? <ErrorState title={t('targetsFailed')} message={targets.error.message} /> : null}
            {targets.data && !target ? <Alert variant="warning" title={t('targetMissing')} /> : null}
            {socket.status === 'closed' ? (
              <Alert variant="info" title={socket.notice === 'targetMissing' ? t('targetMissing') : t('closedHint')}>
                <Button type="button" variant="outline" size="sm" onClick={socket.reconnect}>
                  {t('reconnect')}
                </Button>
              </Alert>
            ) : socket.notice === 'error' ? (
              <Alert variant="warning" title={t('serverError')} />
            ) : null}
            {pasteTooLarge ? <Alert variant="destructive" title={t('pasteTooLarge')} /> : null}
          </>
        }
        screenRef={boxRef}
        footer={coarse ? <AccessoryKeys send={sendKey} /> : null}
      />
      {socket.status === 'locked' ? <UnlockDialog onUnlocked={socket.reconnect} onCancel={goBack} /> : null}
    </>
  );
}
