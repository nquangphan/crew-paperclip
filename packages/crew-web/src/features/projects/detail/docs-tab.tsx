// Tab Docs (S8.4): cây trang, đọc một trang và tìm kiếm, lọc theo project (data crew.docs.*).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type DocsPage, type DocsTree, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { Button, CardDescription, EmptyState, ErrorState, Input, MarkdownView, Spinner } from '@/ds';
import { formatDateTime, useT } from '@/i18n';

type TreePage = DocsTree['pages'][number];

/** Trang theo thứ tự cây: cha trước con, mỗi nút kèm độ sâu (để thụt lề). */
export function flattenPages(pages: readonly TreePage[]): { page: TreePage; depth: number }[] {
  const byParent = new Map<string | null, TreePage[]>();
  for (const page of pages) {
    const list = byParent.get(page.parentPath) ?? [];
    list.push(page);
    byParent.set(page.parentPath, list);
  }
  const known = new Set(pages.map((p) => p.path));
  const out: { page: TreePage; depth: number }[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const page of byParent.get(parent) ?? []) {
      if (seen.has(page.path)) continue;
      out.push({ page, depth });
      walk(page.path, depth + 1, new Set(seen).add(page.path));
    }
  };
  walk(null, 0, new Set());
  // Trang có cha không còn trong cây vẫn hiện, như trang gốc.
  for (const page of pages) {
    if (page.parentPath !== null && !known.has(page.parentPath)) out.push({ page, depth: 0 });
  }
  return out;
}

export function DocsTab({ projectId }: { projectId: string }) {
  const { t, lang } = useT('projects');
  const { company } = useCompany();
  const [path, setPath] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const query = q.trim();

  const projects = useQuery({
    queryKey: queryKeys.crew('crew.docs.projects', { companyId: company.id }),
    queryFn: () => api.crew.docsProjects(company.id),
  });
  const synced = projects.data?.some((p) => p.projectId === projectId) ?? false;
  const tree = useQuery({
    queryKey: queryKeys.crew('crew.docs.tree', { companyId: company.id, projectId }),
    queryFn: () => api.crew.docsTree(company.id, projectId),
    enabled: synced,
  });
  const page = useQuery<DocsPage | null>({
    queryKey: queryKeys.crew('crew.docs.page', { companyId: company.id, projectId, path }),
    queryFn: () => api.crew.docsPage(company.id, projectId, path ?? ''),
    enabled: synced && path !== null,
  });
  const search = useQuery({
    queryKey: queryKeys.crew('crew.docs.search', { companyId: company.id, projectId, q: query }),
    queryFn: () => api.crew.docsSearch(company.id, projectId, query),
    enabled: synced && query.length >= 2,
  });

  if (projects.isLoading || (synced && tree.isLoading)) return <Spinner />;
  const failure = projects.error ?? tree.error;
  if (failure) {
    return <ErrorState title={t('docs.loadFailed')} message={failure.message} retryLabel={t('common:action.retry')} />;
  }
  if (!synced || !tree.data) return <EmptyState title={t('docs.empty')} description={t('docs.emptyHint')} />;

  const docs = tree.data;
  const rows =
    query.length >= 2
      ? (search.data ?? []).map((hit) => ({ page: { ...hit, parentPath: null }, depth: 0 }))
      : flattenPages(docs.pages);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Input
          value={q}
          placeholder={t('docs.search')}
          aria-label={t('docs.search')}
          onChange={(e) => setQ(e.target.value)}
        />
        <CardDescription>
          {t('docs.meta', { commit: docs.commit.slice(0, 7), at: formatDateTime(docs.receivedAt, lang) })}
        </CardDescription>
        {rows.length === 0 && !search.isLoading ? <CardDescription>{t('docs.noResult')}</CardDescription> : null}
        <nav className="flex flex-col">
          {rows.map(({ page: p, depth }) => (
            <Button
              key={p.path}
              variant={p.path === path ? 'secondary' : 'ghost'}
              size="sm"
              className="justify-start"
              onClick={() => setPath(p.path)}
            >
              {'– '.repeat(depth)}
              {p.title}
            </Button>
          ))}
        </nav>
      </div>
      <div className="min-w-0">
        {path === null ? <CardDescription>{t('docs.pick')}</CardDescription> : null}
        {path !== null && page.isLoading ? <Spinner /> : null}
        {path !== null && page.error ? <ErrorState title={t('docs.loadFailed')} message={page.error.message} /> : null}
        {path !== null && !page.isLoading && !page.error && !page.data ? (
          <CardDescription>{t('docs.pageMissing')}</CardDescription>
        ) : null}
        {page.data ? <MarkdownView markdown={page.data.text} /> : null}
      </div>
    </div>
  );
}
