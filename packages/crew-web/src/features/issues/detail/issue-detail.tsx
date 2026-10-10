// crew: tự dựng
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { queryKeys } from '@/api';
import { useCompany, useMe } from '@/app/hooks';
import { NotFoundPage } from '@/app/not-found-page';
import {
  Button,
  ComposerDock,
  ErrorState,
  Identity,
  IssueDetailFrame,
  IssueHeader,
  IssueTopBar,
  ProjectTag,
  SidePanelTitle,
  Skeleton,
} from '@/ds';
import { Check, Copy, ExternalLink, X } from '@/ds/icons';
import { useT } from '@/i18n';
import { issuePageHref } from '../popup/issue-href';
import { Attachments } from './attachments';
import { Comments } from './comments';
import { Composer } from './composer';
import { ActionsSlot } from './crew/actions-slot';
import { InteractionsSlot } from './crew/interactions-slot';
import { SummarySlot } from './crew/summary-slot';
import { Documents } from './documents';
import { IssueRuns } from './issue-runs';
import { PropertiesPanel } from './properties-panel';
import { DescriptionEditor, TitleEditor } from './title-editor';
import { useAgentNames, useChildIssues, useIssue, useMarkReadOnce, useProjectName } from './use-issue';

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT('issues');
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <Button variant="ghost" size="sm" onClick={copy}>
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      {done ? t('detail.copied') : label}
    </Button>
  );
}

/** Cuộn tới neo `#comment-…`/`#document-…` (link từ Tìm kiếm) khi phần tử đã có trên trang. */
function useScrollToHash(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const timer = setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView(), 300);
    return () => clearTimeout(timer);
  }, [ready, hash]);
}

interface IssueDetailProps {
  issueRef: string | undefined;
  variant: 'page' | 'popup';
  /** Chỉ có ở popup: nút Đóng trên thanh trên cùng. */
  onClose?: () => void;
}

/**
 * Nội dung chi tiết yêu cầu, dùng chung cho trang đầy đủ và popup `?issue=` (S6.4 đến S6.6, S6.12 đến S6.16).
 * Bố cục theo trang IssueDetail của Paperclip: thanh breadcrumb, cột chính (tiêu đề, mô tả, tài liệu, đính kèm,
 * run, luồng trao đổi, ô soạn cố định đáy) và cột Thuộc tính bên phải. Phần Crew gắn qua ba khe trong ./crew:
 * tóm tắt/map/docs dưới tiêu đề, nút cổng cạnh tiêu đề, thẻ câu hỏi trên ô soạn.
 *
 * Yêu cầu thuộc company khác prefix trên URL thì chuyển sang trang đầy đủ ở prefix đúng (hoặc 404 nếu không có
 * quyền company đó), không hiện ở company sai: sự kiện trực tiếp, danh sách con và thao tác cổng đều theo company
 * của trang.
 */
export function IssueDetail({ issueRef, variant, onClose }: IssueDetailProps) {
  const { t } = useT('issues');
  const { company, companies } = useCompany();
  const me = useMe();
  const qc = useQueryClient();
  const issueQuery = useIssue(issueRef);
  const loaded = issueQuery.data;
  const issue = loaded && loaded.companyId === company.id ? loaded : undefined;
  const agentNames = useAgentNames(company.id);
  const projectName = useProjectName(company.id, issue?.projectId ?? null);
  const childIssues = useChildIssues(company.id, issue?.id);
  useMarkReadOnce(company.id, issue?.id);
  useScrollToHash(Boolean(issue));

  if (issueQuery.isLoading) return <Skeleton />;
  if (loaded && !issue) {
    const owner = companies.find((c) => c.id === loaded.companyId);
    if (!owner) return <NotFoundPage companyPrefix={company.issuePrefix} />;
    return <Navigate to={issuePageHref(owner.issuePrefix, loaded.identifier ?? loaded.id)} replace />;
  }
  if (issueQuery.error || !issue) {
    return (
      <ErrorState
        title={t('detail.loadFailed')}
        message={issueQuery.error?.message}
        onRetry={() => void qc.invalidateQueries({ queryKey: queryKeys.issue(issueRef ?? '') })}
      />
    );
  }

  const code = issue.identifier ?? issue.id;
  const fullPage = issuePageHref(company.issuePrefix, code);
  const statusLabel = t(`status.${issue.status}`, { ns: 'common', defaultValue: issue.status });
  const nameOf = (agentId: string | null, userId: string | null): string | null => {
    if (agentId) return agentNames[agentId] ?? t('detail.comments.agent');
    if (userId) return userId === me.id ? t('detail.comments.you') : t('detail.props.owner');
    return null;
  };
  const assignee = nameOf(issue.assigneeAgentId, issue.assigneeUserId);
  const creator = nameOf(issue.createdByAgentId ?? null, issue.createdByUserId ?? null);

  const topActions: ReactNode = (
    <>
      <CopyButton text={code} label={t('detail.copyId')} />
      <CopyButton text={`${window.location.origin}${fullPage}`} label={t('detail.copyLink')} />
      {variant === 'popup' ? (
        <>
          <Button variant="ghost" size="sm" asChild>
            <Link to={fullPage}>
              <ExternalLink aria-hidden />
              {t('detail.openFull')}
            </Link>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('detail.close')} onClick={onClose}>
            <X aria-hidden />
          </Button>
        </>
      ) : null}
    </>
  );

  return (
    <IssueDetailFrame
      variant={variant}
      topBar={
        <IssueTopBar
          root={<Link to={`/${company.issuePrefix}/issues`}>{t('detail.root')}</Link>}
          status={issue.status}
          title={issue.title}
          identifier={code}
          actions={topActions}
        />
      }
      side={
        <>
          <SidePanelTitle>{t('detail.props.heading')}</SidePanelTitle>
          <PropertiesPanel issue={issue} agentNames={agentNames} projectName={projectName} childIssues={childIssues} />
        </>
      }
    >
      <IssueHeader
        status={issue.status}
        statusLabel={statusLabel}
        title={<TitleEditor issue={issue} />}
        identifier={code}
        meta={
          projectName || assignee ? (
            <>
              {projectName ? <ProjectTag name={projectName} /> : null}
              {assignee ? <Identity name={assignee} /> : null}
            </>
          ) : null
        }
        actions={<ActionsSlot issue={issue} />}
      />
      <SummarySlot issue={issue} />
      <DescriptionEditor issue={issue} author={creator ?? undefined} />
      <Documents issueId={issue.id} />
      <Attachments issueId={issue.id} />
      <IssueRuns issueId={issue.id} agentNames={agentNames} />
      <Comments issueId={issue.id} agentNames={agentNames} />
      <InteractionsSlot issue={issue} />
      <ComposerDock>
        <Composer issue={issue} />
      </ComposerDock>
    </IssueDetailFrame>
  );
}
