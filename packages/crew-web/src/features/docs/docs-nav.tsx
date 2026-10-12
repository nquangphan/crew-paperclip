// Thanh bên trang Docs: chọn project (hộp chọn), ô tìm, cây tài liệu (hoặc kết quả tìm) và danh sách file bị bỏ do quét
// bí mật. Mọi trang là link thật `?project=…&path=…` để chép link, mở tab mới được.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type DocsTree as DocsTreeData, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  DocAppendix,
  DocPageList,
  DocTree,
  Field,
  Input,
  MutedText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@/ds';
import { useT } from '@/i18n';
import { buildDocsTree } from './docs-paths';

/** Từ khóa ngắn hơn ngưỡng này không gửi lên tìm. */
export const MIN_QUERY = 2;

interface PageLinks {
  current: string | null;
  hrefOf: (path: string) => string;
  onOpen: (path: string) => void;
}

export function ProjectSwitch({
  projects,
  value,
  onChange,
}: {
  projects: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useT('docs');
  return (
    <Field label={t('project')} htmlFor="docs-project">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="docs-project" className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function SearchResults({ projectId, query, ...links }: { projectId: string; query: string } & PageLinks) {
  const { t } = useT('docs');
  const { company } = useCompany();
  const search = useQuery({
    queryKey: queryKeys.crew('crew.docs.search', { companyId: company.id, projectId, q: query }),
    queryFn: () => api.crew.docsSearch(company.id, projectId, query),
  });
  return (
    <section aria-label={t('search.results')} className="flex flex-col gap-2">
      {search.isLoading ? <Spinner /> : null}
      {search.error ? <MutedText>{search.error.message}</MutedText> : null}
      {search.data ? <MutedText>{t('search.count', { count: search.data.length })}</MutedText> : null}
      {search.data?.length ? <DocPageList label={t('search.results')} items={search.data} {...links} /> : null}
    </section>
  );
}

/** Phần dưới hộp chọn project: chỉ có khi project đã có bản docs. */
export function DocsSidebarBody({
  projectId,
  docs,
  q,
  onQuery,
  ...links
}: {
  projectId: string;
  docs: DocsTreeData;
  q: string;
  onQuery: (q: string) => void;
} & PageLinks) {
  const { t } = useT('docs');
  const nodes = useMemo(() => buildDocsTree([...docs.pages]), [docs.pages]);
  const query = q.trim();
  return (
    <>
      <Field label={t('search.label')} htmlFor="docs-search">
        <Input
          id="docs-search"
          type="search"
          value={q}
          placeholder={t('search.placeholder')}
          onChange={(e) => onQuery(e.target.value)}
        />
      </Field>
      {query.length >= MIN_QUERY ? (
        <SearchResults projectId={projectId} query={query} {...links} />
      ) : (
        <DocTree label={t('tree')} nodes={nodes} {...links} />
      )}
      {docs.dropped.length ? (
        <DocAppendix title={t('dropped.title')} hint={t('dropped.hint')}>
          <ul className="flex flex-col gap-1">
            {docs.dropped.map((d) => (
              <li key={d.path} className="truncate">
                {d.path}
              </li>
            ))}
          </ul>
        </DocAppendix>
      ) : null}
    </>
  );
}
