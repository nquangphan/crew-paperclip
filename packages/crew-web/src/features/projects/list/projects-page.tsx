// Danh sách project (S7): trạng thái sẵn sàng, Làm tiếp, Thêm project, gắn sao.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  ReadinessBadge,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { Plus } from '@/ds/icons';
import { useProjectReadiness } from '@/features/readiness';
import { useT } from '@/i18n';
import { companyHref, projectRef } from '../paths';

export function ProjectsPage() {
  const { t } = useT('projects');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: queryKeys.projects(company.id),
    queryFn: () => api.projects.list(company.id),
  });
  const readiness = useProjectReadiness(company.id, api);
  const prefs = useQuery({
    queryKey: queryKeys.sidebarPreferences(company.id),
    queryFn: () => api.sidebar.preferences(company.id),
  });
  const setupRuns = useQuery({
    queryKey: queryKeys.crew('crew.setupRuns', { companyId: company.id }),
    queryFn: () => api.crew.setupRuns(company.id),
  });
  const star = useMutation({
    mutationFn: (orderedIds: string[]) => api.sidebar.savePreferences(company.id, { orderedIds }),
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.sidebarPreferences(company.id), saved),
  });

  const add = (
    <Button asChild>
      <Link to={companyHref(company.issuePrefix, 'projects/new')}>
        <Plus aria-hidden />
        {t('list.add')}
      </Link>
    </Button>
  );
  const header = <PageHeader title={t('list.title')} description={t('list.description')} actions={add} />;

  if (projects.isLoading) {
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  }
  if (projects.error) {
    return (
      <>
        {header}
        <ErrorState
          title={t('list.loadFailed')}
          message={projects.error.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void projects.refetch()}
        />
      </>
    );
  }

  const starred = prefs.data?.orderedIds ?? [];
  const rank = (id: string) => {
    const i = starred.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const rows = (projects.data ?? [])
    .filter((p) => !p.archivedAt)
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  if (rows.length === 0) {
    return (
      <>
        {header}
        <EmptyState title={t('list.empty')} description={t('list.emptyHint')} />
      </>
    );
  }
  const unfinishedRun = (projectId: string) =>
    (setupRuns.data ?? []).find((r) => r.kind === 'add-project' && r.status !== 'done' && r.projectId === projectId);
  const toggleStar = (id: string) =>
    star.mutate(starred.includes(id) ? starred.filter((x) => x !== id) : [...starred, id]);

  return (
    <>
      {header}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('list.col.star')}</TableHead>
            <TableHead>{t('list.col.name')}</TableHead>
            <TableHead>{t('list.col.tasks')}</TableHead>
            <TableHead>{t('list.col.readiness')}</TableHead>
            <TableHead>{t('list.col.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((project) => {
            const entry = readiness.data?.find((r) => r.projectId === project.id);
            const isStarred = starred.includes(project.id);
            const run = unfinishedRun(project.id);
            const resume = run
              ? companyHref(company.issuePrefix, `projects/new?resume=${encodeURIComponent(run.id)}`)
              : companyHref(company.issuePrefix, `projects/${projectRef(project)}?tab=readiness`);
            return (
              <TableRow key={project.id}>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-pressed={isStarred}
                    aria-label={t(isStarred ? 'star.remove' : 'star.add', { name: project.name })}
                    disabled={star.isPending}
                    onClick={() => toggleStar(project.id)}
                  >
                    <span aria-hidden>{isStarred ? '★' : '☆'}</span>
                  </Button>
                </TableCell>
                <TableCell>
                  <Link to={companyHref(company.issuePrefix, `projects/${projectRef(project)}`)}>{project.name}</Link>
                </TableCell>
                <TableCell>{project.taskCount ?? 0}</TableCell>
                <TableCell>{entry ? <ReadinessBadge state={entry.state} failed={entry.failed} /> : null}</TableCell>
                <TableCell>
                  {entry?.state === 'not_ready' ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to={resume}>{t('resume')}</Link>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {star.error ? <ErrorState title={t('star.failed')} message={star.error.message} /> : null}
    </>
  );
}
