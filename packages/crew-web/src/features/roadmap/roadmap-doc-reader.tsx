// Popup đọc một trang docs trên Roadmap: dùng lại bài đọc của trang Docs (markdown, link nội bộ mở trong popup), kèm
// link "Mở trong trang Docs" tới đúng trang đó.
import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { DocsPage, DocsTree } from '@/api';
import { Button, EmptyState, ErrorState, RoadmapDocPopup, Spinner } from '@/ds';
import { ExternalLink } from '@/ds/icons';
import { pageTitle } from '@/features/docs/docs-paths';
import { DocsReader } from '@/features/docs/docs-reader';
import { formatDateTime, useT } from '@/i18n';

interface RoadmapDocReaderProps {
  companyPrefix: string;
  projectId: string;
  path: string;
  page: UseQueryResult<DocsPage | null>;
  tree: DocsTree | null;
  onOpen: (path: string) => void;
  onClose: () => void;
}

export function RoadmapDocReader({
  companyPrefix,
  projectId,
  path,
  page,
  tree,
  onOpen,
  onClose,
}: RoadmapDocReaderProps) {
  const { t, lang } = useT('roadmap');
  const body = useRef<HTMLDivElement>(null);
  const docsHref = `/${encodeURIComponent(companyPrefix)}/docs?${new URLSearchParams({ project: projectId, path })}`;
  const title = page.data ? pageTitle(page.data) : path;

  let content: ReactNode;
  if (page.isLoading) content = <Spinner />;
  else if (page.error) {
    content = (
      <ErrorState
        title={t('docLoadFailed')}
        message={page.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void page.refetch()}
      />
    );
  } else if (!page.data) content = <EmptyState title={t('docMissing', { path })} />;
  else {
    content = (
      <DocsReader
        page={page.data}
        bodyRef={body}
        onOpen={onOpen}
        toc={null}
        meta={
          tree ? (
            <span>
              {t('docs:meta', { commit: tree.commit.slice(0, 7), at: formatDateTime(tree.receivedAt, lang) })}
            </span>
          ) : null
        }
      />
    );
  }

  return (
    <RoadmapDocPopup
      title={title}
      path={path}
      onClose={onClose}
      actions={
        <Button asChild variant="outline" size="xs">
          <Link to={docsHref}>
            <ExternalLink aria-hidden />
            {t('common:roadmap.doc.openInDocs')}
          </Link>
        </Button>
      }
    >
      {content}
    </RoadmapDocPopup>
  );
}
