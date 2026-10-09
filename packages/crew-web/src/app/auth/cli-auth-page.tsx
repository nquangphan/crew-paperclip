// S1.2: duyệt đăng nhập CLI /cli-auth/:id?token=… (app 2P Crew lấy board key). Giữ đúng body và trạng thái
// của ui/src/pages/CliAuth.tsx: hết hạn, đã hủy, đã duyệt, cần đăng nhập, cần quản trị máy chủ.
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CenteredPage,
  EmptyState,
  ErrorState,
  Logo,
  PropertyList,
  Spinner,
} from '@/ds';
import { CircleCheck, KeyRound } from '@/ds/icons';
import { formatDateTime, useT } from '@/i18n';
import { useSession } from '../hooks';

function Frame({ children }: { children: ReactNode }) {
  return (
    <CenteredPage>
      <div className="flex justify-center">
        <Logo />
      </div>
      {children}
    </CenteredPage>
  );
}

export function CliAuthPage() {
  const { t, lang } = useT();
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const challengeId = id.trim();
  const token = (params.get('token') ?? '').trim();
  const valid = challengeId.length > 0 && token.length > 0;
  const here = `/cli-auth/${encodeURIComponent(challengeId)}?token=${encodeURIComponent(token)}`;

  const session = useSession();
  const challenge = useQuery({
    queryKey: ['cli-auth', challengeId, token],
    queryFn: () => api.cliAuth.get(challengeId, token),
    enabled: valid,
    retry: false,
  });
  const approve = useMutation({
    mutationFn: () => api.cliAuth.approve(challengeId, token),
    onSuccess: () => void challenge.refetch(),
  });
  const cancel = useMutation({
    mutationFn: () => api.cliAuth.cancel(challengeId, token),
    onSuccess: () => void challenge.refetch(),
  });

  if (!valid) {
    return (
      <Frame>
        <ErrorState title={t('cliAuth.invalidUrl')} />
      </Frame>
    );
  }
  if (session.isLoading || challenge.isLoading) {
    return (
      <Frame>
        <Spinner label={t('cliAuth.loading')} />
      </Frame>
    );
  }
  if (challenge.error || !challenge.data) {
    return (
      <Frame>
        <ErrorState title={t('cliAuth.unavailable')} message={challenge.error?.message} />
      </Frame>
    );
  }

  const c = challenge.data;
  const status = approve.isSuccess ? 'approved' : cancel.isSuccess ? 'cancelled' : c.status;
  if (status === 'approved') {
    return (
      <Frame>
        <EmptyState
          icon={<CircleCheck aria-hidden />}
          title={t('cliAuth.approved')}
          description={t('cliAuth.approvedDetail')}
        />
      </Frame>
    );
  }
  if (status === 'cancelled' || status === 'expired') {
    return (
      <Frame>
        <EmptyState
          title={status === 'expired' ? t('cliAuth.expired') : t('cliAuth.cancelled')}
          description={t('cliAuth.restart')}
        />
      </Frame>
    );
  }
  if (c.requiresSignIn || !session.data) {
    return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  }

  const busy = approve.isPending || cancel.isPending;
  const error = approve.error ?? cancel.error;
  const items = [
    { label: t('cliAuth.client'), value: c.clientName ?? t('cliAuth.defaultClient') },
    { label: t('cliAuth.command'), value: c.command },
    {
      label: t('cliAuth.access'),
      value: c.requestedAccess === 'instance_admin_required' ? t('cliAuth.accessAdmin') : t('cliAuth.accessBoard'),
    },
    ...(c.requestedCompanyName ? [{ label: t('cliAuth.company'), value: c.requestedCompanyName }] : []),
    { label: t('cliAuth.expiresAt'), value: formatDateTime(c.expiresAt, lang) },
  ];

  return (
    <Frame>
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <KeyRound aria-hidden />
              {t('cliAuth.title')}
            </span>
          </CardTitle>
          <CardDescription>{t('cliAuth.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <PropertyList items={items} />
            {!c.canApprove ? <ErrorState title={t('cliAuth.needAdmin')} /> : null}
            {error ? <ErrorState title={t('cliAuth.failed')} message={error.message} /> : null}
          </div>
        </CardContent>
        <CardFooter>
          <div className="flex gap-2">
            <Button onClick={() => approve.mutate()} disabled={!c.canApprove || busy}>
              {approve.isPending ? <Spinner label={t('cliAuth.approving')} /> : null}
              {t('cliAuth.approve')}
            </Button>
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={busy}>
              {cancel.isPending ? <Spinner label={t('cliAuth.cancelling')} /> : null}
              {t('cliAuth.cancel')}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </Frame>
  );
}
