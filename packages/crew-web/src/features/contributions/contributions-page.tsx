// crew: tự dựng
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, type Contribution, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
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
import { ContributionActions } from './contribution-actions';
import { ContributionBadge } from './contribution-badge';
import { contributionHref } from './contribution-popup-host';
import { useAuthorNames, useContributionPages, useContributionsSummary } from './use-contributions';

type Tab = 'pending' | 'rejected' | 'approved';
const TABS: Tab[] = ['pending', 'rejected', 'approved'];

/**
 * Trang góp ý chờ duyệt. Owner xem mọi tác giả (Chờ duyệt), khách xem mục của mình (Góp ý của tôi).
 * Mỗi tab đọc riêng theo trạng thái và theo trang (200 mục mỗi trang, nút Tải thêm), nên mục chờ cũ không bị mục đã
 * chốt đẩy ra ngoài. Số của tab Chờ duyệt lấy từ cùng nguồn với badge sidebar (`summary`, không giới hạn).
 */
export function ContributionsPage() {
  const { t } = useT('contributions');
  const { company } = useCompany();
  const { isOwner } = useCompanyAccess();
  const mode = isOwner ? 'owner' : 'mine';
  const [tab, setTab] = useState<Tab>('pending');
  const lists: Record<Tab, ReturnType<typeof useContributionPages>> = {
    pending: useContributionPages({ status: 'pending' }),
    rejected: useContributionPages({ status: 'rejected' }),
    approved: useContributionPages({ status: 'approved' }),
  };
  const pendingTotal = useContributionsSummary(company.id, true);
  const authorName = useAuthorNames();
  const projects = useQuery({ queryKey: queryKeys.projects(company.id), queryFn: () => api.projects.list(company.id) });
  const projectName = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);

  const itemsOf = (id: Tab): Contribution[] | undefined => lists[id].data?.pages.flatMap((page) => page.items);
  const list = lists[tab];
  const shown = itemsOf(tab) ?? [];
  const countOf = (id: Tab): string | null => {
    if (id === 'pending' && pendingTotal !== null) return String(pendingTotal);
    const items = itemsOf(id);
    if (!items) return null;
    return lists[id].hasNextPage ? `${items.length}+` : String(items.length);
  };
  const nothingAtAll = TABS.every((id) => itemsOf(id)?.length === 0) && (pendingTotal === null || pendingTotal === 0);

  return (
    <>
      <PageHeader title={t(`page.${mode}.title`)} description={t(`page.${mode}.description`)} />
      {nothingAtAll ? (
        <EmptyState title={t(`page.${mode}.empty`)} description={t(`page.${mode}.emptyHint`)} />
      ) : (
        <div className="flex flex-col gap-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList aria-label={t('page.tabs.label')}>
              {TABS.map((id) => {
                const count = countOf(id);
                return (
                  <TabsTrigger key={id} value={id}>
                    {count === null ? t(`page.tabs.${id}`) : `${t(`page.tabs.${id}`)} (${count})`}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          {list.error && !list.data ? (
            <ErrorState title={t('page.loadFailed')} message={list.error.message} onRetry={() => void list.refetch()} />
          ) : list.isLoading ? (
            <Skeleton />
          ) : shown.length === 0 ? (
            <EmptyState title={t(`page.tabEmpty.${tab}`)} />
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {shown.map((c) => (
                  <li key={c.id}>
                    <ContributionRow
                      contribution={c}
                      authorName={isOwner ? authorName : null}
                      projectName={c.projectId ? (projectName.get(c.projectId) ?? null) : null}
                    />
                  </li>
                ))}
              </ul>
              {list.isFetchNextPageError ? (
                <ErrorState title={t('page.loadMoreFailed')} message={list.error?.message} />
              ) : null}
              {list.hasNextPage ? (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={list.isFetchingNextPage}
                    onClick={() => void list.fetchNextPage()}
                  >
                    {list.isFetchingNextPage ? t('page.loadingMore') : t('page.loadMore')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}

function ContributionRow({
  contribution: c,
  authorName,
  projectName,
}: {
  contribution: Contribution;
  /** null: không hiện người gửi (khách xem mục của mình). */
  authorName: ((userId: string) => string | null) | null;
  projectName: string | null;
}) {
  const { t, lang } = useT('contributions');
  const location = useLocation();
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
        {c.kind === 'issue' ? (
          <strong>
            <Link to={contributionHref(c.id, location)}>{c.title ?? t('page.row.noTitle')}</Link>
          </strong>
        ) : null}
        {c.body ? <MarkdownView markdown={c.body} /> : null}
        <div className="flex flex-wrap items-center gap-4">
          {authorName ? (
            <MutedText>
              {t('page.row.author')}: {authorName(c.authorUserId) ?? c.authorUserId}
            </MutedText>
          ) : null}
          {projectName ? (
            <MutedText>
              {t('page.row.project')}: {projectName}
            </MutedText>
          ) : null}
          {issueRef && (c.kind === 'comment' || c.status === 'approved') ? (
            <IssueLink identifier={issueRef} hash={hash}>
              {linkLabel}
            </IssueLink>
          ) : null}
          <Link to={contributionHref(c.id, location)}>{t('issuesGroup.open')}</Link>
        </div>
        <ContributionActions contribution={c} />
      </CardContent>
    </Card>
  );
}
