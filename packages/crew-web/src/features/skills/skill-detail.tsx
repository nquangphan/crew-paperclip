// Chi tiết skill (S14.1, S14.3, S14.4): nội dung SKILL.md, trạng thái đồng bộ theo máy, bật/tắt cho agent.
// Giới hạn skill của agent (SEC-2) chỉ chặn agent tự sửa; người dùng board vẫn bật/tắt ở đây.
import type { Agent } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import {
  Alert,
  Badge,
  EmptyState,
  ErrorState,
  MarkdownView,
  MutedText,
  PageHeader,
  PropertyList,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleSwitch,
} from '@/ds';
import { useCrewMachines } from '@/features/machines/use-machines';
import { Section } from '@/features/settings/section';
import { useT } from '@/i18n';
import { SyncStatus } from './sync-status';
import { skillVersion } from './use-skill-sync';

const agentRef = (a: Pick<Agent, 'id' | 'urlKey'>): string => a.urlKey || a.id;

export function SkillDetail() {
  const { t } = useT('skills');
  const { company } = useCompany();
  const { skillId = '' } = useParams();
  const queryClient = useQueryClient();
  const skill = useQuery({
    queryKey: queryKeys.skill(company.id, skillId),
    queryFn: () => api.skills.get(company.id, skillId),
    enabled: skillId !== '',
  });
  const agents = useQuery({ queryKey: queryKeys.agents(company.id), queryFn: () => api.agents.list(company.id) });
  const machines = useCrewMachines(company.id);

  // Gửi cả danh sách mong muốn mới của agent (mode replace), giống tab Skills của agent.
  const toggle = useMutation({
    mutationFn: async ({ agent, on }: { agent: Agent; on: boolean }) => {
      const key = skill.data?.key;
      if (!key) throw new Error('thiếu khóa skill');
      const snapshot = await api.agents.skills(agent.id, company.id);
      const desired = on
        ? [...snapshot.desiredSkills.filter((k) => k !== key), key]
        : snapshot.desiredSkills.filter((k) => k !== key);
      return api.agents.syncSkills(agent.id, desired, 'replace', company.id);
    },
    onSettled: (_data, _error, { agent }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.skill(company.id, skillId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.skills(company.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentSkills(agent.id) });
    },
  });

  if (skill.isLoading) return <Spinner />;
  if (skill.error || !skill.data) {
    return (
      <ErrorState
        title={t('detail.loadFailed')}
        message={skill.error?.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void skill.refetch()}
      />
    );
  }
  const data = skill.data;
  const enabledFor = new Set(data.usedByAgents.filter((a) => a.desired).map((a) => a.id));
  const rows = (agents.data ?? [])
    .filter((a) => a.status !== 'terminated')
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title={data.name}
        description={data.description ?? undefined}
        breadcrumb={<Link to={companyPath(company.issuePrefix, 'skills')}>{t('detail.back')}</Link>}
      />
      <div className="flex flex-col gap-6">
        <PropertyList
          items={[
            { label: t('detail.slug'), value: data.slug },
            { label: t('detail.source'), value: data.sourceLabel ?? data.sourceLocator ?? t('detail.unknown') },
            { label: t('detail.version'), value: skillVersion(data) },
          ]}
        />
        <Section title={t('detail.sync')}>
          <SyncStatus
            skill={{ id: data.id, slug: data.slug, version: skillVersion(data) }}
            machines={machines.data ?? []}
          />
        </Section>
        <Section title={t('detail.agents')}>
          <MutedText>{t('detail.agentsHint')}</MutedText>
          {toggle.error ? (
            <Alert variant="destructive" title={t('detail.toggleFailed')}>
              {toggle.error.message}
            </Alert>
          ) : null}
          {agents.isLoading ? <Spinner /> : null}
          {agents.data && rows.length === 0 ? <EmptyState title={t('detail.noAgents')} /> : null}
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.col.agent')}</TableHead>
                  <TableHead>{t('detail.col.enabled')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <Link to={companyPath(company.issuePrefix, `agents/${agentRef(agent)}`)}>{agent.name}</Link>{' '}
                      <Badge variant="outline">{agent.adapterType}</Badge>
                    </TableCell>
                    <TableCell>
                      <ToggleSwitch
                        aria-label={agent.name}
                        checked={enabledFor.has(agent.id)}
                        disabled={toggle.isPending}
                        onCheckedChange={(on) => toggle.mutate({ agent, on })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </Section>
        <Section title={t('detail.content')}>
          <MarkdownView markdown={data.markdown} />
        </Section>
      </div>
    </>
  );
}
