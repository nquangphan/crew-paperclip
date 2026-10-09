// crew: tự dựng
import type { IssueDocumentSummary } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ErrorState,
  MarkdownView,
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
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.documents.heading')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {list.isLoading ? <Skeleton /> : null}
        {list.error ? (
          <ErrorState
            title={t('detail.documents.loadFailed')}
            message={list.error.message}
            onRetry={() => void list.refetch()}
          />
        ) : null}
        {list.data?.length === 0 ? <p>{t('detail.documents.empty')}</p> : null}
        {(list.data ?? []).map((doc: IssueDocumentSummary) => (
          <Collapsible key={doc.id}>
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
      </CardContent>
    </Card>
  );
}
