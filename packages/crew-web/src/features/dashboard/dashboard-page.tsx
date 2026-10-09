// crew: tự dựng
import { Link, useNavigate } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  IssueRow,
  MachineCard,
  MutedText,
  PageHeader,
  RunRow,
  resolveStageKey,
  Skeleton,
  StageBadge,
} from '@/ds';
import { useT } from '@/i18n';
import { useDashboard } from './use-dashboard';

interface StatProps {
  label: string;
  value: number | undefined;
  hint?: string;
  to?: string;
}

function Stat({ label, value, hint, to }: StatProps) {
  const body = (
    <Card data-testid="stat-card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle data-testid="stat-value">{value ?? '–'}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent>
          <MutedText>{hint}</MutedText>
        </CardContent>
      ) : null}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

/** Tổng quan (S2): số liệu, run gần đây, máy, yêu cầu gần đây. Không có chi phí, ngân sách hay nút điều khiển hàng loạt. */
export function DashboardPage() {
  const { t } = useT('dashboard');
  const { company } = useCompany();
  const navigate = useNavigate();
  const d = useDashboard(company.id);
  const base = `/${company.issuePrefix}`;
  const s = d.summary.data;
  const agentName = new Map((d.agents.data ?? []).map((a) => [a.id, a.name]));
  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('title')} description={t('description')} />
      {d.summary.error ? (
        <ErrorState
          title={t('loadFailed')}
          message={d.summary.error.message}
          onRetry={() => void d.summary.refetch()}
        />
      ) : null}
      <section aria-label={t('cards.label')} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={t('cards.running')}
          value={s?.agents.running}
          hint={s ? t('cards.agentsHint', { active: s.agents.active, error: s.agents.error }) : undefined}
          to={`${base}/agents`}
        />
        <Stat label={t('cards.paused')} value={s?.agents.paused} to={`${base}/agents`} />
        <Stat
          label={t('cards.open')}
          value={s?.tasks.open}
          hint={s ? t('cards.openHint', { inProgress: s.tasks.inProgress }) : undefined}
          to={`${base}/issues`}
        />
        <Stat label={t('cards.blocked')} value={s?.tasks.blocked} to={`${base}/inbox?tab=stuck`} />
        <Stat label={t('cards.awaiting')} value={d.issues.data ? d.awaiting : undefined} to={`${base}/inbox`} />
      </section>
      {d.issues.error ? <ErrorState title={t('loadFailed')} message={d.issues.error.message} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('runs.heading')}</CardTitle>
          {d.live.data ? <MutedText>{t('runs.live', { count: d.live.data.length })}</MutedText> : null}
        </CardHeader>
        <CardContent className="flex flex-col">
          {d.runs.isLoading ? <Skeleton /> : null}
          {d.runs.error ? <ErrorState title={t('runs.loadFailed')} message={d.runs.error.message} /> : null}
          {d.runs.data?.length === 0 ? <MutedText>{t('runs.empty')}</MutedText> : null}
          {(d.runs.data ?? []).map((run) => {
            const href = `${base}/runs/${run.id}`;
            return (
              <div key={run.id} data-testid="recent-run" className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <RunRow
                    id={run.id}
                    status={run.status}
                    agentName={agentName.get(run.agentId)}
                    startedAt={run.startedAt ? String(run.startedAt) : String(run.createdAt)}
                    href={href}
                    onOpen={() => navigate(href)}
                  />
                </div>
                <Link to={href} className="shrink-0">
                  {t('runs.view')}
                </Link>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('machines.heading')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {d.machines.isLoading ? <Skeleton /> : null}
          {d.machines.error ? <ErrorState title={t('machines.loadFailed')} message={d.machines.error.message} /> : null}
          {d.machines.data?.length === 0 ? <MutedText>{t('machines.empty')}</MutedText> : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(d.machines.data ?? []).map((m) => (
              <MachineCard key={m.machineId} report={m.latest} latestAt={m.lastSeenAt} now={now} load24h={m.load24h} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('recent.heading')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          {d.roots.isLoading ? <Skeleton /> : null}
          {d.roots.error ? <ErrorState title={t('recent.loadFailed')} message={d.roots.error.message} /> : null}
          {d.roots.data && d.recentRoots.length === 0 ? <MutedText>{t('recent.empty')}</MutedText> : null}
          {d.recentRoots.map((root) => {
            const href = `${base}/issues/${root.identifier}`;
            return (
              <IssueRow
                key={root.id}
                identifier={root.identifier}
                title={root.title}
                status={root.status}
                stage={<StageBadge stage={resolveStageKey(root.stage, root.kind)} />}
                href={href}
                onOpen={() => navigate(href)}
              />
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
