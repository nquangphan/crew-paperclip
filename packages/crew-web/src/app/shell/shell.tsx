// Khung trong company: chọn company theo /:companyPrefix, sidebar, palette, cập nhật trực tiếp.
import { type ReactNode, useState } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { AppFrame, CenteredPage, EmptyState, ErrorState, Spinner } from '@/ds';
import { ContributionPopupHost } from '@/features/contributions/contribution-popup-host';
import { IssuePopupHost } from '@/features/issues';
import { useT } from '@/i18n';
import { CompanyContext, findCompany, useCompany, useCrewCompanies } from '../hooks';
import { LiveEventsProvider } from '../live/live-events';
import { NotFoundPage } from '../not-found-page';
import { companyPath } from '../routes-util';
import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';

function CompaniesState({ children }: { children?: ReactNode }) {
  const { t } = useT();
  const { isLoading, error, refetch } = useCrewCompanies();
  if (isLoading) {
    return (
      <CenteredPage>
        <Spinner label={t('session.loading')} />
      </CenteredPage>
    );
  }
  if (error) {
    return (
      <CenteredPage>
        <ErrorState
          title={t('company.loadFailed')}
          message={error.message}
          retryLabel={t('action.retry')}
          onRetry={refetch}
        />
      </CenteredPage>
    );
  }
  return <>{children}</>;
}

export function CompanyShell({ segments }: { segments: ReadonlySet<string> }) {
  const { companyPrefix } = useParams();
  const { companies, isLoading, error } = useCrewCompanies();
  const [paletteOpen, setPaletteOpen] = useState(false);
  if (isLoading || error) return <CompaniesState />;
  const company = findCompany(companies, companyPrefix);
  if (!company) {
    return (
      <CenteredPage>
        <NotFoundPage />
      </CenteredPage>
    );
  }
  return (
    <CompanyContext.Provider value={{ company, companies }}>
      <LiveEventsProvider companyId={company.id}>
        <AppFrame sidebar={<Sidebar segments={segments} onOpenPalette={() => setPaletteOpen(true)} />}>
          <Outlet />
        </AppFrame>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} segments={segments} />
        <IssuePopupHost />
        <ContributionPopupHost />
      </LiveEventsProvider>
    </CompanyContext.Provider>
  );
}

/** `/`: về Tổng quan của company Crew đầu tiên. */
export function RootRedirect() {
  const { t } = useT();
  const { companies, isLoading, error } = useCrewCompanies();
  if (isLoading || error) return <CompaniesState />;
  const first = companies[0];
  if (first) return <Navigate to={companyPath(first.issuePrefix, 'dashboard')} replace />;
  return (
    <CenteredPage>
      <EmptyState title={t('company.empty')} description={t('company.emptyHint')} />
    </CenteredPage>
  );
}

/** 404 trong company (route lạ dưới /:companyPrefix). */
export function CompanyNotFound() {
  const { company } = useCompany();
  return <NotFoundPage companyPrefix={company.issuePrefix} />;
}
