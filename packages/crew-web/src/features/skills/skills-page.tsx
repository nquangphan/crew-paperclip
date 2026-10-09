// Danh sách skill company (S14.1) và nút Thêm skill (S14.2). Cột Đồng bộ tóm tắt số máy đã có skill (S14.4).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { Plus } from '@/ds/icons';
import { useCrewMachines } from '@/features/machines/use-machines';
import { useT } from '@/i18n';
import { AddSkillDialog } from './add-skill-dialog';
import { useSkillSyncStates } from './use-skill-sync';

export function SkillsPage() {
  const { t } = useT('skills');
  const { company } = useCompany();
  const [adding, setAdding] = useState(false);
  const skills = useQuery({ queryKey: queryKeys.skills(company.id), queryFn: () => api.skills.list(company.id) });
  const machines = useCrewMachines(company.id);
  const states = useSkillSyncStates(company.id);

  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t('add.open')}
        </Button>
      }
    />
  );
  const dialog = adding ? <AddSkillDialog open onOpenChange={setAdding} /> : null;

  if (skills.isLoading) {
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  }
  if (skills.error) {
    return (
      <>
        {header}
        <ErrorState
          title={t('loadFailed')}
          message={skills.error.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void skills.refetch()}
        />
        {dialog}
      </>
    );
  }
  const list = [...(skills.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const total = machines.data?.length ?? 0;
  const doneOn = (skillId: string) =>
    (states.data ?? []).filter((s) => s.skillId === skillId && s.status === 'done').length;

  return (
    <>
      {header}
      {list.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.name')}</TableHead>
              <TableHead>{t('col.source')}</TableHead>
              <TableHead>{t('col.agents')}</TableHead>
              <TableHead>{t('col.sync')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((skill) => (
              <TableRow key={skill.id}>
                <TableCell>
                  <Link to={companyPath(company.issuePrefix, `skills/${skill.id}`)}>{skill.name}</Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {skill.sourceLabel ?? t(`source.${skill.sourceBadge}`, { defaultValue: skill.sourceBadge })}
                  </Badge>
                </TableCell>
                <TableCell>{skill.attachedAgentCount}</TableCell>
                <TableCell>{t('syncSummary', { done: doneOn(skill.id), total })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {dialog}
    </>
  );
}
