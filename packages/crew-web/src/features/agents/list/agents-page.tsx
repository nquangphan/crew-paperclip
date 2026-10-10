// Danh sách agent (S10): vai trò theo project, trạng thái chạy, sẵn sàng, lọc, Tạm dừng/Tiếp tục, Tạo agent.
import type { Agent } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  ReadinessBadge,
  Spinner,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { Pause, Play, Plus } from '@/ds/icons';
import { useProjectReadiness } from '@/features/readiness';
import { removalState } from '@/features/wizards';
import { useT } from '@/i18n';
import { agentRef, companyHref, resumeHref } from '../paths';
import { useAgentHoldings } from '../use-agent-roles';
import { useStatusFilter } from './use-status-filter';

const PAUSABLE = ['active', 'idle', 'running', 'error'];

export function AgentsPage() {
  const { t } = useT('agents');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const [filter, setFilter, FILTERS, matches] = useStatusFilter();
  const agents = useQuery({
    queryKey: queryKeys.agents(company.id),
    queryFn: () => api.agents.list(company.id),
  });
  const readiness = useProjectReadiness(company.id, api);
  const setupRuns = useQuery({
    queryKey: queryKeys.crew('crew.setupRuns', { companyId: company.id }),
    queryFn: () => api.crew.setupRuns(company.id),
  });
  const { byAgent } = useAgentHoldings();
  const toggle = useMutation({
    mutationFn: (agent: Agent) =>
      agent.status === 'paused' ? api.agents.resume(agent.id, company.id) : api.agents.pause(agent.id, company.id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents(company.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew('readiness') });
    },
  });

  const add = (
    <Button asChild>
      <Link to={companyHref(company.issuePrefix, 'agents/new')}>
        <Plus aria-hidden />
        {t('list.add')}
      </Link>
    </Button>
  );
  const header = <PageHeader title={t('list.title')} description={t('list.description')} actions={add} />;

  if (agents.isLoading) {
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  }
  if (agents.error) {
    return (
      <>
        {header}
        <ErrorState
          title={t('list.loadFailed')}
          message={agents.error.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void agents.refetch()}
        />
      </>
    );
  }
  const all = [...(agents.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  if (all.length === 0) {
    return (
      <>
        {header}
        <EmptyState title={t('list.empty')} description={t('list.emptyHint')} />
      </>
    );
  }
  const isRemoved = (a: Agent) =>
    removalState(setupRuns.data ?? [], { agentId: a.id, agentStatus: a.status }).status === 'removed';
  const rows = all.filter((a) => matches(a.status, isRemoved(a)));
  const readinessOf = (agentId: string) => readiness.data?.flatMap((p) => p.agents).find((a) => a.agentId === agentId);

  return (
    <>
      {header}
      <FilterBar>
        {FILTERS.map((id) => (
          <Button
            key={id}
            variant={filter === id ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {t(`list.filter.${id}`)}
          </Button>
        ))}
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t('list.emptyFiltered')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('list.col.name')}</TableHead>
              <TableHead>{t('list.col.roles')}</TableHead>
              <TableHead>{t('list.col.status')}</TableHead>
              <TableHead>{t('list.col.readiness')}</TableHead>
              <TableHead>{t('list.col.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((agent) => {
              const entry = readinessOf(agent.id);
              const holdings = byAgent.get(agent.id) ?? [];
              const resume = entry?.failed
                .map((item) => resumeHref(company.issuePrefix, item.resume))
                .find((href) => href !== null);
              return (
                <TableRow key={agent.id}>
                  <TableCell>
                    <Link to={companyHref(company.issuePrefix, `agents/${agentRef(agent)}`)}>{agent.name}</Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      {holdings.map((h) => (
                        <span key={`${h.projectId}-${h.role}`}>{`${h.projectName} · ${t(`role.${h.role}`)}`}</span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={agent.status} />
                  </TableCell>
                  <TableCell>{entry ? <ReadinessBadge state={entry.state} failed={entry.failed} /> : null}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {agent.status === 'paused' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={toggle.isPending}
                          aria-label={t('list.resumeAgent', { name: agent.name })}
                          onClick={() => toggle.mutate(agent)}
                        >
                          <Play aria-hidden />
                          {t('list.resumeShort')}
                        </Button>
                      ) : PAUSABLE.includes(agent.status) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={toggle.isPending}
                          aria-label={t('list.pauseAgent', { name: agent.name })}
                          onClick={() => toggle.mutate(agent)}
                        >
                          <Pause aria-hidden />
                          {t('list.pauseShort')}
                        </Button>
                      ) : null}
                      {resume ? (
                        <Button asChild variant="outline" size="sm">
                          <Link to={resume}>{t('resume')}</Link>
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {toggle.error ? <ErrorState title={t('list.actionFailed')} message={toggle.error.message} /> : null}
    </>
  );
}
