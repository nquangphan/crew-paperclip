// crew: tự dựng
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  DialogTitle,
  ErrorState,
  IssueDetailFrame,
  IssuePopupFrame,
  MarkdownView,
  MutedText,
  PropertyList,
  SidePanelTitle,
  Skeleton,
} from '@/ds';
import { issueHref } from '@/features/issues/popup/issue-href';
import { formatDateTime, useT } from '@/i18n';
import { ContributionActions } from './contribution-actions';
import { ContributionBadge } from './contribution-badge';
import { CONTRIBUTION_PARAM } from './contribution-popup-host';
import { useAuthorNames, useContribution } from './use-contributions';

/** Popup một mục góp ý (`?contribution=<id>`): nội dung, project, người gửi, giờ gửi, trạng thái và nút của owner. */
export function ContributionPopup({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang } = useT('contributions');
  const { company } = useCompany();
  const location = useLocation();
  const item = useContribution(id);
  const authorName = useAuthorNames();
  const projects = useQuery({ queryKey: queryKeys.projects(company.id), queryFn: () => api.projects.list(company.id) });
  const c = item.data;
  const project = c?.projectId ? projects.data?.find((p) => p.id === c.projectId) : undefined;
  const heading =
    c?.kind === 'comment'
      ? t('popup.commentTitle')
      : c?.kind === 'issue'
        ? (c.title ?? t('popup.issueTitle'))
        : t('popup.title');

  // Link sang issue thay popup góp ý bằng popup issue tại chỗ, không chồng hai popup.
  const issueRef = c ? (c.kind === 'comment' ? c.targetIssueId : c.resultIssueId) : null;
  const rest = new URLSearchParams(location.search);
  rest.delete(CONTRIBUTION_PARAM);
  const toIssue = issueRef ? issueHref(issueRef, { pathname: location.pathname, search: rest.toString() }) : null;

  return (
    <IssuePopupFrame
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('popup.title')}
    >
      <div data-testid="contribution-popup" className="contents">
        <IssueDetailFrame
          variant="popup"
          topBar={
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>{heading}</DialogTitle>
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {t('popup.close')}
              </Button>
            </div>
          }
          side={
            c ? (
              <>
                <SidePanelTitle>{t(`page.kind.${c.kind}`)}</SidePanelTitle>
                <PropertyList
                  items={[
                    { label: t('page.row.author'), value: authorName(c.authorUserId) ?? c.authorUserId },
                    { label: t('page.row.sentAt'), value: formatDateTime(c.createdAt, lang) },
                    ...(project ? [{ label: t('page.row.project'), value: project.name }] : []),
                  ]}
                />
              </>
            ) : null
          }
        >
          {item.error ? (
            <ErrorState
              title={t('popup.loadFailed')}
              message={item.error.message}
              onRetry={() => void item.refetch()}
            />
          ) : !c ? (
            <Skeleton />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <ContributionBadge status={c.status} />
              </div>
              {c.body ? <MarkdownView markdown={c.body} /> : <MutedText>—</MutedText>}
              {toIssue ? (
                <Link to={toIssue} replace>
                  {c.kind === 'comment' ? t('popup.openTarget') : t('popup.openResult')}
                </Link>
              ) : null}
              <ContributionActions contribution={c} />
            </>
          )}
        </IssueDetailFrame>
      </div>
    </IssuePopupFrame>
  );
}
