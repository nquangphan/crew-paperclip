// Khối "Runtime" trên thẻ máy (I10): ba runtime (Claude, Codex, OpenCode) với trạng thái từ bản tin máy, nút gạt
// theo máy (chỉ board) và nút "Cài runtime trên máy" xếp việc `runtimes-setup`.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  CrewMachine,
  CrewRuntime,
  MachineJob,
  MachineRuntimeSwitches,
  RuntimeSwitchState,
  RuntimesReport,
} from '@/api';
import { api, queryKeys } from '@/api';
import { Alert, Badge, Button, ConfirmDialog, MutedText, Section, ToggleSwitch } from '@/ds';
import { formatDateTime, formatUsd, useT } from '@/i18n';

const ORDER: readonly CrewRuntime[] = ['claude_local', 'codex_local', 'opencode_local'];
const SHORT: Record<CrewRuntime, 'claude' | 'codex' | 'opencode'> = {
  claude_local: 'claude',
  codex_local: 'codex',
  opencode_local: 'opencode',
};
/** Bật hai runtime này tốn quota riêng nên phải xác nhận. */
const NEEDS_CONFIRM: readonly CrewRuntime[] = ['codex_local', 'opencode_local'];
/** Hạn mức OpenCode Go theo ngày, tuần, tháng (USD). */
/** Tắt runtime này giữ cả Trợ Lý, reviewer và integrator của máy nên cũng phải xác nhận. */
const NEEDS_CONFIRM_OFF: readonly CrewRuntime[] = ['claude_local'];
const OPENCODE_LIMITS = { day: 12, week: 30, month: 60 } as const;

interface RuntimeBlockProps {
  companyId: string;
  machine: CrewMachine;
  /** Trạng thái công tắc của máy này; undefined khi chưa tải được. */
  switches: MachineRuntimeSwitches | undefined;
  switchesError: string | null;
  jobs: readonly MachineJob[];
}

function runtimesOf(machine: CrewMachine): RuntimesReport | null {
  return (machine.latest as { runtimes?: RuntimesReport }).runtimes ?? null;
}

/** Việc `runtimes-setup` mới nhất của máy. */
function latestSetupJob(jobs: readonly MachineJob[], machineId: string): MachineJob | null {
  const own = jobs.filter((j) => j.machineId === machineId && j.kind === 'runtimes-setup');
  return own.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

export function RuntimeBlock({ companyId, machine, switches, switchesError, jobs }: RuntimeBlockProps) {
  const { t, lang } = useT('machines');
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ runtime: CrewRuntime; enabled: boolean } | null>(null);
  const report = runtimesOf(machine);
  const host = machine.hostname;
  const unknown = t('runtime.unknown');
  const noReport = t('runtime.noReport');
  const yesNo = (v: boolean | null, yes: string, no: string) => (v === null ? unknown : v ? yes : no);

  const toggle = useMutation({
    mutationFn: (v: { runtime: CrewRuntime; enabled: boolean }) =>
      api.runtimes.set({ companyId, machineId: machine.machineId, ...v }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSwitches(companyId) }),
  });
  const setup = useMutation({
    mutationFn: () =>
      api.jobs.create({
        companyId,
        machineId: machine.machineId,
        kind: 'runtimes-setup',
        payload: { kind: 'runtimes-setup' },
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.machineJobs(companyId) });
    },
  });
  const job = latestSetupJob(jobs, machine.machineId);
  const setupBusy = setup.isPending || job?.status === 'queued' || job?.status === 'claimed';
  const name = (runtime: CrewRuntime) => t(`runtime.name.${SHORT[runtime]}`);

  const onToggle = (runtime: CrewRuntime, state: RuntimeSwitchState | undefined) => {
    const enabled = !(state?.enabled ?? false);
    if (enabled ? NEEDS_CONFIRM.includes(runtime) : NEEDS_CONFIRM_OFF.includes(runtime))
      setPending({ runtime, enabled });
    else toggle.mutate({ runtime, enabled });
  };

  const detail = (runtime: CrewRuntime): string[] => {
    if (runtime === 'claude_local') {
      const c = machine.latest.claude;
      return [
        t('runtime.claude', {
          version: c.version ?? unknown,
          login: yesNo(c.loggedIn, t('runtime.loggedIn'), t('runtime.loggedOut')),
        }),
      ];
    }
    if (!report) return [noReport];
    if (runtime === 'codex_local') {
      const c = report.codex;
      const lines = [
        t('runtime.codex', {
          version: c.version ?? unknown,
          login: yesNo(c.loggedIn, t('runtime.loggedIn'), t('runtime.loggedOut')),
        }),
      ];
      if (c.primaryUsedPct !== null) {
        lines.push(
          c.resetsAt
            ? t('runtime.codexQuotaReset', { pct: c.primaryUsedPct, time: formatDateTime(c.resetsAt, lang) })
            : t('runtime.codexQuota', { pct: c.primaryUsedPct }),
        );
      }
      return lines;
    }
    const o = report.opencode;
    const money = (v: number | null, limit: number) =>
      `${v === null ? `$${unknown}` : formatUsd(v, lang)}/${formatUsd(limit, lang)}`;
    return [
      t('runtime.opencode', {
        version: o.version ?? unknown,
        key: yesNo(o.keyPresent, t('runtime.keyPresent'), t('runtime.keyMissing')),
      }),
      t('runtime.opencodeCost', {
        day: money(o.costDay, OPENCODE_LIMITS.day),
        week: money(o.costWeek, OPENCODE_LIMITS.week),
        month: money(o.costMonth, OPENCODE_LIMITS.month),
      }),
    ];
  };

  /** Lý do công tắc bị khóa, lấy từ trạng thái công tắc của server và bản tin máy; rỗng khi công tắc dùng được. */
  const disabledReason = (runtime: CrewRuntime, state: RuntimeSwitchState | undefined): string => {
    if (!state) return t('runtime.disabledNoState');
    const reasons: string[] = [];
    if (state.locked) reasons.push(t(`runtime.locked.${state.locked}`));
    if (state.locked && runtime === 'opencode_local' && report?.opencode.keyPresent === false)
      reasons.push(t('runtime.disabledNoKey'));
    return reasons.join(' ');
  };

  const result = job?.status === 'done' && job.result?.kind === 'runtimes-setup' ? job.result : null;
  const keyMissing = report?.opencode.keyPresent === false || result?.opencode.keyPresent === false;

  return (
    <Section title={t('runtime.title', { host })}>
      {switchesError ? <Alert variant="destructive">{switchesError}</Alert> : null}
      {toggle.error ? (
        <Alert variant="destructive" title={t('runtime.toggleFailed')}>
          {toggle.error.message}
        </Alert>
      ) : null}
      <ul className="flex flex-col gap-3">
        {ORDER.map((runtime) => {
          const state = switches?.runtimes[runtime];
          const reason = disabledReason(runtime, state);
          return (
            <li key={runtime} className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <strong>{name(runtime)}</strong>
                {detail(runtime).map((line) => (
                  <MutedText key={line}>{line}</MutedText>
                ))}
                {state?.locked ? <MutedText>{t(`runtime.locked.${state.locked}`)}</MutedText> : null}
              </div>
              <ToggleSwitch
                checked={state?.enabled ?? false}
                disabled={!state || !!state.locked || toggle.isPending}
                {...(reason ? { title: reason } : {})}
                aria-label={t('runtime.toggle', { name: name(runtime), host })}
                onCheckedChange={() => onToggle(runtime, state)}
              />
            </li>
          );
        })}
      </ul>
      {keyMissing ? <Alert variant="warning">{t('runtime.keyHint')}</Alert> : null}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={setupBusy} onClick={() => setup.mutate()}>
            {t('runtime.setup')}
          </Button>
          {job ? (
            <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'}>
              {t(`queue.status.${job.status}`)}
            </Badge>
          ) : null}
        </div>
        {setup.error ? <Alert variant="destructive">{setup.error.message}</Alert> : null}
        {job?.status === 'failed' && job.errorText ? <Alert variant="destructive">{job.errorText}</Alert> : null}
        {result ? (
          <ul>
            <li>{t(result.wrappers.codex ? 'runtime.wrapperCodexOk' : 'runtime.wrapperCodexNo')}</li>
            <li>{t(result.wrappers.opencode ? 'runtime.wrapperOpencodeOk' : 'runtime.wrapperOpencodeNo')}</li>
            <li>
              {t('runtime.setupCodex', {
                version: result.codex.version ?? unknown,
                login: yesNo(result.codex.loggedIn, t('runtime.loggedIn'), t('runtime.loggedOut')),
              })}
            </li>
            <li>
              {t('runtime.setupOpencode', {
                version: result.opencode.version ?? unknown,
                key: yesNo(result.opencode.keyPresent, t('runtime.keyPresent'), t('runtime.keyMissing')),
              })}
            </li>
          </ul>
        ) : null}
      </div>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending
            ? t(pending.enabled ? 'runtime.confirmTitle' : 'runtime.disableConfirmTitle', {
                name: name(pending.runtime),
                host,
              })
            : ''
        }
        body={
          pending
            ? pending.enabled
              ? t(`runtime.confirmBody.${SHORT[pending.runtime]}`)
              : t('runtime.disableConfirmBody')
            : ''
        }
        confirmLabel={
          pending
            ? t(pending.enabled ? 'runtime.confirmAction' : 'runtime.disableConfirmAction', {
                name: name(pending.runtime),
              })
            : ''
        }
        onConfirm={() => {
          if (pending) toggle.mutate(pending);
          setPending(null);
        }}
      />
    </Section>
  );
}
