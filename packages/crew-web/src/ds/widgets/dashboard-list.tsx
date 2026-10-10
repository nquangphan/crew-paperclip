// clone: ui/src/components/ActivityRow.tsx @ v2026.1005.0
import type * as React from 'react';
import { cn } from '../cn';
import { Avatar, AvatarFallback } from '../components/avatar';
import { Card } from '../components/card';
import { NavAnchor } from './nav-anchor';
import { StatusGlyph } from './status-glyph';

const ROW =
  'block min-h-12 px-4 py-3 text-sm text-inherit no-underline transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none';

/** Tiêu đề khối của Tổng quan (chữ hoa nhỏ, xám). */
function DashboardHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

/** Khung danh sách dòng: bo góc, kẻ giữa các dòng, container query cho bố cục cột. */
function DashboardList({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <Card data-testid={testId} className="@container block divide-y divide-border overflow-hidden py-0">
      {children}
    </Card>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Link phụ cuối khối ("Xem tất cả run"), chữ nhỏ và xám. */
function DashboardMoreLink({
  href,
  onOpen,
  children,
}: {
  href: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <NavAnchor
      href={href}
      onOpen={onOpen}
      className="text-xs text-muted-foreground no-underline hover:text-foreground hover:underline"
    >
      {children}
    </NavAnchor>
  );
}

interface RowNav {
  /** Trang đầy đủ (Cmd/Ctrl+click). */
  href: string | null;
  onOpen?: () => void;
}

function Row({ nav, testId, children }: { nav: RowNav; testId?: string; children: React.ReactNode }) {
  if (nav.href && nav.onOpen) {
    return (
      <NavAnchor href={nav.href} onOpen={nav.onOpen} data-testid={testId} className={cn(ROW, 'cursor-pointer')}>
        {children}
      </NavAnchor>
    );
  }
  return (
    <div data-testid={testId} className={ROW}>
      {children}
    </div>
  );
}

interface ActivityRowProps {
  actorName: string;
  verb: string;
  /** Đích là yêu cầu: hiện tiêu đề dài và mã bên phải. */
  isIssue: boolean;
  targetLabel: string | null;
  targetTitle?: string;
  time: string;
  nav: RowNav;
}

/** Một dòng hoạt động: avatar, "ai làm gì", đích, mã yêu cầu, thời gian. */
function ActivityRow({ actorName, verb, isIssue, targetLabel, targetTitle, time, nav }: ActivityRowProps) {
  return (
    <Row nav={nav} testId="activity-row">
      <div className="flex items-start gap-2 @xl:grid @xl:grid-cols-(--dashboard-activity-list-columns) @xl:items-baseline">
        <Avatar size="sm" aria-hidden className="@xl:self-center">
          <AvatarFallback>{initials(actorName)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1 @xl:contents">
          <div className="flex min-w-0 items-baseline gap-2 @xl:contents">
            <p className="flex h-6 min-w-0 flex-1 items-center gap-1.5">
              <span className="max-w-1/2 shrink-0 truncate" title={`${actorName} ${verb}`}>
                <span>{actorName}</span> <span className="text-muted-foreground">{verb}</span>
              </span>
              {isIssue ? (
                <span className="min-w-0 flex-1 truncate" title={targetTitle}>
                  {targetTitle}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate">
                  {targetLabel ? <span className="font-medium">{targetLabel}</span> : null}
                  {targetTitle ? <span className="text-muted-foreground"> — {targetTitle}</span> : null}
                </span>
              )}
            </p>
            <span className="ml-auto shrink-0 truncate text-right font-mono text-(length:--text-micro) text-muted-foreground @xl:w-(--dashboard-list-id-width)">
              {isIssue ? targetLabel : null}
            </span>
          </div>
          <div className="flex min-h-6 min-w-0 items-center @xl:contents">
            <span className="ml-auto w-(--dashboard-list-time-width) shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground">
              {time}
            </span>
          </div>
        </div>
      </div>
    </Row>
  );
}

interface TaskRowProps {
  identifier: string;
  title: string;
  status: string;
  statusLabel: string;
  assigneeName?: string | null;
  /** Thay cho người nhận khi không có (ví dụ badge giai đoạn). */
  extra?: React.ReactNode;
  time: string;
  nav: RowNav;
}

/** Một dòng yêu cầu gần đây: glyph trạng thái, tiêu đề, người nhận, mã, thời gian. */
function TaskRow({ identifier, title, status, statusLabel, assigneeName, extra, time, nav }: TaskRowProps) {
  return (
    <Row nav={nav} testId="recent-task">
      <div className="flex items-start gap-2 @xl:grid @xl:grid-cols-(--dashboard-task-list-columns) @xl:items-baseline">
        <span className="flex size-6 shrink-0 items-center justify-end @xl:self-center">
          <StatusGlyph status={status} title={statusLabel} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1 @xl:contents">
          <span className="flex min-w-0 items-baseline gap-2 @xl:contents">
            <span className="min-w-0 flex-1 truncate text-sm leading-6" title={title}>
              {title}
            </span>
            <span className="ml-auto shrink-0 truncate text-right font-mono text-(length:--text-micro) text-muted-foreground @xl:col-start-4 @xl:row-start-1 @xl:w-(--dashboard-list-id-width)">
              {identifier}
            </span>
          </span>
          <span className="flex min-h-6 min-w-0 items-center gap-2 @xl:contents">
            <span className="flex min-w-0 flex-1 items-center text-xs @xl:col-start-3 @xl:row-start-1 @xl:self-center">
              {assigneeName ? (
                <span className="flex max-w-32 min-w-0 items-center gap-1.5" title={assigneeName}>
                  <Avatar size="xs" aria-hidden>
                    <AvatarFallback>{initials(assigneeName)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{assigneeName}</span>
                </span>
              ) : (
                extra
              )}
            </span>
            <span className="ml-auto w-(--dashboard-list-time-width) shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground">
              {time}
            </span>
          </span>
        </span>
      </div>
    </Row>
  );
}

export type { ActivityRowProps, RowNav, TaskRowProps };
export { ActivityRow, DashboardHeading, DashboardList, DashboardMoreLink, TaskRow };
