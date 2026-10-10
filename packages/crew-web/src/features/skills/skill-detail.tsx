// Chi tiết skill (S14.1, S14.3–S14.7): nội dung SKILL.md, trạng thái đồng bộ theo máy, bật/tắt cho agent, sửa
// thông tin, sửa nội dung (skill sửa được), cập nhật/tạo bản sửa được/đổi nguồn (skill chỉ đọc), xóa skill.
// Giới hạn skill của agent chỉ chặn agent tự sửa; người dùng board vẫn làm các thao tác này ở đây.
import type { Agent, CompanySkillDetail } from '@paperclipai/shared';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, type CrewMachine, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  MarkdownView,
  MutedText,
  PageHeader,
  PropertyList,
  Section,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleSwitch,
} from '@/ds';
import { Pencil, Trash2 } from '@/ds/icons';
import { useCrewMachines } from '@/features/machines/use-machines';
import { useT } from '@/i18n';
import { DeleteSkillDialog, DeleteSkillStatus, useDeleteSkill } from './delete-skill-dialog';
import { EditSkillInfoDialog } from './edit-skill';
import type { ForkedFromState } from './fork-skill-dialog';
import { SkillFilesEditor } from './skill-files-editor';
import { SyncStatus } from './sync-status';
import { ReadOnlySkillActions } from './update-from-source';
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
  // key: sang skill khác (vd. mở bản sửa được vừa tạo) thì dựng lại trạng thái sửa/xóa.
  return (
    <SkillDetailView
      key={skill.data.id}
      data={skill.data}
      agents={agents}
      toggle={toggle}
      machines={machines.data ?? []}
    />
  );
}

interface SkillDetailViewProps {
  data: CompanySkillDetail;
  agents: UseQueryResult<Agent[]>;
  toggle: UseMutationResult<unknown, Error, { agent: Agent; on: boolean }>;
  machines: CrewMachine[];
}

function SkillDetailView({ data, agents, toggle, machines }: SkillDetailViewProps) {
  const { t } = useT('skills');
  const { company } = useCompany();
  const forkedFrom = (useLocation().state as ForkedFromState | null)?.forkedFrom;
  const [editingInfo, setEditingInfo] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const removal = useDeleteSkill(data, machines);
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
        actions={
          <>
            <Button variant="outline" onClick={() => setEditingInfo(true)}>
              <Pencil aria-hidden />
              {t('info.open')}
            </Button>
            <Button variant="destructive" disabled={removal.run.isPending} onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden />
              {t('delete.open')}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-6">
        <DeleteSkillStatus state={removal} />
        {forkedFrom && forkedFrom.id !== data.id ? (
          <Alert variant="info" title={t('fork.originalLeft')}>
            <Link to={companyPath(company.issuePrefix, `skills/${forkedFrom.id}`)}>
              {t('fork.openOriginal', { name: forkedFrom.name })}
            </Link>
          </Alert>
        ) : null}
        <PropertyList
          items={[
            { label: t('detail.slug'), value: data.slug },
            { label: t('detail.source'), value: data.sourceLabel ?? data.sourceLocator ?? t('detail.unknown') },
            { label: t('detail.version'), value: skillVersion(data) },
          ]}
        />
        <Section title={t('detail.sync')}>
          <SyncStatus skill={{ id: data.id, slug: data.slug, version: skillVersion(data) }} machines={machines} />
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
        {data.editable ? (
          <Section title={t('editor.title')}>
            <SkillFilesEditor skill={data} />
          </Section>
        ) : (
          <>
            <Section title={t('upstream.title')}>
              <Alert variant="info" title={t('detail.readOnly')}>
                {data.editableReason ?? t('detail.readOnlyHint')}
              </Alert>
              <ReadOnlySkillActions skill={data} />
            </Section>
            <Section title={t('detail.content')}>
              <MarkdownView markdown={data.markdown} />
            </Section>
          </>
        )}
      </div>
      {editingInfo ? <EditSkillInfoDialog skill={data} open onOpenChange={setEditingInfo} /> : null}
      <DeleteSkillDialog skill={data} state={removal} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
