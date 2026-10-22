// Bảng máy (S24.3): máy nào đã nhận cấu hình hiện tại, key có khớp không, lần kéo và lần gửi sự kiện cuối.
import type { JevSettings } from '@/api';
import { Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds';
import { formatDateTime, useT } from '@/i18n';

interface MachinesTableProps {
  settings: JevSettings;
  /** Tên máy theo machineId (từ bản tin máy); máy không có tên thì hiện mã. */
  hostnames: ReadonlyMap<string, string>;
}

export function MachinesTable({ settings, hostnames }: MachinesTableProps) {
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
          const current = m.appliedVersion === settings.version;
          return (
            <TableRow key={m.machineId}>
              <TableCell>{hostnames.get(m.machineId) ?? m.machineId}</TableCell>
              <TableCell>
                <Badge variant={current ? 'default' : 'secondary'}>
                  {current
                    ? t('machines.applied', { version: settings.version })
                    : m.appliedVersion === null
                      ? t('machines.notApplied')
                      : t('machines.behind', { version: m.appliedVersion, current: settings.version })}
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
