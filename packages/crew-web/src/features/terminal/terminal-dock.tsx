// Terminal của owner dạng khung nổi như khung chat: nút tròn ở góc dưới bên phải mọi trang trong company để ẩn hiện.
// Khung chứa nhiều tab, mỗi tab một terminal (slot 1..9) của một dự án trên một máy, tự owner mở (không tự mở sẵn cái
// nào); chọn lại dự án đã có tab ở nút "+" thì mở thêm terminal cho dự án đó. Thanh trên đếm số
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
import { freeSlot, pickerGroups, type TabRef, tabKey, tabTitle, targetKey } from './target-picker';
import type { TerminalSocketStatus } from './use-terminal-socket';
import { FONT_SCALES, fontSizeFor, nextFontScale, readFontScale, saveFontScale } from './xterm-options';

const TerminalSession = lazy(async () => ({ default: (await import('./terminal-session')).TerminalSession }));

/** Khung đang hiện thì hỏi lại phiên trên máy sau chừng này mili giây (mỗi lần hỏi mở một kết nối SSH tới mỗi máy). */
const SESSIONS_REFRESH_MS = 15_000;

/** Báo "đã mở đủ terminal" tự ẩn sau chừng này mili giây. */
const SLOTS_FULL_NOTICE_MS = 5000;

/** Chỗ chừa cho nút tròn để khung nổi khác (`FloatingNotice`) đứng trên nó. */
const DOCK_SPACE = '4.5rem';

type TargetRef = Pick<TerminalTarget, 'machineId' | 'projectId'>;

interface TerminalDockApi {
  /** Mở khung nổi; truyền dự án thì chọn tab đầu tiên của dự án đó (chưa có thì mở slot 1). */
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
  tabs: TabRef[];
  activeKey: string | null;
}

/** Chọn tab của đúng slot đó (chưa có thì nối vào cuối). */
export function openTab(state: DockState, ref: TabRef): DockState {
  const key = tabKey(ref);
  const tabs = state.tabs.some((x) => tabKey(x) === key) ? state.tabs : [...state.tabs, ref];
  return { ...state, tabs, activeKey: key };
}

/** Chọn tab đầu tiên của dự án; chưa có tab nào thì mở slot 1. */
export function focusTarget(state: DockState, target: TargetRef): DockState {
  const key = targetKey(target);
  const first = state.tabs.find((x) => targetKey(x) === key);
  return first ? { ...state, activeKey: tabKey(first) } : openTab(state, { ...target, slot: 1 });
}

/**
 * Mở thêm terminal cho dự án (chọn ở danh sách hay nút "+"). Chưa có tab nào thì mở slot 1 để gắn lại phiên tên cũ nếu
 * còn sống. Đã có tab thì mở slot trống nhỏ nhất, bỏ qua cả slot đang mở ở tab lẫn phiên đang sống trên máy
 * (`liveSlots`): mở thêm là muốn terminal mới, không gắn nhầm vào phiên đang dùng ở trình duyệt khác; muốn gắn lại phiên
 * cũ thì mở từ "Phiên trên máy". Hết slot thì null.
 */
export function addTab(state: DockState, target: TargetRef, liveSlots: readonly number[] = []): DockState | null {
  const key = targetKey(target);
  const openSlots = state.tabs.filter((x) => targetKey(x) === key).map((x) => x.slot);
  if (openSlots.length === 0) return openTab(state, { ...target, slot: 1 });
  const slot = freeSlot([...openSlots, ...liveSlots]);
  return slot === null ? null : openTab(state, { ...target, slot });
}

/** Bỏ tab; tab đang chọn bị bỏ thì chọn tab bên cạnh (bên phải, hết thì bên trái). */
export function removeTab(state: DockState, key: string): DockState {
  const i = state.tabs.findIndex((x) => tabKey(x) === key);
  if (i === -1) return state;
  const tabs = state.tabs.filter((_, j) => j !== i);
  const next = tabs[i] ?? tabs[i - 1];
  const activeKey = state.activeKey === key ? (next ? tabKey(next) : null) : state.activeKey;
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
      return target ? focusTarget(opened, target) : opened;
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
  /** Tên dự án vừa chọn mở thêm mà đã dùng hết slot (báo nhẹ, tự ẩn). */
  const [slotsFull, setSlotsFull] = useState<{ name: string; host: string } | null>(null);
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
  const openKeys = useMemo(() => new Set(state.tabs.map(tabKey)), [state.tabs]);
  const openTargets = useMemo(() => new Set(state.tabs.map(targetKey)), [state.tabs]);
  const groups = useMemo(
    () =>
      pickerGroups(list, openTargets, (target) => {
        const session = live.find((x) => x.machineId === target.machineId && x.projectKey === target.projectKey);
        return session ? t('liveNote') : undefined;
      }),
    [list, openTargets, live, t],
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

  useEffect(() => {
    if (!slotsFull) return;
    const timer = setTimeout(() => setSlotsFull(null), SLOTS_FULL_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [slotsFull]);

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
      api.terminal.killSession(company.id, {
        machineId: session.machineId,
        projectKey: session.projectKey,
        slot: session.slot,
      }),
    onSuccess: (_result, session) => {
      setToKill(null);
      // Phiên đã tắt: tab đang mở cho đúng slot đó chỉ còn báo đã ngắt, đóng luôn.
      if (session.projectId) {
        closeTab(tabKey({ machineId: session.machineId, projectId: session.projectId, slot: session.slot }));
      }
      void sessions.refetch();
    },
    onError: () => setToKill(null),
  });

  /** Chọn dự án ở danh sách hay nút "+": mở thêm một terminal cho dự án đó (`addTab`). */
  const select = (machineId: string, projectId: string) => {
    setView('tabs');
    const target = list.find((x) => x.machineId === machineId && x.projectId === projectId);
    const liveSlots = live
      .filter((x) => x.machineId === machineId && x.projectKey === target?.projectKey)
      .map((x) => x.slot);
    const next = addTab(state, { machineId, projectId }, liveSlots);
    if (!next) {
      setSlotsFull({ name: target?.projectName ?? t('title'), host: target?.hostname ?? '' });
      return;
    }
    setSlotsFull(null);
    setState(next);
  };
  /** Mở tab cho đúng phiên trên máy (đúng slot). */
  const openSession = (ref: TabRef) => {
    setView('tabs');
    setState((s) => openTab(s, ref));
  };
  const sessionId = (x: Pick<TerminalMachineSession, 'projectKey' | 'slot'>) => `${x.projectKey}/${x.slot}`;
  const sessionTitle = (x: TerminalMachineSession) => tabTitle(x.projectName ?? x.projectKey, x.slot);

  const opened = state.tabs.length;
  const connected = state.tabs.filter((x) => statuses[tabKey(x)] === 'open').length;
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
          id: sessionId(x),
          title: sessionTitle(x),
          detail: x.projectName ? x.projectKey : t('machines.oldProject'),
          viewed: x.attached > 0,
          viewersLabel: x.attached > 0 ? t('machines.viewers', { count: x.attached }) : t('machines.noViewers'),
          activityLabel: t('machines.activity', { when: formatRelative(x.activityAt, lang) }),
          activityTitle: formatDateTime(x.activityAt, lang),
          openHere:
            x.projectId !== null &&
            openKeys.has(tabKey({ machineId: x.machineId, projectId: x.projectId, slot: x.slot })),
          canOpen: x.projectId !== null,
          killing:
            kill.isPending && kill.variables?.machineId === x.machineId && sessionId(kill.variables) === sessionId(x),
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
        onOpen={(machineId, id) => {
          const session = live.find((x) => x.machineId === machineId && sessionId(x) === id);
          if (session?.projectId) openSession({ machineId, projectId: session.projectId, slot: session.slot });
        }}
        killLabel={(name) => t('machines.kill', { name })}
        onKill={(machineId, id) => {
          kill.reset();
          setToKill(live.find((x) => x.machineId === machineId && sessionId(x) === id) ?? null);
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
            const key = tabKey(ref);
            const target = findTarget(ref);
            const status = statuses[key] ?? 'connecting';
            return {
              id: key,
              title: tabTitle(target?.projectName ?? t('title'), ref.slot),
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
        {slotsFull ? <TerminalBanner tone="warning">{t('slotsFull', slotsFull)}</TerminalBanner> : null}
        <Suspense fallback={loading}>
          {state.tabs.map((ref) => {
            const key = tabKey(ref);
            const selected = key === state.activeKey;
            return (
              <TerminalSession
                key={key}
                machineId={ref.machineId}
                projectId={ref.projectId}
                slot={ref.slot}
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
          name: toKill ? sessionTitle(toKill) : '',
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
