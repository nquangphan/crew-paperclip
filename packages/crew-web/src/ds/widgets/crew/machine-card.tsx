// crew: tự dựng
import type { CrewMachine } from '@crew/paperclip-plugin/shared/machine-card';
import { formatDateTime, useT } from '@/i18n';
import { Badge } from '../../components/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/card';

type MachineReport = CrewMachine['latest'];
type LoadPoint = CrewMachine['load24h'][number];

/** Quá ngưỡng này kể từ bản tin cuối thì coi là mất liên lạc (cùng ngưỡng với plugin). */
const OFFLINE_AFTER_MS = 180_000;

interface MachineCardProps {
  report: MachineReport;
  /** Giờ nhận bản tin mới nhất (ISO). */
  latestAt: string;
  now: Date | number;
  /** `crew.machines` → `load24h`; bỏ trống thì không vẽ biểu đồ. */
  load24h?: LoadPoint[];
}

function LoadChart({ points }: { points: LoadPoint[] }) {
  const { t } = useT();
  const known = points.filter((p): p is LoadPoint & { load1: number } => p.load1 !== null);
  if (!known.length) return null;
  const peak = Math.max(1, ...known.map((p) => p.load1));
  const coords = known
    .map((p, i) => `${(i / Math.max(1, known.length - 1)) * 100},${30 - (p.load1 / peak) * 28}`)
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 32"
      role="img"
      aria-label={t('machine.load24h', { peak })}
      className="h-20 w-full text-primary"
    >
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Thẻ một máy chạy agent: trạng thái liên lạc, tải, Claude, app 2P Crew, Superpowers, TCC và cảnh báo. */
function MachineCard({ report, latestAt, now, load24h }: MachineCardProps) {
  const { t, lang } = useT();
  const unknown = t('machine.unknown');
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const online = nowMs - Date.parse(latestAt) <= OFFLINE_AFTER_MS;
  const login =
    report.claude.loggedIn === null ? unknown : report.claude.loggedIn ? t('machine.loggedIn') : t('machine.loggedOut');
  const appLine = report.app
    ? t('machine.app', {
        version: report.app.version,
        sshd: t(`machine.sshd.${report.app.sshdOwner}`),
        update: t(`machine.update.${report.app.updateState}`, { defaultValue: unknown }),
      })
    : t('machine.cli');
  const alerts = report.checks.filter((c) => c.status !== 'ok');
  return (
    <Card data-slot="machine-card" data-online={online}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>{report.hostname}</span>
          <Badge variant={online ? 'default' : 'destructive'}>
            {online ? t('machine.online') : t('machine.offline')}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">{t('machine.lastSeen', { time: formatDateTime(latestAt, lang) })}</p>
        <p>
          {t('machine.load', {
            load: report.load1 ?? unknown,
            cpu: report.cpuCount ?? unknown,
            mem: report.memFreePct === null ? unknown : `${report.memFreePct}%`,
          })}
        </p>
        {load24h ? <LoadChart points={load24h} /> : null}
        {report.tccPending.length ? (
          <div role="alert" className="rounded-md border border-destructive/40 p-2">
            <strong>{t('machine.tccTitle')}</strong>
            <ul>
              {report.tccPending.map((item) => (
                <li key={`${item.service}:${item.client}`}>
                  {t('machine.tccItem', {
                    service: item.service,
                    client: item.client,
                    since: formatDateTime(item.since, lang),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p>
          {t('machine.claude', {
            version: report.claude.version ?? unknown,
            login,
            plan: report.claude.plan ?? unknown,
          })}
        </p>
        <p>{appLine}</p>
        <p>
          {t('machine.superpowers', {
            pinned: report.superpowers.pinned ?? unknown,
            owner: report.superpowers.ownerInstalled ?? unknown,
          })}
        </p>
        {report.checkouts ? (
          <p className="text-muted-foreground">{t('machine.checkouts', { count: report.checkouts.length })}</p>
        ) : null}
        {alerts.length ? (
          <ul>
            {alerts.map((c) => (
              <li key={c.id}>
                {t(c.status === 'error' ? 'machine.alertError' : 'machine.alertWarn', { title: c.title })}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export type { MachineCardProps };
export { MachineCard, OFFLINE_AFTER_MS };
