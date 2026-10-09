// crew: tự dựng
import { formatDateTime, useT } from '@/i18n';
import { RowLink } from './row-link';
import { StatusBadge } from './status-badge';

interface RunRowProps {
  id: string;
  status: string;
  agentName?: string | null;
  startedAt?: string | null;
  href?: string;
  onOpen?: () => void;
}

function RunRow({ id, status, agentName, startedAt, href, onOpen }: RunRowProps) {
  const { t, lang } = useT();
  return (
    <RowLink href={href} onOpen={onOpen}>
      <span data-slot="run-row" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="shrink-0 font-mono text-xs">{t('run.label', { id: id.slice(0, 8) })}</span>
        {agentName ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{t('run.by', { name: agentName })}</span>
        ) : (
          <span className="flex-1" />
        )}
        <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(startedAt, lang)}</span>
        <StatusBadge status={status} />
      </span>
    </RowLink>
  );
}

export type { RunRowProps };
export { RunRow };
