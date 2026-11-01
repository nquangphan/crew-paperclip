// Terminal của owner dạng khung nổi như khung chat: nút tròn ở góc dưới bên phải mọi trang trong company để ẩn hiện.
// Khung chứa nhiều tab, mỗi tab một dự án trên một máy, tự owner mở (không tự mở sẵn cái nào). Thanh trên đếm số
// terminal đang mở và đang nối; mỗi tab hiện trạng thái riêng. Ẩn khung hay đổi tab chỉ giấu, phiên vẫn nối; chuyển
// trang trong app cũng không mất phiên vì khung nằm ở shell. Đóng tab mới ngắt kết nối (phiên tmux trên máy vẫn giữ).
// Mở lần đầu mới tải danh sách dự án; tab đầu tiên mới nạp xterm (`terminal-session.tsx`). Chỉ owner (server cũng chặn).
// Mục "Phiên trên máy" hỏi server các phiên tmux owner đang sống trên từng Mac (kể cả mở từ trình duyệt hay máy khác):
// tải lại mỗi `SESSIONS_REFRESH_MS` khi khung đang hiện.
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createContext,
  type Dispatch,
  lazy,
  type ReactNode,
  type SetStateAction,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { ApiError, api, queryKeys } from '@/api';
import type { TerminalMachineSession, TerminalTarget } from '@/api/crew/terminal';
import { useCompany } from '@/app/hooks';
import {
  ConfirmDialog,
  Spinner,
  TerminalBanner,
  TerminalDockEmpty,
  TerminalDockHeader,
  TerminalDockPanel,
  TerminalFontControl,
  TerminalHideButton,
  TerminalLauncher,
  TerminalMachineSessions,
  TerminalPane,
  TerminalPickerList,
  TerminalPickerMenu,
  TerminalTabs,
  TerminalViewToggle,
} from '@/ds';
import { useCompanyAccess } from '@/features/access/use-company-access';
import { formatDateTime, formatRelative, useT } from '@/i18n';
import { pickerGroups, targetKey } from './target-picker';
import type { TerminalSocketStatus } from './use-terminal-socket';
import { FONT_SCALES, fontSizeFor, nextFontScale, readFontScale, saveFontScale } from './xterm-options';

const TerminalSession = lazy(async () => ({ default: (await import('./terminal-session')).TerminalSession }));

/** Khung đang hiện thì hỏi lại phiên trên máy sau chừng này mili giây (mỗi lần hỏi mở một kết nối SSH tới mỗi máy). */
const SESSIONS_REFRESH_MS = 15_000;

/** Chỗ chừa cho nút tròn để khung nổi khác (`FloatingNotice`) đứng trên nó. */
const DOCK_SPACE = '4.5rem';

type TargetRef = Pick<TerminalTarget, 'machineId' | 'projectId'>;

interface TerminalDockApi {
  /** Mở khung nổi; truyền dự án thì mở tab cho dự án đó (đã có thì chọn tab đó). */
  open: (target?: TargetRef) => void;
}

const TerminalDockContext = createContext<TerminalDockApi | null>(null);

/** null khi không phải owner (không có khung nổi). */
export function useTerminalDock(): TerminalDockApi | null {
  return useContext(TerminalDockContext);
}

export interface DockState {
  open: boolean;
  /** Đã mở khung ít nhất một lần: từ đó mới tải danh sách dự án. */
  started: boolean;
  tabs: TargetRef[];
  activeKey: string | null;
}

/** Thêm tab cho dự án (chưa có thì nối vào cuối) và chọn nó. */
export function addTab(state: DockState, target: TargetRef): DockState {
  const key = targetKey(target);
  const tabs = state.tabs.some((x) => targetKey(x) === key) ? state.tabs : [...state.tabs, target];
  return { ...state, tabs, activeKey: key };
}

/** Bỏ tab; tab đang chọn bị bỏ thì chọn tab bên cạnh (bên phải, hết thì bên trái). */
export function removeTab(state: DockState, key: string): DockState {
  const i = state.tabs.findIndex((x) => targetKey(x) === key);
  if (i === -1) return state;
  const tabs = state.tabs.filter((_, j) => j !== i);
  const next = tabs[i] ?? tabs[i - 1];
  const activeKey = state.activeKey === key ? (next ? targetKey(next) : null) : state.activeKey;
  return { ...state, tabs, activeKey };
}

/**
 * Bọc nội dung company. Cây con luôn giữ nguyên chỗ (không bọc khác nhau theo vai trò) để tải xong vai trò không làm
 * dựng lại cả trang; owner có thêm nút tròn và khung nổi terminal.
 */
export function TerminalDockProvider({ children }: { children: ReactNode }) {
  const access = useCompanyAccess();
  const [state, setState] = useState<DockState>({ open: false, started: false, tabs: [], activeKey: null });
  const show = useCallback((target?: TargetRef) => {
    setState((s) => {
      const opened = { ...s, open: true, started: true };
      return target ? addTab(opened, target) : opened;
    });
  }, []);
  const dock = useMemo<TerminalDockApi>(() => ({ open: show }), [show]);
  return (
    <TerminalDockContext.Provider value={access.isOwner ? dock : null}>
      {children}
      {access.isOwner ? <OwnerDock state={state} setState={setState} onShow={show} /> : null}
    </TerminalDockContext.Provider>
  );
}

function OwnerDock({
  state,
  setState,
  onShow,
}: {
  state: DockState;
  setState: Dispatch<SetStateAction<DockState>>;
  onShow: (target?: TargetRef) => void;
}) {
  const { t, lang } = useT('terminal');
  const { company } = useCompany();
  const panelId = useId();
  const [view, setView] = useState<'tabs' | 'machines'>('tabs');
  const [toKill, setToKill] = useState<TerminalMachineSession | null>(null);
  const [statuses, setStatuses] = useState<Record<string, TerminalSocketStatus>>({});
  const [fontScale, setFontScale] = useState(readFontScale);
  const [unlockGeneration, setUnlockGeneration] = useState(0);
  const targets = useQuery({
    queryKey: queryKeys.terminalTargets(company.id),
    queryFn: () => api.terminal.targets(company.id),
    enabled: state.started,
  });
  const sessions = useQuery({
    queryKey: queryKeys.terminalSessions(company.id),
    queryFn: () => api.terminal.sessions(company.id),
    enabled: state.started && state.open,
    refetchInterval: state.open ? SESSIONS_REFRESH_MS : false,
  });
  const list = useMemo(() => targets.data ?? [], [targets.data]);
  const live = useMemo(() => sessions.data?.items ?? [], [sessions.data]);
  const openKeys = useMemo(() => new Set(state.tabs.map(targetKey)), [state.tabs]);
  const groups = useMemo(
    () =>
      pickerGroups(list, openKeys, (target) => {
        const session = live.find((x) => x.machineId === target.machineId && x.projectKey === target.projectKey);
        return session ? t('liveNote') : undefined;
      }),
    [list, openKeys, live, t],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--crew-dock-space', DOCK_SPACE);
    return () => {
      root.style.removeProperty('--crew-dock-space');
    };
  }, []);

  useEffect(() => {
    saveFontScale(fontScale);
  }, [fontScale]);

  // Callback ổn định theo khoá tab để `TerminalSession` không báo lại trạng thái mỗi lần khung vẽ lại.
  const statusHandlers = useMemo(() => {
    const handlers: Record<string, (status: TerminalSocketStatus) => void> = {};
    for (const key of openKeys) {
      handlers[key] = (status) => setStatuses((m) => (m[key] === status ? m : { ...m, [key]: status }));
    }
    return handlers;
  }, [openKeys]);

  const hide = () => setState((s) => ({ ...s, open: false }));
  const closeTab = (key: string) => {
    setState((s) => removeTab(s, key));
    setStatuses(({ [key]: _, ...rest }) => rest);
  };
  const kill = useMutation({
    mutationFn: (session: TerminalMachineSession) =>
      api.terminal.killSession(company.id, { machineId: session.machineId, projectKey: session.projectKey }),
    onSuccess: (_result, session) => {
      setToKill(null);
      // Phiên đã tắt: tab đang mở cho nó chỉ còn báo đã ngắt, đóng luôn.
      if (session.projectId) closeTab(targetKey({ machineId: session.machineId, projectId: session.projectId }));
      void sessions.refetch();
    },
    onError: () => setToKill(null),
  });

  const select = (machineId: string, projectId: string) => {
    setView('tabs');
    onShow({ machineId, projectId });
  };

  const opened = state.tabs.length;
  const connected = state.tabs.filter((x) => statuses[targetKey(x)] === 'open').length;
  const findTarget = (ref: TargetRef) =>
    list.find((x) => x.machineId === ref.machineId && x.projectId === ref.projectId);
  const loading = (
    <TerminalDockEmpty>
      <Spinner />
    </TerminalDockEmpty>
  );

  let machinesBody: ReactNode = null;
  if (view === 'machines') {
    const machineGroups = (sessions.data?.machines ?? []).map((machine) => ({
      id: machine.machineId,
      label: machine.hostname,
      ok: machine.ok,
      items: live
        .filter((x) => x.machineId === machine.machineId)
        .map((x) => ({
          id: x.projectKey,
          title: x.projectName ?? x.projectKey,
          detail: x.projectName ? x.projectKey : t('machines.oldProject'),
          viewed: x.attached > 0,
          viewersLabel: x.attached > 0 ? t('machines.viewers', { count: x.attached }) : t('machines.noViewers'),
          activityLabel: t('machines.activity', { when: formatRelative(x.activityAt, lang) }),
          activityTitle: formatDateTime(x.activityAt, lang),
          openHere: x.projectId !== null && openKeys.has(targetKey({ machineId: x.machineId, projectId: x.projectId })),
          canOpen: x.projectId !== null,
          killing:
            kill.isPending && kill.variables?.machineId === x.machineId && kill.variables?.projectKey === x.projectKey,
        })),
    }));
    machinesBody = sessions.isLoading ? (
      <TerminalDockEmpty>
        <Spinner label={t('machines.loading')} />
      </TerminalDockEmpty>
    ) : sessions.error ? (
      <TerminalDockEmpty>{t('machines.failed')}</TerminalDockEmpty>
    ) : (
      <TerminalMachineSessions
        title={t('machines.title')}
        description={t('machines.hint')}
        groups={machineGroups}
        emptyLabel={t('machines.empty')}
        errorLabel={t('machines.unreachable')}
        openLabel={t('machines.open')}
        openHereLabel={t('machines.openHere')}
        refreshLabel={t('machines.refresh')}
        updatedLabel={sessions.dataUpdatedAt ? formatRelative(new Date(sessions.dataUpdatedAt), lang) : undefined}
        refreshing={sessions.isFetching}
        onRefresh={() => void sessions.refetch()}
        onOpen={(machineId, projectKey) => {
          const session = live.find((x) => x.machineId === machineId && x.projectKey === projectKey);
          if (session?.projectId) select(machineId, session.projectId);
        }}
        killLabel={(name) => t('machines.kill', { name })}
        onKill={(machineId, projectKey) => {
          kill.reset();
          setToKill(live.find((x) => x.machineId === machineId && x.projectKey === projectKey) ?? null);
        }}
        notice={
          kill.error ? (
            <TerminalBanner tone="error">
              {kill.error instanceof ApiError && kill.error.status === 423
                ? t('machines.killLocked')
                : t('machines.killFailed', { message: kill.error.message })}
            </TerminalBanner>
          ) : null
        }
      />
    );
  }

  let body: ReactNode;
  if (targets.isLoading) body = loading;
  else if (targets.error) body = <TerminalDockEmpty>{t('targetsFailed')}</TerminalDockEmpty>;
  else if (opened === 0) {
    body = (
      <TerminalPickerList
        title={t('emptyTitle')}
        description={t('emptyHint')}
        groups={groups}
        emptyLabel={t('noTargets')}
        onSelect={select}
      />
    );
  } else {
    body = (
      <>
        <TerminalTabs
          label={t('tabsLabel')}
          activeId={state.activeKey}
          tabs={state.tabs.map((ref) => {
            const key = targetKey(ref);
            const target = findTarget(ref);
            const status = statuses[key] ?? 'connecting';
            return {
              id: key,
              title: target?.projectName ?? t('title'),
              detail: target?.hostname,
              tone: status,
              statusLabel: t(`status.${status}`),
            };
          })}
          closeLabel={(name) => t('closeTab', { name })}
          onSelect={(key) => setState((s) => ({ ...s, activeKey: key }))}
          onClose={closeTab}
          add={<TerminalPickerMenu label={t('addTab')} groups={groups} emptyLabel={t('noTargets')} onSelect={select} />}
        />
        <Suspense fallback={loading}>
          {state.tabs.map((ref) => {
            const key = targetKey(ref);
            const selected = key === state.activeKey;
            return (
              <TerminalSession
                key={key}
                machineId={ref.machineId}
                projectId={ref.projectId}
                target={findTarget(ref)}
                selected={selected}
                active={selected && state.open}
                fontScale={fontScale}
                unlockGeneration={unlockGeneration}
                onUnlocked={() => setUnlockGeneration((g) => g + 1)}
                onHide={hide}
                onStatusChange={statusHandlers[key]}
              />
            );
          })}
        </Suspense>
      </>
    );
  }

  return (
    <>
      {state.started ? (
        <TerminalDockPanel id={panelId} label={t('title')} open={state.open}>
          <TerminalDockHeader
            title={t('title')}
            summary={
              [
                opened > 0 ? t('summary', { opened, connected }) : null,
                sessions.data ? t('summaryLive', { count: live.length }) : null,
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            actions={
              <>
                <TerminalViewToggle
                  label={t('machines.title')}
                  pressed={view === 'machines'}
                  count={sessions.data ? live.length : undefined}
                  onClick={() => setView((v) => (v === 'machines' ? 'tabs' : 'machines'))}
                />
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
                <TerminalHideButton label={t('hide')} onClick={hide} />
              </>
            }
          />
          {machinesBody}
          {/* Giấu chứ không gỡ phần tab khi xem phiên trên máy: các phiên vẫn giữ kết nối. */}
          <TerminalPane hidden={view === 'machines'}>{body}</TerminalPane>
        </TerminalDockPanel>
      ) : null}
      <ConfirmDialog
        open={toKill !== null}
        onOpenChange={(open) => {
          if (!open) setToKill(null);
        }}
        title={t('machines.killTitle')}
        body={t('machines.killBody', {
          name: toKill?.projectName ?? toKill?.projectKey ?? '',
          host: toKill?.hostname ?? '',
        })}
        confirmLabel={t('machines.killConfirm')}
        destructive
        onConfirm={() => toKill && kill.mutate(toKill)}
      />
      <TerminalLauncher
        label={state.open ? t('hide') : opened > 0 ? t('showWithCount', { opened, connected }) : t('show')}
        open={state.open}
        opened={opened}
        connected={connected}
        controls={panelId}
        onToggle={() => (state.open ? hide() : onShow())}
      />
    </>
  );
}
