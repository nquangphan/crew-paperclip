// Trang Máy (S15): thẻ từng máy chạy agent (tự làm mới 30 giây) và hàng đợi việc trên máy.
import { useCompany } from '@/app/hooks';
import { EmptyState, ErrorState, MachineCard, PageHeader, Spinner } from '@/ds';
import { useT } from '@/i18n';
import { JobsQueue } from './jobs-queue';
import { useCrewMachines, useMachineJobs } from './use-machines';

export function MachinesPage() {
  const { t } = useT('machines');
  const { company } = useCompany();
  const machines = useCrewMachines(company.id);
  const jobs = useMachineJobs(company.id);
  const header = <PageHeader title={t('title')} description={t('description')} />;

  if (machines.isLoading) {
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  }
  if (machines.error) {
    return (
      <>
        {header}
        <ErrorState
          title={t('loadFailed')}
          message={machines.error.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void machines.refetch()}
        />
      </>
    );
  }
  const list = machines.data ?? [];
  const now = Date.now();
  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        {list.length === 0 ? (
          <EmptyState title={t('empty')} description={t('emptyHint')} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {list.map((m) => (
              <MachineCard key={m.machineId} report={m.latest} latestAt={m.lastSeenAt} now={now} load24h={m.load24h} />
            ))}
          </div>
        )}
        {jobs.error ? (
          <ErrorState
            title={t('queue.loadFailed')}
            message={jobs.error.message}
            retryLabel={t('common:action.retry')}
            onRetry={() => void jobs.refetch()}
          />
        ) : (
          <JobsQueue companyId={company.id} jobs={jobs.data ?? []} machines={list} now={now} />
        )}
      </div>
    </>
  );
}
