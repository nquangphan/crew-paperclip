// crew: tự dựng
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LiveRun } from '@/api';
import { useCompany, useMe } from '@/app/hooks';
import {
  ActivityRow,
  AgentRunCard,
  Alert,
  BarChart,
  Card,
  CardContent,
  ChartCard,
  DashboardHeading,
  DashboardList,
  DashboardMoreLink,
  ErrorState,
  MachineCard,
  MetricCard,
  MutedText,
  resolveStageKey,
  Skeleton,
  StageBadge,
  TaskRow,
} from '@/ds';
import { AlertTriangle, Bot, CircleDot, ShieldCheck, Users } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access';
import { useContributionsSummary } from '@/features/contributions/use-contributions';
import { useIssueOpener } from '@/features/issues';
import { formatRelative, useT } from '@/i18n';
import {
  activityTarget,
  issueStatusBars,
  pausedBanner,
  RUN_COLORS,
  runActivityBars,
  STATUS_COLORS,
  successRateBars,
} from './dashboard-logic';
import { useDashboard } from './use-dashboard';

/** Tổng quan (S2), bố cục theo Dashboard Paperclip: banner, Agent, thẻ số, biểu đồ, hoạt động và yêu cầu, máy. */
export function DashboardPage() {
  const { t, lang } = useT('dashboard');
  const common = useT();
  const { company } = useCompany();
  const me = useMe();
  const navigate = useNavigate();
  const d = useDashboard(company.id);
  const { isOwner } = useCompanyAccess();
  // Chỉ owner duyệt góp ý, nên chỉ owner có thẻ này (và chỉ owner gọi số đếm).
  const contributionsPending = useContributionsSummary(company.id, isOwner);
  const base = `/${company.issuePrefix}`;
  const s = d.summary.data;
  const now = Date.now();
  const ago = (iso: string | Date) => formatRelative(iso, lang);

  /** Yêu cầu mở popup trên trang hiện tại; Cmd/Ctrl+click mở trang đầy đủ ở tab mới. */
  const opener = useIssueOpener();
  const issueNav = (identifier: string) => ({ href: opener.href(identifier), onOpen: () => opener.open(identifier) });

  const agentName = useMemo(() => new Map((d.agents.data ?? []).map((a) => [a.id, a.name])), [d.agents.data]);
  const ctx = useMemo(
    () => ({
      base,
      issues: new Map((d.issues.data ?? []).map((i) => [i.id, { identifier: i.identifier, title: i.title }])),
      agents: agentName,
      projects: new Map((d.projects.data ?? []).map((p) => [p.id, p.name])),
    }),
    [base, d.issues.data, agentName, d.projects.data],
  );

  const banner = pausedBanner(d.agents.data);
  const runBars = runActivityBars(s?.runActivity ?? [], (day) =>
    t('charts.runTitle', { date: day.date, total: day.total }),
  );
  const rateBars = successRateBars(s?.runActivity ?? [], (day, rate) =>
    t('charts.rateTitle', {
      date: day.date,
      percent: Math.round(rate * 100),
      ok: day.succeeded + day.recovered,
      total: day.total,
    }),
  );
  const statusChart = issueStatusBars(d.issues.data ?? [], new Date(now), (date, total) =>
    t('charts.issuesTitle', { date, total }),
  );
  const hasRecovered = (s?.runActivity ?? []).some((day) => day.recovered > 0);

  const actorName = (e: { actorType: string; actorId: string }) => {
    if (e.actorType === 'agent') return agentName.get(e.actorId) ?? t('activity.system');
    if (e.actorType === 'user') return e.actorId === me?.id ? t('activity.you') : t('activity.user');
    return t('activity.system');
  };

  const runCard = (run: LiveRun) => {
    const issue = run.issueId ? d.issueById.get(run.issueId) : undefined;
    const identifier = issue?.identifier ?? run.issueId?.slice(0, 8);
    const time = run.finishedAt
      ? t('agents.finished', { time: ago(run.finishedAt) })
      : run.startedAt
        ? t('agents.started', { time: ago(run.startedAt) })
        : t('agents.queued', { time: ago(run.createdAt) });
    const runHref = `${base}/runs/${run.id}`;
    return (
      <AgentRunCard
        key={run.id}
        agentName={run.agentName ?? agentName.get(run.agentId) ?? ''}
        statusLabel={common.t(`status.${run.status}`, { defaultValue: run.status })}
        running={run.status === 'running'}
        timestamp={time}
        timestampIso={run.finishedAt ?? run.startedAt ?? run.createdAt}
        runHref={runHref}
        onOpenRun={() => navigate(runHref)}
        task={
          run.issueId && identifier
            ? {
                identifier,
                title: issue?.title ?? identifier,
                status: issue?.status ?? 'backlog',
                ...(issue?.identifier ? issueNav(issue.identifier) : { href: null }),
              }
            : null
        }
        noTaskText={run.invocationSource === 'timer' ? t('agents.scheduled') : t('agents.noTask')}
      />
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {d.summary.error ? (
        <ErrorState
          title={t('loadFailed')}
          message={d.summary.error.message}
          onRetry={() => void d.summary.refetch()}
        />
      ) : null}
      {d.issues.error ? <ErrorState title={t('loadFailed')} message={d.issues.error.message} /> : null}

      {banner === 'all-paused' ? (
        <Alert variant="warning" title={t('banner.allPaused')}>
          {t('banner.allPausedHint')} <Link to={`${base}/agents`}>{t('banner.allPausedAction')}</Link>
        </Alert>
      ) : null}
      {banner === 'no-agents' ? (
        <Alert variant="warning" title={t('banner.noAgents')}>
          <Link to={`${base}/agents`}>{t('banner.noAgentsAction')}</Link>
        </Alert>
      ) : null}

      <section aria-label={t('agents.heading')}>
        <DashboardHeading>{t('agents.heading')}</DashboardHeading>
        {d.live.isLoading ? <Skeleton /> : null}
        {d.live.error ? <ErrorState title={t('agents.loadFailed')} message={d.live.error.message} /> : null}
        {d.live.data && d.runs.length === 0 ? (
          <Card>
            <CardContent>
              <MutedText>{t('agents.empty')}</MutedText>
            </CardContent>
          </Card>
        ) : null}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            {d.runs.map(runCard)}
          </div>
          {d.runs.length > 0 ? (
            <div className="flex justify-end">
              <DashboardMoreLink href={`${base}/runs`} onOpen={() => navigate(`${base}/runs`)}>
                {(d.live.data?.length ?? 0) > d.runs.length
                  ? t('agents.moreRuns', { count: (d.live.data?.length ?? 0) - d.runs.length })
                  : t('agents.viewAll')}
              </DashboardMoreLink>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-label={t('cards.label')} className="grid grid-cols-2 gap-1 sm:gap-2 xl:grid-cols-4">
        <MetricCard
          icon={Bot}
          value={s ? s.agents.active + s.agents.running + s.agents.paused + s.agents.error : '–'}
          label={t('cards.agents')}
          description={
            s
              ? t('cards.agentsHint', { running: s.agents.running, paused: s.agents.paused, error: s.agents.error })
              : undefined
          }
          href={`${base}/agents`}
          onOpen={() => navigate(`${base}/agents`)}
        />
        <MetricCard
          icon={CircleDot}
          value={s?.tasks.inProgress ?? '–'}
          label={t('cards.inProgress')}
          description={s ? t('cards.inProgressHint', { open: s.tasks.open }) : undefined}
          href={`${base}/issues`}
          onOpen={() => navigate(`${base}/issues`)}
        />
        <MetricCard
          icon={AlertTriangle}
          value={s?.tasks.blocked ?? '–'}
          label={t('cards.blocked')}
          description={t('cards.blockedHint')}
          href={`${base}/inbox?tab=stuck`}
          onOpen={() => navigate(`${base}/inbox?tab=stuck`)}
        />
        <MetricCard
          icon={ShieldCheck}
          value={d.inbox.data ? d.awaiting : '–'}
          label={t('cards.awaiting')}
          description={t('cards.awaitingHint')}
          href={`${base}/inbox`}
          onOpen={() => navigate(`${base}/inbox`)}
        />
        {isOwner ? (
          <MetricCard
            icon={Users}
            value={contributionsPending ?? '–'}
            label={t('cards.contributions')}
            description={t('cards.contributionsHint')}
            href={`${base}/contributions`}
            onOpen={() => navigate(`${base}/contributions`)}
          />
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <ChartCard title={t('charts.runs')} subtitle={t('charts.last14')}>
          <BarChart
            bars={runBars}
            emptyText={t('charts.noRuns')}
            legend={[
              { color: RUN_COLORS.succeeded, label: t('charts.succeeded') },
              ...(hasRecovered ? [{ color: RUN_COLORS.recovered, label: t('charts.recovered') }] : []),
              { color: RUN_COLORS.failed, label: t('charts.failed') },
              { color: RUN_COLORS.other, label: t('charts.other') },
            ]}
          />
        </ChartCard>
        <ChartCard title={t('charts.status')} subtitle={t('charts.last14')}>
          <BarChart
            bars={statusChart.bars}
            emptyText={t('charts.noTasks')}
            legend={statusChart.statuses.map((st) => ({
              color: STATUS_COLORS[st],
              label: common.t(`status.${st}`, { defaultValue: st }),
            }))}
          />
        </ChartCard>
        <ChartCard title={t('charts.success')} subtitle={t('charts.last14')}>
          <BarChart bars={rateBars} emptyText={t('charts.noRuns')} />
        </ChartCard>
      </section>

      {d.machines.isLoading ? <Skeleton /> : null}
      {d.machines.error ? <ErrorState title={t('machines.loadFailed')} message={d.machines.error.message} /> : null}
      {d.machines.data?.length === 0 ? (
        <Card>
          <CardContent>
            <MutedText>{t('machines.empty')}</MutedText>
          </CardContent>
        </Card>
      ) : null}
      {d.machines.data && d.machines.data.length > 0 ? (
        <section aria-label={t('machines.heading')} className="grid gap-4 md:grid-cols-2">
          {d.machines.data.map((m) => (
            <MachineCard key={m.machineId} report={m.latest} latestAt={m.lastSeenAt} now={now} load24h={m.load24h} />
          ))}
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <DashboardHeading>{t('activity.heading')}</DashboardHeading>
          {d.activity.error ? <ErrorState title={t('activity.loadFailed')} message={d.activity.error.message} /> : null}
          {d.activity.isLoading ? <Skeleton /> : null}
          {d.activity.data?.length === 0 ? (
            <Card>
              <CardContent>
                <MutedText>{t('activity.empty')}</MutedText>
              </CardContent>
            </Card>
          ) : null}
          {d.activity.data && d.activity.data.length > 0 ? (
            <DashboardList>
              {d.activity.data.map((e) => {
                const target = activityTarget(e, ctx);
                const nav = target.issueIdentifier
                  ? issueNav(target.issueIdentifier)
                  : { href: target.href, onOpen: target.href ? () => navigate(target.href as string) : undefined };
                return (
                  <ActivityRow
                    key={e.id}
                    actorName={actorName(e)}
                    verb={t(`activity.verbs.${e.action}`, { defaultValue: e.action.replace(/[._]/g, ' ') })}
                    isIssue={e.entityType === 'issue'}
                    targetLabel={target.label}
                    targetTitle={target.title}
                    time={ago(e.createdAt)}
                    nav={nav}
                  />
                );
              })}
            </DashboardList>
          ) : null}
        </div>

        <div className="min-w-0">
          <DashboardHeading>{t('recent.heading')}</DashboardHeading>
          {d.roots.isLoading ? <Skeleton /> : null}
          {d.roots.error ? <ErrorState title={t('recent.loadFailed')} message={d.roots.error.message} /> : null}
          {d.roots.data && d.recentRoots.length === 0 ? (
            <Card>
              <CardContent>
                <MutedText>{t('recent.empty')}</MutedText>
              </CardContent>
            </Card>
          ) : null}
          {d.recentRoots.length > 0 ? (
            <DashboardList testId="recent-roots">
              {d.recentRoots.map((root) => (
                <TaskRow
                  key={root.id}
                  identifier={root.identifier}
                  title={root.title}
                  status={root.status}
                  statusLabel={common.t(`status.${root.status}`, { defaultValue: root.status })}
                  extra={<StageBadge stage={resolveStageKey(root.stage, root.kind)} />}
                  time={ago(root.updatedAt)}
                  nav={issueNav(root.identifier)}
                />
              ))}
            </DashboardList>
          ) : null}
        </div>
      </div>
    </div>
  );
}
