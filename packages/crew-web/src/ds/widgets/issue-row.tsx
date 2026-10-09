// crew: tự dựng
import type * as React from 'react';
import { RowLink } from './row-link';
import { StatusBadge } from './status-badge';

interface IssueRowProps {
  identifier: string;
  title: string;
  status: string;
  /** Giai đoạn, cột phụ (ví dụ `<StageBadge/>`). */
  stage?: React.ReactNode;
  assignee?: string | null;
  /** Số cấp lồng (yêu cầu con). */
  depth?: number;
  href?: string;
  onOpen?: () => void;
}

function IssueRow({ identifier, title, status, stage, assignee, depth = 0, href, onOpen }: IssueRowProps) {
  return (
    <RowLink href={href} onOpen={onOpen}>
      <span data-slot="issue-row" data-depth={depth} className="flex min-w-0 flex-1 items-center gap-3">
        {depth > 0 ? (
          <span aria-hidden className="shrink-0 text-muted-foreground">
            {'└'.padStart(depth, ' ')}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{identifier}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {stage}
        {assignee ? <span className="shrink-0 text-xs text-muted-foreground">{assignee}</span> : null}
        <StatusBadge status={status} />
      </span>
    </RowLink>
  );
}

export type { IssueRowProps };
export { IssueRow };
