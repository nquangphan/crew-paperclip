// Tab Run (S11.6): các run của agent, mới nhất trước. Run mở ở trang run (feature runs).
import type { Agent } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { EmptyState, ErrorState, RunRow, Spinner } from '@/ds';
import { useT } from '@/i18n';
import { agentRef, companyHref } from '../paths';

export const RUNS_LIMIT = 50;

export function RunsTab({ agent }: { agent: Agent }) {
  const { t } = useT('agents');
  const { company } = useCompany();
  const navigate = useNavigate();
  const filters = { agentId: agent.id, limit: RUNS_LIMIT };
  const runs = useQuery({
    queryKey: queryKeys.runs(company.id, filters),
    queryFn: () => api.runs.list(company.id, filters),
  });
  if (runs.isLoading) return <Spinner />;
  if (runs.error) {
    return (
      <ErrorState
        title={t('runs.loadFailed')}
        message={runs.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void runs.refetch()}
      />
    );
  }
  const list = runs.data ?? [];
  if (list.length === 0) return <EmptyState title={t('runs.empty')} description={t('runs.emptyHint')} />;
  return (
    <div className="flex flex-col">
      {list.map((run) => {
        const href = companyHref(company.issuePrefix, `agents/${agentRef(agent)}/runs/${run.id}`);
        return (
          <RunRow
            key={run.id}
            id={run.id}
            status={run.status}
            startedAt={run.startedAt ? String(run.startedAt) : null}
            href={href}
            onOpen={() => navigate(href)}
          />
        );
      })}
    </div>
  );
}
