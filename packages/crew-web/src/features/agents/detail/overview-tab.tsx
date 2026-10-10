// Tab Tổng quan (S11.1, S11.8): run gần nhất, yêu cầu đang làm, environment và máy, vai trò ở các project; nếu chưa sẵn
// sàng thì liệt kê bước thiếu kèm "Làm tiếp" vào wizard.
import type { Agent } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IssueRow,
  PropertyList,
  RunRow,
  Spinner,
} from '@/ds';
import { useIssueOpener } from '@/features/issues';
import type { AgentReadiness } from '@/features/readiness';
import { useT } from '@/i18n';
import { agentRef, companyHref, resumeHref } from '../paths';
import { useAgentHoldings } from '../use-agent-roles';
import { environmentLabel, useAgentEnvironment } from './use-agent-environment';

const OPEN_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked'];

export function OverviewTab({ agent, readiness }: { agent: Agent; readiness: AgentReadiness | null }) {
  const { t } = useT('agents');
  const { company } = useCompany();
  const navigate = useNavigate();
  const opener = useIssueOpener();
  const runFilters = { agentId: agent.id, limit: 1 };
  const runs = useQuery({
    queryKey: queryKeys.runs(company.id, runFilters),
    queryFn: () => api.runs.list(company.id, runFilters),
  });
  const issueFilters = { assigneeAgentId: agent.id };
  const issues = useQuery({
    queryKey: queryKeys.issues(company.id, issueFilters),
    queryFn: () => api.issues.list(company.id, issueFilters),
  });
  const { byAgent } = useAgentHoldings();
  const { environment, machine, isLoading } = useAgentEnvironment(agent, company.id);
  if (runs.isLoading || issues.isLoading || isLoading) return <Spinner />;

  const latest = [...(runs.data ?? [])].sort((a, b) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  )[0];
  const working = (issues.data ?? []).filter((i) => OPEN_STATUSES.includes(i.status));
  const holdings = byAgent.get(agent.id) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {readiness && readiness.failed.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('overview.missing')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {readiness.failed.map((item) => {
                const href = resumeHref(company.issuePrefix, item.resume);
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3">
                    <span>{t(`readiness:${item.detail}`, { defaultValue: item.id })}</span>
                    {href ? (
                      <Button asChild variant="outline" size="sm">
                        <Link to={href}>{t('resume')}</Link>
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('overview.latestRun')}</CardTitle>
        </CardHeader>
        <CardContent>
          {latest ? (
            <RunRow
              id={latest.id}
              status={latest.status}
              startedAt={latest.startedAt ? String(latest.startedAt) : null}
              href={companyHref(company.issuePrefix, `agents/${agentRef(agent)}/runs/${latest.id}`)}
              onOpen={() => navigate(companyHref(company.issuePrefix, `agents/${agentRef(agent)}/runs/${latest.id}`))}
            />
          ) : (
            <CardDescription>{t('overview.noRun')}</CardDescription>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('overview.working')}</CardTitle>
        </CardHeader>
        <CardContent>
          {working.length === 0 ? (
            <CardDescription>{t('overview.noIssue')}</CardDescription>
          ) : (
            working.map((issue) => {
              const ref = issue.identifier ?? issue.id;
              return (
                <IssueRow
                  key={issue.id}
                  identifier={issue.identifier ?? ''}
                  title={issue.title}
                  status={issue.status}
                  href={opener.href(ref)}
                  onOpen={() => opener.open(ref)}
                />
              );
            })
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <PropertyList
            items={[
              {
                label: t('overview.environment'),
                value: environment ? environmentLabel(environment) : t('runtime.noEnvironment'),
              },
              { label: t('overview.machine'), value: machine?.hostname ?? t('runtime.unknown') },
              {
                label: t('overview.roles'),
                value:
                  holdings.length === 0 ? (
                    t('overview.noRoles')
                  ) : (
                    <span className="flex flex-col">
                      {holdings.map((h) => (
                        <span key={`${h.projectId}-${h.role}`}>{`${h.projectName} · ${t(`role.${h.role}`)}`}</span>
                      ))}
                    </span>
                  ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
