// Trang Docs (S16): chọn project, cây tài liệu, đọc trang, link nội bộ, link hỏng, file bị bỏ do quét bí mật,
// và tìm kiếm. Dữ liệu từ data crew.docs.* của plugin; chỉ đọc.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type DocsPage as DocsPageData, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { Button, EmptyState, ErrorState, Field, FilterBar, Input, MutedText, PageHeader, Spinner } from '@/ds';
import { formatDateTime, useT } from '@/i18n';
import { DocsTree } from './docs-nav';
import { DocsReader } from './docs-reader';

/** Từ khóa ngắn hơn ngưỡng này không gửi lên tìm. */
const MIN_QUERY = 2;

export function DocsPage() {
  const { t, lang } = useT('docs');
  const { company } = useCompany();
  const [chosen, setChosen] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const query = q.trim();

  const projects = useQuery({
    queryKey: queryKeys.crew('crew.docs.projects', { companyId: company.id }),
    queryFn: () => api.crew.docsProjects(company.id),
  });
  const names = useQuery({ queryKey: queryKeys.projects(company.id), queryFn: () => api.projects.list(company.id) });
  const projectId = chosen ?? projects.data?.[0]?.projectId ?? null;
  const labelOf = (id: string, repo: string): string => names.data?.find((p) => p.id === id)?.name ?? repo;

  const tree = useQuery({
    queryKey: queryKeys.crew('crew.docs.tree', { companyId: company.id, projectId }),
    queryFn: () => api.crew.docsTree(company.id, projectId as string),
    enabled: projectId !== null,
  });
  const page = useQuery<DocsPageData | null>({
    queryKey: queryKeys.crew('crew.docs.page', { companyId: company.id, projectId, path }),
    queryFn: () => api.crew.docsPage(company.id, projectId as string, path as string),
    enabled: projectId !== null && path !== null,
  });
  const search = useQuery({
    queryKey: queryKeys.crew('crew.docs.search', { companyId: company.id, projectId, q: query }),
    queryFn: () => api.crew.docsSearch(company.id, projectId as string, query),
    enabled: projectId !== null && query.length >= MIN_QUERY,
  });

  const header = <PageHeader title={t('title')} description={t('description')} />;
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
          title={t('loadFailed')}
          message={projects.error.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void projects.refetch()}
        />
      </>
    );
  }
  if (!projects.data?.length || projectId === null) {
    return (
      <>
        {header}
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      </>
    );
  }

  const docs = tree.data;
  const selectProject = (id: string) => {
    setChosen(id);
    setPath(null);
    setQ('');
  };
  const searching = query.length >= MIN_QUERY;

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <FilterBar>
          {projects.data.map((p) => (
            <Button
              key={p.projectId}
              variant={p.projectId === projectId ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={p.projectId === projectId}
              onClick={() => selectProject(p.projectId)}
            >
              {labelOf(p.projectId, p.repo)}
            </Button>
          ))}
        </FilterBar>
        {tree.isLoading ? <Spinner /> : null}
        {tree.error ? (
          <ErrorState
            title={t('loadFailed')}
            message={tree.error.message}
            retryLabel={t('common:action.retry')}
            onRetry={() => void tree.refetch()}
          />
        ) : null}
        {!tree.isLoading && !tree.error && !docs ? (
          <EmptyState title={t('noSnapshot')} description={t('noSnapshotHint')} />
        ) : null}
        {docs ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <Field label={t('search.label')} htmlFor="docs-search">
                <Input
                  id="docs-search"
                  type="search"
                  value={q}
                  placeholder={t('search.placeholder')}
                  onChange={(e) => setQ(e.target.value)}
                />
              </Field>
              <MutedText>
                {t('meta', { commit: docs.commit.slice(0, 7), at: formatDateTime(docs.receivedAt, lang) })}
              </MutedText>
              {searching ? (
                <section aria-label={t('search.results')} className="flex flex-col gap-1">
                  {search.isLoading ? <Spinner /> : null}
                  {search.error ? <MutedText>{search.error.message}</MutedText> : null}
                  {search.data ? <MutedText>{t('search.count', { count: search.data.length })}</MutedText> : null}
                  {(search.data ?? []).map((hit) => (
                    <Button
                      key={hit.path}
                      variant="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() => setPath(hit.path)}
                    >
                      {hit.title || hit.path}
                    </Button>
                  ))}
                </section>
              ) : (
                <DocsTree pages={docs.pages} current={path} onOpen={setPath} />
              )}
              {docs.dropped.length ? (
                <section aria-label={t('dropped.title')} className="flex flex-col gap-1">
                  <strong>{t('dropped.title')}</strong>
                  <MutedText>{t('dropped.hint')}</MutedText>
                  <ul>
                    {docs.dropped.map((d) => (
                      <li key={d.path}>{d.path}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
            <div className="min-w-0">
              {path === null ? <MutedText>{t('pick')}</MutedText> : null}
              {path !== null && page.isLoading ? <Spinner /> : null}
              {path !== null && page.error ? <ErrorState title={t('loadFailed')} message={page.error.message} /> : null}
              {path !== null && !page.isLoading && !page.error && !page.data ? (
                <MutedText>{t('page.missing', { path })}</MutedText>
              ) : null}
              {page.data ? <DocsReader page={page.data} onOpen={setPath} /> : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
