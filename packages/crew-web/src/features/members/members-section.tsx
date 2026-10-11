// crew: tự dựng
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
import { displayRole, personName } from './members-model';
import { useContributorIds, useMemberActions, useMembers } from './use-members';

/** Danh sách thành viên với role; viewer thuần có nút Bật góp ý, khách góp ý có nút Gỡ góp ý. */
export function MembersSection() {
  const { t } = useT('members');
  const members = useMembers();
  const marks = useContributorIds();
  const { enable, disable } = useMemberActions();
  const actionError = enable.error ?? disable.error;
  const items = members.data ?? [];

  return (
    <Section title={t('list.title')}>
      {actionError ? <ErrorState title={t('list.actionFailed')} message={actionError.message} /> : null}
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
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m) => {
              const role = displayRole(m, marks.data ?? new Set());
              const busy =
                (enable.isPending && enable.variables === m.principalId) ||
                (disable.isPending && disable.variables === m.principalId);
              return (
                <TableRow key={m.id} data-testid="member-row" data-role={role}>
                  <TableCell>
                    {personName(m.user, m.principalId)}
                    {m.user?.email ? <MutedText>{m.user.email}</MutedText> : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={role === 'contributor' ? 'secondary' : 'outline'}>{t(`role.${role}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    {role === 'viewer' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => enable.mutate(m.principalId)}
                      >
                        {t('list.enable')}
                      </Button>
                    ) : role === 'contributor' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => disable.mutate(m.principalId)}
                      >
                        {t('list.disable')}
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
