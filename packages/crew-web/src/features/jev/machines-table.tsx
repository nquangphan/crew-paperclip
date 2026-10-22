// Bảng máy (S24.3): máy nào đã nhận cấu hình hiện tại, key có khớp không, lần kéo và lần gửi sự kiện cuối.
import type { JevSettings } from '@/api';
import { Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds';
import { formatDateTime, useT } from '@/i18n';
import { MachineName } from './machine-name';

export function MachinesTable({ settings }: { settings: JevSettings }) {
  const { t, lang } = useT('jev');
  if (settings.machines.length === 0) {
    return <EmptyState title={t('machines.empty')} description={t('machines.emptyHint')} />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('machines.col.machine')}</TableHead>
          <TableHead>{t('machines.col.config')}</TableHead>
          <TableHead>{t('machines.col.key')}</TableHead>
          <TableHead>{t('machines.col.lastPull')}</TableHead>
          <TableHead>{t('machines.col.lastEvents')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {settings.machines.map((m) => {
          // Mac chưa nhận lần nào báo bản 0 (hoặc null).
          const applied = m.appliedVersion === null || m.appliedVersion === 0 ? null : m.appliedVersion;
          const current = applied === settings.version;
          return (
            <TableRow key={m.machineId}>
              <TableCell>
                <MachineName machineId={m.machineId} hostname={m.hostname} />
                {m.revoked ? <Badge variant="secondary">{t('machines.revoked')}</Badge> : null}
              </TableCell>
              <TableCell>
                <Badge variant={current ? 'default' : 'secondary'}>
                  {current
                    ? t('machines.applied', { version: settings.version })
                    : applied === null
                      ? t('machines.notApplied')
                      : t('machines.behind', { version: applied, current: settings.version })}
                </Badge>
              </TableCell>
              <TableCell>
                {!settings.hasKey ? (
                  '—'
                ) : (
                  <Badge variant={m.keyOk ? 'default' : 'secondary'}>
                    {m.keyOk ? t('machines.keyOk') : t('machines.keyMissing')}
                  </Badge>
                )}
              </TableCell>
              <TableCell>{formatDateTime(m.lastPullAt, lang)}</TableCell>
              <TableCell>{formatDateTime(m.lastEventsAt, lang)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
