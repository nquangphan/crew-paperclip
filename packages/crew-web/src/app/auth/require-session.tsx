// Chặn trang trong khi chưa đăng nhập: về /login?next=<trang đang mở>.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { CenteredPage, ErrorState, Spinner } from '@/ds';
import { useT } from '@/i18n';
import { MeContext, toMe, useSession } from '../hooks';

export function RequireSession() {
  const { t } = useT();
  const location = useLocation();
  const session = useSession();
  if (session.isLoading) {
    return (
      <CenteredPage>
        <Spinner label={t('session.loading')} />
      </CenteredPage>
    );
  }
  if (session.error) {
    return (
      <CenteredPage>
        <ErrorState
          title={t('session.loadFailed')}
          message={session.error.message}
          retryLabel={t('action.retry')}
          onRetry={() => void session.refetch()}
        />
      </CenteredPage>
    );
  }
  if (!session.data) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return (
    <MeContext.Provider value={toMe(session.data)}>
      <Outlet />
    </MeContext.Provider>
  );
}
