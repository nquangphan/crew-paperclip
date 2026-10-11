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
import { useInvites, useMemberActions, usePendingJoins } from './use-members';

/** Yêu cầu tham gia chờ duyệt. Lời mời khách góp ý được gắn nhãn và duyệt xong thì bật dấu ngay. */
export function JoinRequestsSection() {
  const { t, lang } = useT('members');
  const invites = useInvites();
  const requests = usePendingJoins(invites.all);
  const { approve, reject } = useMemberActions();
  const markError = approve.data?.markError;

  // Không có yêu cầu nào thì ẩn cả mục, trang đã đủ dày.
  if (!requests.isLoading && !requests.error && requests.joins.length === 0 && !markError && !approve.error)
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
      {requests.error ? (
        <ErrorState
          title={t('requests.loadFailed')}
          message={requests.error.message}
          onRetry={() => void requests.refetch()}
        />
      ) : requests.isLoading ? (
        <Skeleton />
      ) : requests.joins.length === 0 ? (
        <MutedText>{t('requests.empty')}</MutedText>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('requests.person')}</TableHead>
              <TableHead>{t('requests.kind')}</TableHead>
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
                    ) : (
                      t('requests.plainInvite')
                    )}
                  </TableCell>
                  <TableCell>{formatDateTime(join.request.createdAt, lang)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
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
