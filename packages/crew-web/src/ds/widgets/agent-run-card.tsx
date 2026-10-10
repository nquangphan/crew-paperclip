// clone: ui/src/components/ActiveAgentsPanel.tsx @ v2026.1005.0
import { Clock3 } from 'lucide-react';
import { cn } from '../cn';
import { Avatar, AvatarFallback } from '../components/avatar';
import { NavAnchor } from './nav-anchor';
import { StatusGlyph } from './status-glyph';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface AgentRunCardProps {
  agentName: string;
  /** Đã dịch, ví dụ "Đang chạy". */
  statusLabel: string;
  running: boolean;
  timestamp: string;
  timestampIso: string;
  runHref: string;
  onOpenRun: () => void;
  task: { identifier: string; title: string; status: string; href: string | null; onOpen?: () => void } | null;
  /** Chữ khi run không gắn yêu cầu nào. */
  noTaskText: string;
}

/** Thẻ một run của agent: tên agent, yêu cầu đang làm, thời điểm. Run đang chạy có viền và quầng xanh. */
function AgentRunCard({
  agentName,
  statusLabel,
  running,
  timestamp,
  timestampIso,
  runHref,
  onOpenRun,
  task,
  noTaskText,
}: AgentRunCardProps) {
  return (
    <div
      data-slot="agent-run-card"
      data-testid="agent-run-card"
      data-run-status={running ? 'running' : 'other'}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border',
        running
          ? 'border-(--dashboard-run-border) bg-(--dashboard-run-background) shadow-(--shadow-extract-1)'
          : 'border-border bg-background/70',
      )}
    >
      <div className="flex shrink-0 flex-col gap-3 p-3">
        <NavAnchor
          href={runHref}
          onOpen={onOpenRun}
          title={`${agentName} — ${statusLabel} · ${timestamp}`}
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-md font-medium text-foreground hover:underline',
            FOCUS,
          )}
        >
          <Avatar size="sm" aria-hidden>
            <AvatarFallback>{agentName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="truncate text-xs">{agentName}</span>
        </NavAnchor>
        {task?.href && task.onOpen ? (
          <NavAnchor
            href={task.href}
            onOpen={task.onOpen}
            title={`${task.title} · ${task.identifier}`}
            className={cn(
              'min-w-0 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-accent',
              FOCUS,
            )}
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <StatusGlyph status={task.status} className="self-center" />
                <span className="truncate">{task.title}</span>
              </span>
              <span className="shrink-0 font-mono text-(length:--text-micro) text-muted-foreground">
                {task.identifier}
              </span>
            </span>
          </NavAnchor>
        ) : (
          <NavAnchor
            href={runHref}
            onOpen={onOpenRun}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground',
              FOCUS,
            )}
          >
            <Clock3 aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{noTaskText}</span>
          </NavAnchor>
        )}
        <time dateTime={timestampIso} className="text-right font-sans text-xs text-muted-foreground/70">
          {timestamp}
        </time>
      </div>
    </div>
  );
}

export type { AgentRunCardProps };
export { AgentRunCard };
