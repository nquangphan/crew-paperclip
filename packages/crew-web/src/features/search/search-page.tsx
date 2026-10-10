// crew: tự dựng
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Badge,
  EmptyState,
  ErrorState,
  FilterBar,
  MutedText,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { IssueLink, parseIssuePath } from '@/features/issues';
import { useT } from '@/i18n';

const SCOPES = ['all', 'issues', 'comments', 'documents', 'artifacts', 'agents', 'projects'] as const;
type Scope = (typeof SCOPES)[number];
const MIN_QUERY = 2;

const asScope = (value: string | null): Scope =>
  (SCOPES as readonly string[]).includes(value ?? '') ? (value as Scope) : 'all';

/**
 * Đích của kết quả: server trả `href` dạng `/<PREFIX>/issues/<mã>#comment-…`. Chỉ nhận đường nội bộ của company
 * đang xem; còn lại về trang yêu cầu theo mã để không có link ra ngoài.
 */
function resultHref(href: string, prefix: string, fallback: string | undefined): string {
  if (href.startsWith(`/${prefix}/`) && !href.startsWith('//')) return href;
  return fallback ? `/${prefix}/issues/${fallback}` : `/${prefix}/issues`;
}

/** Kết quả trỏ tới một yêu cầu thì mở popup chi tiết (kèm neo); còn lại (agent, project...) điều hướng như cũ. */
function ResultLink({ to, prefix, children }: { to: string; prefix: string; children: ReactNode }) {
  const target = parseIssuePath(to, prefix);
  if (target) {
    return (
      <IssueLink identifier={target.identifier} hash={target.hash}>
        {children}
      </IssueLink>
    );
  }
  return <Link to={to}>{children}</Link>;
}

/** Tìm kiếm (S19): GET /companies/:c/search. Bấm kết quả mở đúng issue (kèm neo bình luận/tài liệu nếu có). */
export function SearchPage() {
  const { t } = useT('search');
  const { company } = useCompany();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const scope = asScope(params.get('scope'));
  const [text, setText] = useState(q);

  // Gõ không đẩy URL mỗi phím: chờ ngừng gõ rồi mới ghi.
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = setTimeout(
      () =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            if (text.trim()) next.set('q', text.trim());
            else next.delete('q');
            return next;
          },
          { replace: true },
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [text, q, setParams]);
  useEffect(() => setText(q), [q]);

  const enabled = q.length >= MIN_QUERY;
  const found = useQuery({
    queryKey: queryKeys.search(company.id, `${scope}:${q}`),
    queryFn: () => api.search.query(company.id, { q, scope, limit: 30 }),
    enabled,
  });

  const setScope = (value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'all') next.delete('scope');
        else next.set('scope', value);
        return next;
      },
      { replace: true },
    );

  const results = found.data?.results ?? [];
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t('title')} description={t('description')} />
      <FilterBar search={{ value: text, onChange: setText, placeholder: t('placeholder') }}>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger size="sm" aria-label={t('scope.label')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`scope.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>
      {!enabled ? <MutedText>{t('hint')}</MutedText> : null}
      {enabled && found.isLoading ? <Skeleton /> : null}
      {found.error ? (
        <ErrorState title={t('loadFailed')} message={found.error.message} onRetry={() => void found.refetch()} />
      ) : null}
      {enabled && found.data && results.length === 0 ? <EmptyState title={t('empty', { q })} /> : null}
      {results.length > 0 ? (
        <>
          <MutedText>{t('count', { count: results.length })}</MutedText>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.type')}</TableHead>
                <TableHead>{t('col.result')}</TableHead>
                <TableHead>{t('col.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={`${r.type}:${r.id}`} data-testid="search-result">
                  <TableCell>
                    <Badge variant="outline">{t(`type.${r.type}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    <ResultLink
                      to={resultHref(r.href, company.issuePrefix, r.issue?.identifier ?? r.artifact?.issueIdentifier)}
                      prefix={company.issuePrefix}
                    >
                      {r.title}
                    </ResultLink>
                    {r.snippets.length > 0
                      ? r.snippets.map((s) => (
                          <MutedText key={`${s.field}:${s.text.slice(0, 24)}`}>{`${s.label}: ${s.text}`}</MutedText>
                        ))
                      : r.snippet && <MutedText>{r.snippet}</MutedText>}
                  </TableCell>
                  <TableCell>{r.issue ? <StatusBadge status={r.issue.status} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {found.data?.hasMore ? <MutedText>{t('more')}</MutedText> : null}
        </>
      ) : null}
    </div>
  );
}
