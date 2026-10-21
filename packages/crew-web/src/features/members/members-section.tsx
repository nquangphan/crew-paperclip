// crew: tự dựng

import type { ContributorDepartment } from '@/api';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  MutedText,
  Section,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { useT } from '@/i18n';
import { CONTRIBUTOR_DEPARTMENTS, displayRole, memberErrorKey, personName } from './members-model';
import { ProjectAccessCell } from './project-access-cell';
import { useContributorDepartments, useMemberActions, useMembers, useProjectAccess } from './use-members';

const NO_MARKS: ReadonlyMap<string, ContributorDepartment> = new Map();

/**
 * Danh sách thành viên với role; viewer thuần có nút Đặt Phòng Marketing và Đặt Phòng QC, người đang ở một phòng có nút
 * Gỡ phòng đó (đổi phòng: gỡ rồi đặt phòng kia).
 * Cột "Project được xem": owner thấy tất cả, người khác chỉ thấy project được chọn ở đây (mặc định không có project nào).
 */
export function MembersSection() {
  const { t } = useT('members');
  const members = useMembers();
  const marks = useContributorDepartments();
  const { enable, disable } = useMemberActions();
  const projectAccess = useProjectAccess();
  const { save } = projectAccess;
  const actionError = enable.error ?? disable.error;
  const actionErrorKey = memberErrorKey(actionError);
  const items = members.data ?? [];

  return (
    <Section title={t('list.title')}>
      {actionError ? (
        <ErrorState title={t('list.actionFailed')} message={actionErrorKey ? t(actionErrorKey) : actionError.message} />
      ) : null}
      {members.error ? (
        <ErrorState
          title={t('list.loadFailed')}
          message={members.error.message}
          onRetry={() => void members.refetch()}
        />
      ) : members.isLoading || marks.isLoading ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('list.person')}</TableHead>
              <TableHead>{t('list.role')}</TableHead>
              <TableHead>{t('list.projects')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m) => {
              const role = displayRole(m, marks.data ?? NO_MARKS);
              const department = role === 'marketing' || role === 'qc' ? role : null;
              const busy =
                (enable.isPending && enable.variables?.userId === m.principalId) ||
                (disable.isPending && disable.variables === m.principalId);
              return (
                <TableRow key={m.id} data-testid="member-row" data-role={role}>
                  <TableCell>
                    {personName(m.user, m.principalId)}
                    {m.user?.email ? <MutedText>{m.user.email}</MutedText> : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={department ? 'secondary' : 'outline'}>{t(`role.${role}`)}</Badge>
                  </TableCell>
                  <TableCell data-testid="member-projects">
                    {m.membershipRole === 'owner' ? (
                      <Badge variant="secondary">{t('projects.all')}</Badge>
                    ) : projectAccess.access.error || projectAccess.projects.error ? (
                      <MutedText>{t('projects.loadFailed')}</MutedText>
                    ) : projectAccess.access.data ? (
                      <ProjectAccessCell
                        name={personName(m.user, m.principalId)}
                        projectIds={projectAccess.access.data.get(m.principalId)?.projectIds ?? []}
                        projects={projectAccess.choices}
                        saving={save.isPending && save.variables?.userId === m.principalId}
                        error={save.variables?.userId === m.principalId ? save.error : null}
                        onSave={(projectIds) => save.mutateAsync({ userId: m.principalId, projectIds })}
                      />
                    ) : (
                      <Skeleton />
                    )}
                  </TableCell>
                  <TableCell>
                    {role === 'viewer' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {CONTRIBUTOR_DEPARTMENTS.map((d) => (
                          <Button
                            key={d}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => enable.mutate({ userId: m.principalId, department: d })}
                          >
                            {t('list.enable', { department: t(`role.${d}`) })}
                          </Button>
                        ))}
                      </div>
                    ) : department ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => disable.mutate(m.principalId)}
                      >
                        {t('list.disable', { department: t(`role.${department}`) })}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
