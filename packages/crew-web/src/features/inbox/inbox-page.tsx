// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany, useMe } from '@/app/hooks';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  IssueRow,
  MutedText,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/ds';
import { awaitingMyApproval } from '@/features/issues/detail/crew/gate-actions';
import { useT } from '@/i18n';
import { hasPendingUserInteraction, INBOX_TAB_IDS, type InboxTabId, inboxTabs, isMyExecutionStage } from './tabs';
import { useInboxIssues } from './use-inbox-issues';

const ALL = '__all';
const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'] as const;

type Op = { kind: 'read' | 'unread' | 'archive' | 'unarchive'; ids: string[]; label?: string };

const asTab = (value: string | null): InboxTabId =>
  (INBOX_TAB_IDS as readonly string[]).includes(value ?? '') ? (value as InboxTabId) : 'awaiting_me';

/** Hộp thư (S3): 5 tab, đánh dấu đã đọc/chưa đọc/tất cả, lưu trữ (có hoàn tác), tìm/lọc/nhóm. */
export function InboxPage() {
  const { t } = useT('inbox');
  const { t: tc } = useT();
  const { company } = useCompany();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = asTab(params.get('tab'));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [group, setGroup] = useState(false);
  const [archivedNotice, setArchivedNotice] = useState<{ id: string; label: string } | null>(null);

  const list = useInboxIssues(company.id);
  const tabs = useMemo(() => inboxTabs(list.data ?? [], me), [list.data, me]);

  const mutation = useMutation({
    mutationFn: async (op: Op) => {
      const call = {
        read: api.inbox.markRead,
        unread: api.inbox.markUnread,
        archive: api.inbox.archive,
        unarchive: api.inbox.unarchive,
      }[op.kind];
      await Promise.all(op.ids.map((id) => call(id)));
    },
    onSuccess: (_data, op) => {
      setArchivedNotice(op.kind === 'archive' && op.label ? { id: op.ids[0], label: op.label } : null);
      for (const queryKey of [queryKeys.issues(company.id), queryKeys.sidebarBadges(company.id)]) {
        void qc.invalidateQueries({ queryKey });
      }
      for (const id of op.ids) void qc.invalidateQueries({ queryKey: queryKeys.issue(id) });
    },
  });

  const needle = search.trim().toLowerCase();
  const rows = tabs[tab].filter(
    (issue) =>
      (!status || issue.status === status) &&
      (!needle || `${issue.identifier ?? ''} ${issue.title}`.toLowerCase().includes(needle)),
  );
  const unreadInTab = rows.filter((issue) => issue.isUnreadForMe === true);
  const filtered = !!needle || !!status;

  const reasonOf = (issue: Issue): string | null => {
    if (tab !== 'awaiting_me') return null;
    if (awaitingMyApproval(issue, me) || isMyExecutionStage(issue, me)) return t('reason.approval');
    if (hasPendingUserInteraction(issue)) return t('reason.question');
    return t('reason.escalated');
  };

  const renderRow = (issue: Issue) => {
    const unread = issue.isUnreadForMe === true;
    const identifier = issue.identifier ?? issue.id.slice(0, 8);
    const href = `/${company.issuePrefix}/issues/${issue.identifier ?? issue.id}`;
    const reason = reasonOf(issue);
    return (
      <div key={issue.id} data-testid="inbox-row" data-unread={unread} className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <IssueRow
            identifier={identifier}
            title={issue.title}
            status={issue.status}
            stage={
              <>
                {unread ? <Badge>{t('unreadMark')}</Badge> : null}
                {reason ? <Badge variant="outline">{reason}</Badge> : null}
              </>
            }
            href={href}
            onOpen={() => navigate(href)}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ kind: unread ? 'read' : 'unread', ids: [issue.id] })}
        >
          {unread ? t('markRead') : t('markUnread')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ kind: 'archive', ids: [issue.id], label: identifier })}
        >
          {t('archive')}
        </Button>
      </div>
    );
  };

  const groups: { status: string | null; items: Issue[] }[] = group
    ? STATUSES.map((s) => ({ status: s, items: rows.filter((issue) => issue.status === s) })).filter(
        (g) => g.items.length > 0,
      )
    : [{ status: null, items: rows }];

  const body = () => {
    if (list.isLoading) return <Skeleton aria-label={tc('ui.loading')} />;
    if (list.error) {
      return <ErrorState title={t('loadFailed')} message={list.error.message} onRetry={() => void list.refetch()} />;
    }
    if (rows.length === 0) return <EmptyState title={filtered ? t('empty.filtered') : t(`empty.${tab}`)} />;
    return (
      <div className="flex flex-col">
        {groups.map((g) => (
          <Fragment key={g.status ?? 'all'}>
            {g.status ? (
              <MutedText data-testid="group-heading">
                {tc(`status.${g.status}`)} ({g.items.length})
              </MutedText>
            ) : null}
            {g.items.map(renderRow)}
          </Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          unreadInTab.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ kind: 'read', ids: unreadInTab.map((issue) => issue.id) })}
            >
              {t('markAllRead')}
            </Button>
          ) : null
        }
      />
      <nav aria-label={t('tab.label')} className="flex flex-wrap items-center gap-2">
        {INBOX_TAB_IDS.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={id === tab ? 'default' : 'outline'}
            aria-pressed={id === tab}
            onClick={() =>
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  if (id === 'awaiting_me') next.delete('tab');
                  else next.set('tab', id);
                  return next;
                },
                { replace: true },
              )
            }
          >
            {`${t(`tab.${id}`)} (${tabs[id].length})`}
          </Button>
        ))}
      </nav>
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: t('filter.search') }}>
        <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? '' : v)}>
          <SelectTrigger size="sm" aria-label={t('filter.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filter.allStatus')}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {tc(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={group ? 'status' : 'none'} onValueChange={(v) => setGroup(v === 'status')}>
          <SelectTrigger size="sm" aria-label={t('filter.group')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('filter.groupNone')}</SelectItem>
            <SelectItem value="status">{t('filter.groupStatus')}</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>
      {mutation.error ? <ErrorState title={t('actionFailed')} message={mutation.error.message} /> : null}
      {archivedNotice ? (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            {t('archived', { id: archivedNotice.label })}
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ kind: 'unarchive', ids: [archivedNotice.id] })}
            >
              {t('unarchive')}
            </Button>
          </span>
        </Alert>
      ) : null}
      {body()}
    </div>
  );
}
