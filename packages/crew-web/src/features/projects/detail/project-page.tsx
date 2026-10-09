// Chi tiết project (S8): tab Yêu cầu, Vai trò, Docs, Sẵn sàng; đổi tên. Không có thao tác xóa hay lưu trữ project.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  ErrorState,
  PageHeader,
  ReadinessBadge,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/ds';
import { ArrowLeft, Pencil } from '@/ds/icons';
import { useProjectReadiness } from '@/features/readiness';
import { useT } from '@/i18n';
import { companyHref } from '../paths';
import { DocsTab } from './docs-tab';
import { IssuesTab } from './issues-tab';
import { ReadinessTab } from './readiness-tab';
import { RenameDialog } from './rename-dialog';
import { RolesTab } from './roles-tab';

const TABS = ['issues', 'roles', 'docs', 'readiness'] as const;
type Tab = (typeof TABS)[number];

export function ProjectPage() {
  const { t } = useT('projects');
  const { company } = useCompany();
  const { projectRef = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [renaming, setRenaming] = useState(false);
  const queryClient = useQueryClient();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((x) => x === requested) ?? 'issues';

  const project = useQuery({
    queryKey: queryKeys.project(projectRef),
    queryFn: () => api.projects.get(projectRef, company.id),
  });
  const readiness = useProjectReadiness(company.id, api);

  if (project.isLoading) return <Spinner />;
  if (project.error || !project.data) {
    return (
      <ErrorState
        title={t('detail.loadFailed')}
        message={project.error?.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void project.refetch()}
      />
    );
  }
  const data = project.data;
  const entry = readiness.data?.find((p) => p.projectId === data.id);
  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={data.name}
        description={data.description ?? undefined}
        breadcrumb={
          <Button asChild variant="ghost" size="sm" className="self-start">
            <Link to={companyHref(company.issuePrefix, 'projects')}>
              <ArrowLeft aria-hidden />
              {t('list.title')}
            </Link>
          </Button>
        }
        actions={
          <>
            {entry ? <ReadinessBadge state={entry.state} failed={entry.failed} /> : null}
            <Button variant="outline" onClick={() => setRenaming(true)}>
              <Pencil aria-hidden />
              {t('detail.rename')}
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(next) => setParams({ tab: next }, { replace: true })}>
        <TabsList variant="line">
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`detail.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="issues">
          <IssuesTab projectId={data.id} />
        </TabsContent>
        <TabsContent value="roles">
          <RolesTab projectId={data.id} />
        </TabsContent>
        <TabsContent value="docs">
          <DocsTab projectId={data.id} />
        </TabsContent>
        <TabsContent value="readiness">
          <ReadinessTab projectId={data.id} />
        </TabsContent>
      </Tabs>
      {renaming ? (
        <RenameDialog
          open
          onOpenChange={setRenaming}
          project={data}
          companyId={company.id}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectRef) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects(company.id) });
          }}
        />
      ) : null}
    </div>
  );
}
