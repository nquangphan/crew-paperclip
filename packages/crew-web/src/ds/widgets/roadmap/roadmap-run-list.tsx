// crew: tự dựng
// Khối run trong thẻ việc của bản đồ: tối đa ROADMAP_RUN_LINES dòng mới nhất (chấm trạng thái, agent rút gọn, model, thời
// lượng, tiền) và dòng chân "+N run · tổng tiền · số run". Chiều cao khớp `runsHeight` của roadmap-layout.ts. Run đang
// chạy thì thời lượng tự tăng mỗi 30 giây ở client, không gọi lại server.
import { useEffect, useState } from 'react';
import { formatUsd, type Lang, useT } from '@/i18n';
import { cn } from '../../cn';
import {
  formatRunDuration,
  modelLabel,
  ROADMAP_RUN_LINES,
  type RunTone,
  runTone,
  shortAgentName,
} from './roadmap-runs';
import type { RoadmapRun, RoadmapRuns } from './roadmap-types';

type TFn = ReturnType<typeof useT>['t'];

const TICK_MS = 30_000;

/** Giờ hiện tại, tự cập nhật mỗi `TICK_MS` khi `live` (có run đang chạy). */
export function useRunClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [live]);
  return now;
}

const DOT: Record<RunTone, string> = {
  running: 'bg-(--status-task-icon-in_progress) motion-safe:animate-pulse',
  queued: 'border border-(--status-task-icon-in_progress) bg-transparent',
  succeeded: 'bg-(--status-task-icon-done)',
  failed: 'bg-(--status-task-icon-blocked)',
  cancelled: 'bg-(--status-task-icon-cancelled)',
};

const cost = (value: number | null, lang: Lang) => (value === null ? '—' : formatUsd(value, lang));

/** Ghi chú về tiền: gói thuê bao thì nói rõ không bị trừ tiền thật. */
export const runCostNote = (t: TFn, subscription: boolean) =>
  subscription ? t('roadmap.runs.noteSubscription') : t('roadmap.runs.noteApi');

function runText(t: TFn, lang: Lang, run: RoadmapRun, now: number): string {
  return [
    shortAgentName(run.agentName),
    modelLabel(run.model),
    t(`status.${run.status}`, { defaultValue: run.status }),
    formatRunDuration(run.startedAt, run.finishedAt, now),
    cost(run.costUsd, lang),
  ]
    .filter(Boolean)
    .join(', ');
}

/** Phần nhãn đọc màn hình về run của thẻ (nối vào aria-label của nút). */
export function roadmapRunsLabel(t: TFn, lang: Lang, runs: RoadmapRuns, now: number): string {
  const { total } = runs;
  const head = t(total.tree ? 'roadmap.runs.ariaTree' : 'roadmap.runs.aria', {
    count: total.count,
    cost: cost(total.costUsd, lang),
  });
  const lines = runs.runs.slice(0, ROADMAP_RUN_LINES).map((run) => runText(t, lang, run, now));
  const latest = lines.length ? t('roadmap.runs.latest', { runs: lines.join('; ') }) : null;
  return [head, runCostNote(t, total.subscription), latest].filter(Boolean).join('. ');
}

function RunLine({ run, now }: { run: RoadmapRun; now: number }) {
  const { lang } = useT();
  const model = modelLabel(run.model);
  const duration = formatRunDuration(run.startedAt, run.finishedAt, now);
  return (
    <span data-slot="roadmap-run" data-run-status={run.status} className="flex h-4 min-w-0 items-center gap-1">
      <span aria-hidden className={cn('mr-0.5 size-1.5 shrink-0 rounded-full', DOT[runTone(run.status)])} />
      <span className="min-w-0 flex-1 truncate text-card-foreground/85">{shortAgentName(run.agentName)}</span>
      {model ? (
        <span className="max-w-[68px] shrink-0 truncate rounded-sm bg-foreground/8 px-1 text-[10px] leading-[14px] font-medium text-card-foreground/80">
          {model}
        </span>
      ) : null}
      <span className="w-[34px] shrink-0 text-right tabular-nums">{duration ?? '—'}</span>
      <span className="w-[38px] shrink-0 text-right font-medium tabular-nums text-card-foreground/90">
        {cost(run.costUsd, lang)}
      </span>
    </span>
  );
}

/** Khối run của thẻ (bỏ qua khi thẻ không có run). */
export function RoadmapRunList({ runs, now }: { runs: RoadmapRuns; now: number }) {
  const { t, lang } = useT();
  const shown = runs.runs.slice(0, ROADMAP_RUN_LINES);
  const more = Math.max(0, runs.count - shown.length);
  const { total } = runs;
  return (
    <span
      data-slot="roadmap-runs"
      className="block border-t border-(--tone)/20 pt-1.5 text-[11px] leading-4 text-muted-foreground"
    >
      {shown.map((run) => (
        <RunLine key={run.id} run={run} now={now} />
      ))}
      <span data-slot="roadmap-runs-total" className="flex h-4 min-w-0 items-center gap-1.5">
        {more > 0 ? <span className="shrink-0">{t('roadmap.runs.more', { count: more })}</span> : null}
        <span className="ml-auto min-w-0 truncate text-right" title={runCostNote(t, total.subscription)}>
          {t(total.tree ? 'roadmap.runs.totalTree' : 'roadmap.runs.total', {
            count: total.count,
            cost: cost(total.costUsd, lang),
          })}
        </span>
      </span>
    </span>
  );
}
