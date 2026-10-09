// crew: tự dựng
import { Avatar, AvatarFallback } from '../components/avatar';
import { RowLink } from './row-link';
import { StatusBadge } from './status-badge';

interface AgentRowProps {
  name: string;
  roleLabel?: string | null;
  status: string;
  href?: string;
  onOpen?: () => void;
}

function AgentRow({ name, roleLabel, status, href, onOpen }: AgentRowProps) {
  return (
    <RowLink href={href} onOpen={onOpen}>
      <span data-slot="agent-row" className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar>
          <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {roleLabel ? <span className="shrink-0 text-xs text-muted-foreground">{roleLabel}</span> : null}
        <StatusBadge status={status} />
      </span>
    </RowLink>
  );
}

export type { AgentRowProps };
export { AgentRow };
