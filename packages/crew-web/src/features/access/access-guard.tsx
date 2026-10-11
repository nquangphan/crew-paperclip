import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import { CenteredPage, ErrorState, Spinner } from '@/ds';
import { useT } from '@/i18n';
import { routeAllowed, routeNeedsAccess } from './nav-access';
import { useCompanyAccess } from './use-company-access';
import { useVisibleProjects } from './use-visible-projects';

/**
 * Route layout dưới /:companyPrefix: trang viewer/khách không được vào thì chuyển về Tổng quan (chỉ ẩn ở UI, server
 * vẫn là cổng thật). Trang phụ thuộc vai trò đợi tải xong vai trò rồi mới hiện, để không bắn request sẽ bị 403.
 * Mọi trang đợi tải xong quyền xem project, để danh sách không chớp rỗng rồi mới hiện (và không đoán khi lỗi).
 */
export function AccessGuard() {
  const { t } = useT();
  const { company } = useCompany();
  const access = useCompanyAccess();
  const visible = useVisibleProjects();
  const { pathname } = useLocation();
  const rel = pathname.split('/').filter(Boolean).slice(1);
  if (access.loading && routeNeedsAccess(rel)) {
    return (
      <CenteredPage>
        <Spinner label={t('session.loading')} />
      </CenteredPage>
    );
  }
  // Không biết vai trò thì không đoán: báo lỗi kèm Thử lại thay vì lặng lẽ chuyển về Tổng quan.
  if (access.error && routeNeedsAccess(rel)) {
    return (
      <CenteredPage>
        <ErrorState title={t('access.loadFailed')} message={access.error.message} onRetry={access.retry} />
      </CenteredPage>
    );
  }
  if (!visible.ready) {
    return (
      <CenteredPage>
        {visible.error ? (
          <ErrorState title={t('access.projectsFailed')} message={visible.error.message} onRetry={visible.retry} />
        ) : (
          <Spinner label={t('session.loading')} />
        )}
      </CenteredPage>
    );
  }
  if (!routeAllowed(rel, access)) return <Navigate to={companyPath(company.issuePrefix, 'dashboard')} replace />;
  return <Outlet />;
}
