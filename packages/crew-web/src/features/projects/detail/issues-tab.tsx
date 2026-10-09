// Tab Yêu cầu (S8.1): issue của project, dùng lại IssueRow.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { EmptyState, ErrorState, IssueRow, Spinner } from '@/ds';
import { useT } from '@/i18n';
import { companyHref } from '../paths';

export function IssuesTab({ projectId }: { projectId: string }) {
  const { t } = useT('projects');
  const { company } = useCompany();
  const navigate = useNavigate();
  const filters = { projectId };
  const issues = useQuery({
    queryKey: queryKeys.issues(company.id, filters),
    queryFn: () => api.issues.list(company.id, filters),
  });
  const agents = useQuery({ queryKey: queryKeys.agents(company.id), queryFn: () => api.agents.list(company.id) });
  if (issues.isLoading) return <Spinner />;
  if (issues.error) {
    return (
      <ErrorState
        title={t('issues.loadFailed')}
        message={issues.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void issues.refetch()}
      />
    );
  }
  const list = issues.data ?? [];
  if (list.length === 0) return <EmptyState title={t('issues.empty')} description={t('issues.emptyHint')} />;
  const nameOf = new Map((agents.data ?? []).map((a) => [a.id, a.name]));
  return (
    <div className="flex flex-col">
      {list.map((issue) => {
        const href = companyHref(company.issuePrefix, `issues/${issue.identifier ?? issue.id}`);
        return (
          <IssueRow
            key={issue.id}
            identifier={issue.identifier ?? ''}
            title={issue.title}
            status={issue.status}
            assignee={issue.assigneeAgentId ? (nameOf.get(issue.assigneeAgentId) ?? null) : null}
            href={href}
            onOpen={() => navigate(href)}
          />
        );
      })}
    </div>
  );
}
