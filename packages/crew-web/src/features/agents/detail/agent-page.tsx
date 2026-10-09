// Chi tiết agent (S11): tab Tổng quan, Hướng dẫn, Skills, Cấu hình chạy, Run; đổi tên. Không có thao tác xóa, dừng hẳn,
// sửa quyền hay khóa API (SEC-2 tắt quyền tạo agent/skill, UI không bật lại).
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
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/ds';
import { ArrowLeft, Pencil } from '@/ds/icons';
import { useProjectReadiness } from '@/features/readiness';
import { useT } from '@/i18n';
import { companyHref } from '../paths';
import { InstructionsTab } from './instructions-tab';
import { OverviewTab } from './overview-tab';
import { RenameDialog } from './rename-dialog';
import { RunsTab } from './runs-tab';
import { RuntimeTab } from './runtime-tab';
import { SkillsTab } from './skills-tab';

const TABS = ['overview', 'instructions', 'skills', 'runtime', 'runs'] as const;
type Tab = (typeof TABS)[number];

export function AgentPage() {
  const { t } = useT('agents');
  const { company } = useCompany();
  const { agentRef = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [renaming, setRenaming] = useState(false);
  const queryClient = useQueryClient();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((x) => x === requested) ?? 'overview';

  const agent = useQuery({
    queryKey: queryKeys.agent(agentRef),
    queryFn: () => api.agents.get(agentRef, company.id),
  });
  const readiness = useProjectReadiness(company.id, api);

  if (agent.isLoading) return <Spinner />;
  if (agent.error || !agent.data) {
    return (
      <ErrorState
        title={t('detail.loadFailed')}
        message={agent.error?.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void agent.refetch()}
      />
    );
  }
  const data = agent.data;
  const entry = readiness.data?.flatMap((p) => p.agents).find((a) => a.agentId === data.id) ?? null;
  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={data.name}
        description={data.title ?? undefined}
        breadcrumb={
          <Button asChild variant="ghost" size="sm" className="self-start">
            <Link to={companyHref(company.issuePrefix, 'agents')}>
              <ArrowLeft aria-hidden />
              {t('list.title')}
            </Link>
          </Button>
        }
        actions={
          <>
            <StatusBadge status={data.status} />
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
        <TabsContent value="overview">
          <OverviewTab agent={data} readiness={entry} />
        </TabsContent>
        <TabsContent value="instructions">
          <InstructionsTab agent={data} companyId={company.id} />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsTab agent={data} companyId={company.id} />
        </TabsContent>
        <TabsContent value="runtime">
          <RuntimeTab agent={data} companyId={company.id} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab agent={data} />
        </TabsContent>
      </Tabs>
      {renaming ? (
        <RenameDialog
          open
          onOpenChange={setRenaming}
          agent={data}
          companyId={company.id}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.agent(agentRef) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.agents(company.id) });
          }}
        />
      ) : null}
    </div>
  );
}
