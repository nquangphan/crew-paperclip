// Ca lệch C3 (S24.3): chỗ nhãn của Jev khác nhãn của regex (liveness của run, hoặc lỗi runtime). Chỉ để quan sát,
// không đổi hành vi của hệ thống.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JevShadowItem } from '@/api';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import {
  Button,
  EmptyState,
  ErrorState,
  NavAnchor,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/ds';
import { formatDateTime, useT } from '@/i18n';
import { confidenceText } from './gate-events-table';
import { useShadowItems } from './use-jev';

type Kind = 'liveness' | 'runtime';

export function ShadowTable({ companyId }: { companyId: string }) {
  const { t, lang } = useT('jev');
  const { company } = useCompany();
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>('liveness');
  const shadow = useShadowItems(companyId, kind, true);
  const items: JevShadowItem[] = shadow.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList aria-label={t('shadow.kindLabel')}>
          <TabsTrigger value="liveness">{t('shadow.kind.liveness')}</TabsTrigger>
          <TabsTrigger value="runtime">{t('shadow.kind.runtime')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {shadow.isLoading ? <Spinner /> : null}
      {shadow.error ? (
        <ErrorState
          title={t('shadow.loadFailed')}
          message={shadow.error.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void shadow.refetch()}
        />
      ) : null}
      {shadow.data && items.length === 0 ? (
        <EmptyState title={t('shadow.empty')} description={t('shadow.emptyHint')} />
      ) : null}
      {items.length > 0 ? (
        <Table aria-label={t(`shadow.kind.${kind}`)}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('shadow.col.time')}</TableHead>
              <TableHead>{t('shadow.col.kind')}</TableHead>
              <TableHead>{t('shadow.col.run')}</TableHead>
              <TableHead>{t('shadow.col.regex')}</TableHead>
              <TableHead>{t('shadow.col.jev')}</TableHead>
              <TableHead>{t('shadow.col.confidence')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => {
              const href = s.runId ? companyPath(company.issuePrefix, `runs/${s.runId}`) : null;
              return (
                <TableRow key={s.id} data-testid="jev-shadow-item">
                  <TableCell>{formatDateTime(s.evaluatedAt ?? s.createdAt, lang)}</TableCell>
                  <TableCell>{t(`shadow.kind.${s.kind}`)}</TableCell>
                  <TableCell>
                    {href && s.runId ? (
                      <NavAnchor href={href} onOpen={() => navigate(href)}>
                        {s.runId.slice(0, 8)}
                      </NavAnchor>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>{s.regexLabel ?? '—'}</TableCell>
                  <TableCell>{s.jevLabel ?? '—'}</TableCell>
                  <TableCell>{confidenceText(s.confidence)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      {shadow.hasNextPage ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={shadow.isFetchingNextPage}
            onClick={() => void shadow.fetchNextPage()}
          >
            {t('more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
