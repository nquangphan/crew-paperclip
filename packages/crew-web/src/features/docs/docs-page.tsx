// Trang Docs (S16), bố cục như trang Hướng dẫn: thanh bên trái (chọn project, tìm, cây tài liệu), bài đọc ở giữa và mục
// lục "Trên trang này" bên phải. Project và trang nằm trên URL (`?project=…&path=…`) để gửi link và dùng nút Lùi/Tới;
// chưa chọn trang thì mở trang chủ của docs. Dữ liệu từ data crew.docs.* của plugin; chỉ đọc.
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api, type DocsPage as DocsPageData, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { DocLayout, DocToc, EmptyState, ErrorState, PageHeader, Spinner, useDocHeadings } from '@/ds';
import { useVisibleProjects } from '@/features/access';
import { formatDateTime, useT } from '@/i18n';
import { DocsSidebarBody, ProjectSwitch } from './docs-nav';
import { defaultDocPath } from './docs-paths';
import { DocsReader } from './docs-reader';

export function DocsPage() {
  const { t, lang } = useT('docs');
  const { company } = useCompany();
  const { pathname, hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const body = useRef<HTMLDivElement>(null);

  const visible = useVisibleProjects();
  const projects = useQuery({
    queryKey: queryKeys.crew('crew.docs.projects', { companyId: company.id }),
    queryFn: () => api.crew.docsProjects(company.id),
    select: (list) => list.filter((p) => visible.canSeeProject(p.projectId)),
  });
  const names = useQuery({
    queryKey: queryKeys.projects(company.id),
    queryFn: () => api.projects.list(company.id),
    select: visible.filterProjects,
  });
  // `?project=` lạ (đã gỡ, không được xem) thì về project đầu tiên.
  const wanted = params.get('project');
  const projectId =
    projects.data?.find((p) => p.projectId === wanted)?.projectId ?? projects.data?.[0]?.projectId ?? null;

  const tree = useQuery({
    queryKey: queryKeys.crew('crew.docs.tree', { companyId: company.id, projectId }),
    queryFn: () => api.crew.docsTree(company.id, projectId as string),
    enabled: projectId !== null,
  });
  const docs = tree.data;
  const path = params.get('path') ?? (docs ? defaultDocPath(docs.pages) : null);
  const page = useQuery<DocsPageData | null>({
    queryKey: queryKeys.crew('crew.docs.page', { companyId: company.id, projectId, path }),
    queryFn: () => api.crew.docsPage(company.id, projectId as string, path as string),
    enabled: projectId !== null && path !== null,
  });
  const headings = useDocHeadings(body, page.data);

  const hrefOf = useCallback(
    (to: string) => `${pathname}?${new URLSearchParams({ project: projectId ?? '', path: to })}`,
    [pathname, projectId],
  );
  const open = useCallback(
    (to: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (projectId) next.set('project', projectId);
        next.set('path', to);
        return next;
      }),
    [setParams, projectId],
  );
  const selectProject = (id: string) => {
    setQ('');
    setParams({ project: id });
  };

  // Đổi trang khi đầu bài đã cuộn khuất (bấm link ở cuối bài dài) thì cuộn về đầu bài mới. Lần mở đầu giữ nguyên.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!page.data) return;
    const top = body.current?.parentElement;
    if (shown.current !== null && shown.current !== page.data.path && top && top.getBoundingClientRect().top < 0) {
      top.scrollIntoView?.();
    }
    shown.current = page.data.path;
  }, [page.data]);

  // Mở bằng link có `#neo`: bài dựng xong (heading có id) mới cuộn tới được.
  useEffect(() => {
    if (!hash || !headings.length) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.();
  }, [hash, headings]);

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

  const options = projects.data.map((p) => ({
    id: p.projectId,
    label: names.data?.find((n) => n.id === p.projectId)?.name ?? p.repo,
  }));
  const links = { current: path, hrefOf, onOpen: open };

  const sidebar = (
    <div className="flex min-w-0 flex-col gap-4">
      <ProjectSwitch projects={options} value={projectId} onChange={selectProject} />
      {docs ? <DocsSidebarBody projectId={projectId} docs={docs} q={q} onQuery={setQ} {...links} /> : null}
    </div>
  );

  let content: ReactNode;
  if (tree.isLoading) content = <Spinner />;
  else if (tree.error) {
    content = (
      <ErrorState
        title={t('loadFailed')}
        message={tree.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void tree.refetch()}
      />
    );
  } else if (!docs) content = <EmptyState title={t('noSnapshot')} description={t('noSnapshotHint')} />;
  else if (path === null) content = <EmptyState title={t('noPages')} description={t('noPagesHint')} />;
  else if (page.isLoading) content = <Spinner />;
  else if (page.error) {
    content = (
      <ErrorState
        title={t('loadFailed')}
        message={page.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void page.refetch()}
      />
    );
  } else if (!page.data)
    content = <EmptyState title={t('page.missing', { path })} description={t('page.missingHint')} />;
  else {
    content = (
      <DocsReader
        page={page.data}
        bodyRef={body}
        onOpen={open}
        toc={<DocToc label={t('toc')} headings={headings} variant="collapsed" />}
        meta={
          <>
            <span>{page.data.path}</span>
            <span>{t('meta', { commit: docs.commit.slice(0, 7), at: formatDateTime(docs.receivedAt, lang) })}</span>
          </>
        }
      />
    );
  }

  return (
    <>
      {header}
      <DocLayout
        nav={sidebar}
        aside={page.data && headings.length ? <DocToc label={t('toc')} headings={headings} /> : null}
      >
        {content}
      </DocLayout>
    </>
  );
}
