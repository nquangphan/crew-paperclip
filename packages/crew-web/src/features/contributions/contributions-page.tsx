// crew: tự dựng
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Contribution, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  MarkdownView,
  MutedText,
  PageHeader,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { IssueLink } from '@/features/issues/popup/issue-nav';
import { formatDateTime, useT } from '@/i18n';
import { ContributionBadge } from './contribution-badge';
import { useAuthorNames, useContributions } from './use-contributions';

type Tab = 'pending' | 'rejected' | 'approved';
const TABS: Tab[] = ['pending', 'rejected', 'approved'];

/** Mục thuộc tab nào: `approving` (duyệt dở) vẫn là chờ duyệt. */
export const tabOf = (c: Contribution): Tab =>
  c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending';

/** Trang góp ý chờ duyệt. Owner xem mọi tác giả (Chờ duyệt), khách xem mục của mình (Góp ý của tôi). */
export function ContributionsPage() {
  const { t } = useT('contributions');
  const { isOwner } = useCompanyAccess();
  const mode = isOwner ? 'owner' : 'mine';
  const [tab, setTab] = useState<Tab>('pending');
  const list = useContributions();
  const items = list.data ?? [];
  const shown = items.filter((c) => tabOf(c) === tab);

  return (
    <>
      <PageHeader title={t(`page.${mode}.title`)} description={t(`page.${mode}.description`)} />
      {list.error ? (
        <ErrorState title={t('page.loadFailed')} message={list.error.message} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <EmptyState title={t(`page.${mode}.empty`)} description={t(`page.${mode}.emptyHint`)} />
      ) : (
        <div className="flex flex-col gap-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList aria-label={t('page.tabs.label')}>
              {TABS.map((id) => (
                <TabsTrigger key={id} value={id}>
                  {t(`page.tabs.${id}`)} ({items.filter((c) => tabOf(c) === id).length})
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {shown.length === 0 ? (
            <EmptyState title={t(`page.tabEmpty.${tab}`)} />
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((c) => (
                <li key={c.id}>
                  <ContributionRow contribution={c} showAuthor={isOwner} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function ContributionRow({ contribution: c, showAuthor }: { contribution: Contribution; showAuthor: boolean }) {
  const { t, lang } = useT('contributions');
  const { company } = useCompany();
  const authorName = useAuthorNames();
  const projects = useQuery({ queryKey: queryKeys.projects(company.id), queryFn: () => api.projects.list(company.id) });
  const project = c.projectId ? projects.data?.find((p) => p.id === c.projectId) : undefined;
  const issueRef = c.kind === 'issue' ? c.resultIssueId : c.targetIssueId;
  const linkLabel =
    c.status !== 'approved'
      ? t('page.row.openIssue')
      : c.kind === 'issue'
        ? t('page.row.openResultIssue')
        : t('page.row.openResultComment');
  const hash = c.kind === 'comment' && c.resultCommentId ? `#comment-${c.resultCommentId}` : '';

  return (
    <Card data-testid="contribution-row" data-status={c.status}>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <MutedText>{t(`page.kind.${c.kind}`)}</MutedText>
            <ContributionBadge status={c.status} />
          </div>
          <MutedText>
            <time dateTime={c.createdAt}>{formatDateTime(c.createdAt, lang)}</time>
          </MutedText>
        </div>
        {c.kind === 'issue' ? <strong>{c.title ?? t('page.row.noTitle')}</strong> : null}
        {c.body ? <MarkdownView markdown={c.body} /> : null}
        <div className="flex flex-wrap items-center gap-4">
          {showAuthor ? (
            <MutedText>
              {t('page.row.author')}: {authorName(c.authorUserId) ?? c.authorUserId}
            </MutedText>
          ) : null}
          {project ? (
            <MutedText>
              {t('page.row.project')}: {project.name}
            </MutedText>
          ) : null}
          {issueRef && (c.kind === 'comment' || c.status === 'approved') ? (
            <IssueLink identifier={issueRef} hash={hash}>
              {linkLabel}
            </IssueLink>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
