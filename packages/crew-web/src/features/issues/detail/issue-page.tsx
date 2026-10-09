// crew: tự dựng
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { Button, ErrorState, PageHeader, Skeleton } from '@/ds';
import { ArrowLeft, Check, Copy } from '@/ds/icons';
import { useT } from '@/i18n';
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
    <Button variant="outline" size="sm" onClick={copy}>
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      {done ? t('detail.copied') : label}
    </Button>
  );
}

/** Trang chi tiết yêu cầu, phần chung (S6.4 đến S6.6, S6.12 đến S6.16). Phần Crew gắn qua ba khe trong ./crew. */
export function IssuePage() {
  const { t } = useT('issues');
  const { ref } = useParams<{ ref: string }>();
  const { company } = useCompany();
  const qc = useQueryClient();
  const issueQuery = useIssue(ref);
  const issue = issueQuery.data;
  const agentNames = useAgentNames(company.id);
  const projectName = useProjectName(company.id, issue?.projectId ?? null);
  const childIssues = useChildIssues(company.id, issue?.id);
  useMarkReadOnce(issue?.id);

  if (issueQuery.isLoading) return <Skeleton />;
  if (issueQuery.error || !issue) {
    return (
      <ErrorState
        title={t('detail.loadFailed')}
        message={issueQuery.error?.message}
        onRetry={() => void qc.invalidateQueries({ queryKey: queryKeys.issue(ref ?? '') })}
      />
    );
  }

  const code = issue.identifier ?? issue.id;
  const link = `${window.location.origin}/${company.issuePrefix}/issues/${code}`;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={code}
        breadcrumb={
          <Link to={`/${company.issuePrefix}/issues`} className="flex items-center gap-1">
            <ArrowLeft aria-hidden />
            {t('detail.back')}
          </Link>
        }
        actions={
          <>
            <CopyButton text={code} label={t('detail.copyId')} />
            <CopyButton text={link} label={t('detail.copyLink')} />
            <ActionsSlot issue={issue} />
          </>
        }
      />
      <SummarySlot issue={issue} />
      <TitleEditor issue={issue} />
      <DescriptionEditor issue={issue} />
      <PropertiesPanel issue={issue} agentNames={agentNames} projectName={projectName} childIssues={childIssues} />
      <Documents issueId={issue.id} />
      <Attachments issueId={issue.id} />
      <IssueRuns issueId={issue.id} agentNames={agentNames} />
      <Comments issueId={issue.id} agentNames={agentNames} />
      <InteractionsSlot issue={issue} />
      <Composer issue={issue} />
    </div>
  );
}
