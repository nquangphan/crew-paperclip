// Thông tin hệ thống, chỉ đọc (S18.3): bản server, commit đang chạy, lần sao lưu database gần nhất. Nguồn: GET /api/health.
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { ErrorState, PropertyList, Spinner } from '@/ds';
import { formatDateTime, useT } from '@/i18n';

/** Độ dài hiển thị của commit (sha đầy đủ dài 40 ký tự). */
const COMMIT_LENGTH = 12;

interface BackupInfo {
  latestBackup?: { mtime?: string } | null;
}

export function SystemInfo() {
  const { t, lang } = useT('settings');
  const health = useQuery({ queryKey: queryKeys.health, queryFn: () => api.health.get() });
  if (health.isLoading) return <Spinner />;
  if (health.error || !health.data) {
    return (
      <ErrorState
        title={t('system.loadFailed')}
        message={health.error?.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void health.refetch()}
      />
    );
  }
  const data = health.data;
  const unknown = t('system.unknown');
  const backup = (data.databaseBackup as BackupInfo | undefined)?.latestBackup?.mtime;
  return (
    <PropertyList
      items={[
        { label: t('system.version'), value: data.version ?? unknown },
        { label: t('system.commit'), value: data.commit ? data.commit.slice(0, COMMIT_LENGTH) : unknown },
        { label: t('system.backup'), value: backup ? formatDateTime(backup, lang) : unknown },
      ]}
    />
  );
}
