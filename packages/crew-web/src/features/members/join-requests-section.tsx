// crew: tự dựng
import {
  Alert,
  Badge,
  Button,
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
import { formatDateTime, useT } from '@/i18n';
import { personName } from './members-model';
import { ProjectNames } from './project-access-cell';
import { useInvites, useMemberActions, usePendingJoins, useProjectAccess } from './use-members';

/**
 * Yêu cầu tham gia chờ duyệt. Lời mời khách góp ý được gắn nhãn; duyệt xong thì bật dấu và cấp project chọn sẵn trên
 * lời mời ngay.
 */
export function JoinRequestsSection() {
  const { t, lang } = useT('members');
  const invites = useInvites();
  const requests = usePendingJoins(invites.all);
  const { choices } = useProjectAccess();
  const { approve, reject } = useMemberActions();
  const markError = approve.data?.markError;
  const accessError = approve.data?.accessError;
  const loading = requests.isLoading || invites.isLoading;

  // Không có yêu cầu nào thì ẩn cả mục, trang đã đủ dày.
  if (!loading && !requests.error && requests.joins.length === 0 && !markError && !accessError && !approve.error)
    return null;

  return (
    <Section title={t('requests.title')}>
      {approve.error ? <ErrorState title={t('requests.approveFailed')} message={approve.error.message} /> : null}
      {reject.error ? <ErrorState title={t('requests.rejectFailed')} message={reject.error.message} /> : null}
      {markError ? (
        <Alert variant="warning" title={t('requests.markFailed')}>
          {t('requests.markFailedHint')}
        </Alert>
      ) : null}
      {accessError ? (
        <Alert variant="warning" title={t('requests.accessFailed')}>
          {t('requests.accessFailedHint')}
        </Alert>
      ) : null}
      {requests.error ? (
        <ErrorState
          title={t('requests.loadFailed')}
          message={requests.error.message}
          onRetry={() => void requests.refetch()}
        />
      ) : loading ? (
        <Skeleton />
      ) : requests.joins.length === 0 ? (
        <MutedText>{t('requests.empty')}</MutedText>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('requests.person')}</TableHead>
              <TableHead>{t('requests.kind')}</TableHead>
              <TableHead>{t('requests.projects')}</TableHead>
              <TableHead>{t('requests.createdAt')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.joins.map((join) => {
              const busy =
                (approve.isPending && approve.variables?.request.id === join.request.id) ||
                (reject.isPending && reject.variables === join.request.id);
              return (
                <TableRow key={join.request.id} data-testid="join-request-row">
                  <TableCell>
                    {personName(join.request.requesterUser, join.request.requestingUserId)}
                    {join.request.requesterUser?.email ? (
                      <MutedText>{join.request.requesterUser.email}</MutedText>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {join.contributor ? (
                      <Badge variant="outline">{t('requests.contributorInvite')}</Badge>
                    ) : join.inviteFound ? (
                      t('requests.plainInvite')
                    ) : (
                      <span className="flex flex-col gap-1">
                        <Badge variant="destructive" data-testid="join-invite-unknown">
                          {t('requests.unknownInvite')}
                        </Badge>
                        <MutedText>{t('requests.unknownInviteHint')}</MutedText>
                      </span>
                    )}
                  </TableCell>
                  <TableCell data-testid="join-request-projects">
                    <ProjectNames projectIds={join.projectIds} projects={choices} />
                  </TableCell>
                  <TableCell>{formatDateTime(join.request.createdAt, lang)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {!join.contributor && !join.inviteFound ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => approve.mutate({ ...join, contributor: true })}
                        >
                          {t('requests.approveAsContributor')}
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" disabled={busy} onClick={() => approve.mutate(join)}>
                        {t('requests.approve')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => reject.mutate(join.request.id)}
                      >
                        {t('requests.reject')}
                      </Button>
                    </div>
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
