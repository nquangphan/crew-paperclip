// crew: tự dựng
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { queryKeys } from '@/api';
import { useCompany, useMe } from '@/app/hooks';
import { NotFoundPage } from '@/app/not-found-page';
import {
  Alert,
  Button,
  ComposerDock,
  EmptyState,
  ErrorState,
  Identity,
  IssueDetailFrame,
  IssueHeader,
  IssuePopupFallbackTitle,
  IssueTopBar,
  ProjectTag,
  SidePanelTitle,
  Skeleton,
} from '@/ds';
import { ArrowLeft, Check, Copy, ExternalLink, X } from '@/ds/icons';
import { useCompanyAccess, useVisibleProjects } from '@/features/access';
import { displayStatus, QcPanel, useQcStates } from '@/features/qc';
import { useT } from '@/i18n';
import { AddChildAction } from '../new/add-child-dialog';
import { issuePageHref } from '../popup/issue-href';
import { IssueLink, useIssuePopupCanGoBack } from '../popup/issue-nav';
import { AttachmentViewerProvider } from './attachment-viewer-provider';
import { Attachments } from './attachments';
import { Comments } from './comments';
import { Composer } from './composer';
import { ActionsSlot } from './crew/actions-slot';
import { ForceDoneAction } from './crew/force-done-dialog';
import { InteractionsSlot } from './crew/interactions-slot';
import { SummarySlot } from './crew/summary-slot';
import { Documents } from './documents';
import { History } from './history';
import { forcedDoneActive } from './history-format';
import { IssueRuns } from './issue-runs';
import { PropertiesPanel } from './properties-panel';
import { DRAFT_STATUS, StartWorkButton, StartWorkNotice } from './start-work';
import { DescriptionEditor, TitleEditor } from './title-editor';
import {
  useAgentNames,
  useChildIssues,
  useIssue,
  useIssueActivity,
  useMarkReadOnce,
  useProjectName,
} from './use-issue';

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
 * run, ô soạn rồi luồng trao đổi mới nhất trước) và cột Thuộc tính bên phải (thuộc tính, Lịch sử). Phần Crew gắn qua
 * các khe trong ./crew: tóm tắt/map/docs dưới tiêu đề, nút cổng và Ép Done cạnh tiêu đề, thẻ câu hỏi trên ô soạn.
 *
 * Yêu cầu thuộc company khác prefix trên URL thì chuyển sang trang đầy đủ ở prefix đúng (hoặc 404 nếu không có
 * quyền company đó), không hiện ở company sai: sự kiện trực tiếp, danh sách con và thao tác cổng đều theo company
 * của trang.
 */
export function IssueDetail({ issueRef, variant, onClose }: IssueDetailProps) {
  const { t } = useT('issues');
  const { company, companies } = useCompany();
  const me = useMe();
  const { readOnly, isContributor } = useCompanyAccess();
  const qc = useQueryClient();
  const issueQuery = useIssue(issueRef);
  const loaded = issueQuery.data;
  const visible = useVisibleProjects();
  const sameCompany = loaded && loaded.companyId === company.id ? loaded : undefined;
  // Yêu cầu của project người xem không được cấp: không hiện gì ngoài thông báo, không đánh dấu đã đọc.
  const issue = sameCompany && visible.canSeeIssue(sameCompany) ? sameCompany : undefined;
  const agentNames = useAgentNames(company.id);
  const projectName = useProjectName(company.id, issue?.projectId ?? null);
  const childIssues = useChildIssues(company.id, issue?.id);
  const activity = useIssueActivity(issue?.id);
  // Viewer không đánh dấu đã đọc được (server trả 403), nên bỏ lời gọi.
  useMarkReadOnce(company.id, readOnly ? undefined : issue?.id);
  useScrollToHash(Boolean(issue));
  const navigate = useNavigate();
  const canGoBack = useIssuePopupCanGoBack();
  const qcStates = useQcStates().byIssue;

  // Chưa có tiêu đề để làm tên hộp thoại thì popup tạm lấy mã yêu cầu; khi có, h1 của TitleEditor là DialogTitle.
  const untitled = (node: ReactNode): ReactNode =>
    variant === 'popup' ? (
      <>
        <IssuePopupFallbackTitle>{issueRef}</IssuePopupFallbackTitle>
        {node}
      </>
    ) : (
      node
    );
  if (issueQuery.isLoading || (sameCompany && !visible.ready)) return untitled(<Skeleton />);
  if (sameCompany && !issue) {
    return untitled(<EmptyState title={t('common:access.noIssue')} description={t('common:access.noAccessHint')} />);
  }
  if (loaded && !issue) {
    const owner = companies.find((c) => c.id === loaded.companyId);
    if (!owner) return untitled(<NotFoundPage companyPrefix={company.issuePrefix} />);
    return <Navigate to={issuePageHref(owner.issuePrefix, loaded.identifier ?? loaded.id)} replace />;
  }
  if (issueQuery.error || !issue) {
    return untitled(
      <ErrorState
        title={t('detail.loadFailed')}
        message={issueQuery.error?.message}
        onRetry={() => void qc.invalidateQueries({ queryKey: queryKeys.issue(issueRef ?? '') })}
      />,
    );
  }

  const code = issue.identifier ?? issue.id;
  const fullPage = issuePageHref(company.issuePrefix, code);
  // Yêu cầu của Phòng QC đã Xong: trạng thái QC (Chờ QC duyệt, QC verified) thay cho Hoàn thành.
  const shownStatus = displayStatus(issue, qcStates);
  const statusLabel = t(`status.${shownStatus}`, { ns: 'common', defaultValue: shownStatus });
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
          {canGoBack ? (
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft aria-hidden />
              {t('detail.back')}
            </Button>
          ) : null}
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
    <AttachmentViewerProvider issueId={issue.id}>
      <IssueDetailFrame
        variant={variant}
        topBar={
          <IssueTopBar
            root={<Link to={`/${company.issuePrefix}/issues`}>{t('detail.root')}</Link>}
            trail={[...(issue.ancestors ?? [])].reverse().map((ancestor) => (
              <span title={ancestor.title}>
                <IssueLink identifier={ancestor.identifier ?? ancestor.id}>
                  {ancestor.identifier ?? ancestor.title}
                </IssueLink>
              </span>
            ))}
            status={shownStatus}
            title={issue.title}
            identifier={code}
            actions={topActions}
          />
        }
        side={
          <>
            <SidePanelTitle>{t('detail.props.heading')}</SidePanelTitle>
            <PropertiesPanel
              issue={issue}
              agentNames={agentNames}
              projectName={projectName}
              childIssues={childIssues}
              forcedDone={forcedDoneActive(activity.data ?? [], issue.status)}
              qc={qcStates.get(issue.id) ?? null}
            />
            <History issue={issue} agentNames={agentNames} />
          </>
        }
      >
        <IssueHeader
          status={shownStatus}
          statusLabel={statusLabel}
          title={<TitleEditor issue={issue} popup={variant === 'popup'} />}
          identifier={code}
          meta={
            projectName || assignee ? (
              <>
                {projectName ? <ProjectTag name={projectName} /> : null}
                {assignee ? <Identity name={assignee} /> : null}
              </>
            ) : null
          }
          actions={
            readOnly ? undefined : (
              <div className="flex flex-wrap items-start gap-2">
                <StartWorkButton issue={issue} />
                <ActionsSlot issue={issue} />
                <AddChildAction issue={issue} />
                <ForceDoneAction issue={issue} childIssues={childIssues} />
              </div>
            )
          }
        />
        {variant === 'popup' ? <StartWorkNotice /> : null}
        <QcPanel issue={issue} />
        {issue.status === DRAFT_STATUS ? (
          <Alert title={t('startWork.draftTitle')}>
            {t(readOnly ? 'startWork.draftBodyReadOnly' : 'startWork.draftBody')}
          </Alert>
        ) : null}
        <SummarySlot issue={issue} />
        <DescriptionEditor issue={issue} author={creator ?? undefined} />
        <Documents issueId={issue.id} />
        <Attachments issueId={issue.id} />
        <IssueRuns issueId={issue.id} agentNames={agentNames} />
        <InteractionsSlot issue={issue} />
        {readOnly && !isContributor ? null : (
          <ComposerDock>
            <Composer issue={issue} />
          </ComposerDock>
        )}
        <Comments issueId={issue.id} agentNames={agentNames} />
      </IssueDetailFrame>
    </AttachmentViewerProvider>
  );
}
