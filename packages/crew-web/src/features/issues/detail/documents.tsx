// crew: tự dựng
import type { IssueDocumentSummary } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DetailSection,
  ErrorState,
  MarkdownView,
  MutedText,
  Skeleton,
} from '@/ds';
import { useT } from '@/i18n';

function DocumentBody({ issueId, docKey }: { issueId: string; docKey: string }) {
  const { t } = useT('issues');
  const doc = useQuery({
    queryKey: queryKeys.document(issueId, docKey),
    queryFn: () => api.documents.get(issueId, docKey),
  });
  if (doc.isLoading) return <Skeleton />;
  if (doc.error) {
    return (
      <ErrorState
        title={t('detail.documents.bodyFailed')}
        message={doc.error.message}
        onRetry={() => void doc.refetch()}
      />
    );
  }
  return <MarkdownView markdown={doc.data?.body ?? ''} />;
}

/** Tài liệu agent ghi cho issue (plan, spec): chỉ đọc (S6.14). Nội dung nạp khi mở. */
export function Documents({ issueId }: { issueId: string }) {
  const { t } = useT('issues');
  const list = useQuery({ queryKey: queryKeys.documents(issueId), queryFn: () => api.documents.list(issueId) });
  return (
    <DetailSection title={t('detail.documents.heading')} count={list.data?.length}>
      {list.isLoading ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState
          title={t('detail.documents.loadFailed')}
          message={list.error.message}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {list.data?.length === 0 ? <MutedText>{t('detail.documents.empty')}</MutedText> : null}
      {(list.data ?? []).map((doc: IssueDocumentSummary) => (
        <Collapsible key={doc.id} id={`document-${doc.key}`}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm">
              {doc.title ?? doc.key} · {doc.key}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <DocumentBody issueId={issueId} docKey={doc.key} />
          </CollapsibleContent>
        </Collapsible>
      ))}
    </DetailSection>
  );
}
