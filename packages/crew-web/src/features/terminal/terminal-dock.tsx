// Terminal của owner dạng khung nổi như khung chat: nút tròn ở góc dưới bên phải mọi trang trong company để ẩn hiện.
// Ẩn chỉ giấu khung, phiên vẫn nối; chuyển trang trong app cũng không mất phiên vì khung nằm ở shell. Mở lần đầu mới nạp
// xterm (`terminal-session.tsx`). Nhớ dự án đang mở trong `localStorage`. Chỉ owner thấy (server cũng chặn).
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { api, queryKeys } from '@/api';
import type { TerminalTarget } from '@/api/crew/terminal';
import { useCompany } from '@/app/hooks';
import { Spinner, TerminalDockEmpty, TerminalDockPanel, TerminalLauncher } from '@/ds';
import { useCompanyAccess } from '@/features/access/use-company-access';
import { useT } from '@/i18n';
import type { TerminalSocketStatus } from './use-terminal-socket';

const TerminalSession = lazy(async () => ({ default: (await import('./terminal-session')).TerminalSession }));

const TARGET_KEY = 'crew.terminal.dockTarget';
/** Chỗ chừa cho nút tròn để khung nổi khác (`FloatingNotice`) đứng trên nó. */
const DOCK_SPACE = '4.5rem';

type TargetRef = Pick<TerminalTarget, 'machineId' | 'projectId'>;

interface TerminalDockApi {
  /** Mở khung nổi; truyền dự án thì chuyển sang dự án đó. */
  open: (target?: TargetRef) => void;
}

const TerminalDockContext = createContext<TerminalDockApi | null>(null);

/** null khi không phải owner (không có khung nổi). */
export function useTerminalDock(): TerminalDockApi | null {
  return useContext(TerminalDockContext);
}

function readTarget(companyId: string): TargetRef | null {
  try {
    const raw = localStorage.getItem(`${TARGET_KEY}.${companyId}`);
    const v = raw ? (JSON.parse(raw) as Partial<TargetRef>) : null;
    return v && typeof v.machineId === 'string' && typeof v.projectId === 'string'
      ? { machineId: v.machineId, projectId: v.projectId }
      : null;
  } catch {
    return null;
  }
}

function saveTarget(companyId: string, target: TargetRef): void {
  try {
    localStorage.setItem(`${TARGET_KEY}.${companyId}`, JSON.stringify(target));
  } catch {
    // trình duyệt chặn lưu trữ: lần sau mở dự án đầu danh sách
  }
}

/**
 * Bọc nội dung company. Cây con luôn giữ nguyên chỗ (không bọc khác nhau theo vai trò) để tải xong vai trò không làm
 * dựng lại cả trang; owner có thêm nút tròn và khung nổi terminal.
 */
export function TerminalDockProvider({ children }: { children: ReactNode }) {
  const { company } = useCompany();
  const access = useCompanyAccess();
  const [open, setOpen] = useState(false);
  // Đã mở ít nhất một lần: từ đó giữ phiên kể cả khi ẩn.
  const [started, setStarted] = useState(false);
  const [chosen, setChosen] = useState<TargetRef | null>(() => readTarget(company.id));
  const show = useCallback(
    (target?: TargetRef) => {
      if (target) {
        setChosen(target);
        saveTarget(company.id, target);
      }
      setStarted(true);
      setOpen(true);
    },
    [company.id],
  );
  const dock = useMemo<TerminalDockApi>(() => ({ open: show }), [show]);
  return (
    <TerminalDockContext.Provider value={access.isOwner ? dock : null}>
      {children}
      {access.isOwner ? (
        <OwnerDock open={open} started={started} chosen={chosen} onShow={show} onHide={() => setOpen(false)} />
      ) : null}
    </TerminalDockContext.Provider>
  );
}

function OwnerDock({
  open,
  started,
  chosen,
  onShow,
  onHide,
}: {
  open: boolean;
  started: boolean;
  chosen: TargetRef | null;
  onShow: (target?: TargetRef) => void;
  onHide: () => void;
}) {
  const { t } = useT('terminal');
  const { company } = useCompany();
  const panelId = useId();
  const [status, setStatus] = useState<TerminalSocketStatus | null>(null);
  const targets = useQuery({
    queryKey: queryKeys.terminalTargets(company.id),
    queryFn: () => api.terminal.targets(company.id),
    enabled: started,
  });
  const list = targets.data ?? [];
  const current =
    list.find((x) => x.machineId === chosen?.machineId && x.projectId === chosen?.projectId) ?? list[0] ?? null;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--crew-dock-space', DOCK_SPACE);
    return () => {
      root.style.removeProperty('--crew-dock-space');
    };
  }, []);

  const loading = (
    <TerminalDockEmpty>
      <Spinner />
    </TerminalDockEmpty>
  );
  let body: ReactNode = null;
  if (targets.isLoading) body = loading;
  else if (targets.error) body = <TerminalDockEmpty>{t('targetsFailed')}</TerminalDockEmpty>;
  else if (!current) body = <TerminalDockEmpty>{t('noTargets')}</TerminalDockEmpty>;
  else {
    body = (
      <Suspense fallback={loading}>
        <TerminalSession
          key={`${current.machineId}/${current.projectId}`}
          machineId={current.machineId}
          projectId={current.projectId}
          targets={list}
          visible={open}
          onSelectTarget={onShow}
          onHide={onHide}
          onStatusChange={setStatus}
        />
      </Suspense>
    );
  }

  return (
    <>
      {started ? (
        <TerminalDockPanel id={panelId} label={t('title')} open={open}>
          {body}
        </TerminalDockPanel>
      ) : null}
      <TerminalLauncher
        label={open ? t('hide') : t('show')}
        open={open}
        live={status === 'open'}
        controls={panelId}
        onToggle={() => (open ? onHide() : onShow())}
      />
    </>
  );
}
