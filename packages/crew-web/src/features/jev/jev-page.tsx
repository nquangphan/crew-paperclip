// Trang Jev (S24): cấu hình cổng chặn lệnh, key OpenRouter, bảng máy, số liệu, ca deny/escalate và ca lệch C3.
// Chỉ owner; người khác mở thẳng URL thì nhận câu "chỉ owner" (server cũng từ chối 403).
import { useCompany } from '@/app/hooks';
import { ErrorState, PageHeader, Section, Spinner } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useCrewMachines } from '@/features/machines/use-machines';
import { useT } from '@/i18n';
import { GateEventsTable } from './gate-events-table';
import { KeyForm } from './key-form';
import { MachinesTable } from './machines-table';
import { SettingsForm } from './settings-form';
import { ShadowTable } from './shadow-table';
import { StatsPanel } from './stats-panel';
import { useJevSettings } from './use-jev';

export function JevPage() {
  const { t } = useT('jev');
  const { company } = useCompany();
  const access = useCompanyAccess();
  const header = <PageHeader title={t('title')} description={t('description')} />;

  if (access.loading) {
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  }
  if (!access.isOwner) {
    return (
      <>
        {header}
        <ErrorState title={t('ownerOnly')} message={t('ownerOnlyHint')} />
      </>
    );
  }
  return <OwnerView companyId={company.id} header={header} />;
}

function OwnerView({ companyId, header }: { companyId: string; header: React.ReactNode }) {
  const { t } = useT('jev');
  const settings = useJevSettings(companyId, true);
  const machines = useCrewMachines(companyId);
  const hostnames = new Map((machines.data ?? []).map((m) => [m.machineId, m.hostname]));

  if (settings.isLoading) {
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  }
  if (settings.error || !settings.data) {
    return (
      <>
        {header}
        <ErrorState
          title={t('loadFailed')}
          message={settings.error?.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void settings.refetch()}
        />
      </>
    );
  }
  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        <Section title={t('section.settings')}>
          <SettingsForm companyId={companyId} settings={settings.data} />
        </Section>
        <Section title={t('section.key')}>
          <KeyForm companyId={companyId} settings={settings.data} />
        </Section>
        <Section title={t('section.machines')}>
          <MachinesTable settings={settings.data} hostnames={hostnames} />
        </Section>
        <Section title={t('section.stats')}>
          <StatsPanel companyId={companyId} />
        </Section>
        <Section title={t('section.events')}>
          <GateEventsTable companyId={companyId} hostnames={hostnames} />
        </Section>
        <Section title={t('section.shadow')}>
          <ShadowTable companyId={companyId} />
        </Section>
      </div>
    </>
  );
}
