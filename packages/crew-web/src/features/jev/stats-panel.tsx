// Số liệu theo 1/7/30 ngày (S24.3): số lần gọi cổng, allow/deny/escalate/lỗi, deny đã áp, p50/p95, theo nhóm và
// tóm tắt so sánh C3. Ngày tính theo giờ Việt Nam (server đã cắt ở 00:00 giờ Việt Nam).
import { useState } from 'react';
import type { JevShadowCounts } from '@/api';
import {
  EmptyState,
  ErrorState,
  MutedText,
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
import { useT } from '@/i18n';
import { useJevStats } from './use-jev';

const RANGES = [1, 7, 30] as const;

const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)} ms`);

export function StatsPanel({ companyId }: { companyId: string }) {
  const { t } = useT('jev');
  const [days, setDays] = useState<number>(7);
  const stats = useJevStats(companyId, days, true);
  const g = stats.data?.gate;
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
        <TabsList aria-label={t('stats.range')}>
          {RANGES.map((d) => (
            <TabsTrigger key={d} value={String(d)}>
              {t('stats.days', { count: d })}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {stats.isLoading ? <Spinner /> : null}
      {stats.error ? (
        <ErrorState
          title={t('stats.loadFailed')}
          message={stats.error.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void stats.refetch()}
        />
      ) : null}
      {stats.data && g ? (
        <>
          {g.calls === 0 ? (
            <EmptyState title={t('stats.empty')} description={t('stats.emptyHint')} />
          ) : (
            <>
              <Table aria-label={t('stats.totals')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('stats.col.calls')}</TableHead>
                    <TableHead>{t('stats.col.allow')}</TableHead>
                    <TableHead>{t('stats.col.deny')}</TableHead>
                    <TableHead>{t('stats.col.escalate')}</TableHead>
                    <TableHead>{t('stats.col.error')}</TableHead>
                    <TableHead>{t('stats.col.appliedDeny')}</TableHead>
                    <TableHead>{t('stats.col.p50')}</TableHead>
                    <TableHead>{t('stats.col.p95')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow data-testid="jev-totals">
                    <TableCell>{g.calls}</TableCell>
                    <TableCell>{g.allow}</TableCell>
                    <TableCell>{g.deny}</TableCell>
                    <TableCell>{g.escalate}</TableCell>
                    <TableCell>{g.error}</TableCell>
                    <TableCell>{g.appliedDeny}</TableCell>
                    <TableCell>{ms(g.p50Ms)}</TableCell>
                    <TableCell>{ms(g.p95Ms)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {g.skipped > 0 || g.droppedLines > 0 ? (
                <MutedText>{t('stats.notCalled', { skipped: g.skipped, dropped: g.droppedLines })}</MutedText>
              ) : null}
              <Table aria-label={t('stats.byCategory')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('stats.col.category')}</TableHead>
                    <TableHead>{t('stats.col.calls')}</TableHead>
                    <TableHead>{t('stats.col.deny')}</TableHead>
                    <TableHead>{t('stats.col.appliedDeny')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.byCategory.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell>{c.category}</TableCell>
                      <TableCell>{c.calls}</TableCell>
                      <TableCell>{c.deny}</TableCell>
                      <TableCell>{c.appliedDeny}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          <Table aria-label={t('stats.shadow.title')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('stats.shadow.kind')}</TableHead>
                <TableHead>{t('stats.shadow.done')}</TableHead>
                <TableHead>{t('stats.shadow.mismatch')}</TableHead>
                <TableHead>{t('stats.shadow.escalated')}</TableHead>
                <TableHead>{t('stats.shadow.error')}</TableHead>
                <TableHead>{t('stats.shadow.pending')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(['liveness', 'runtime'] as const).map((kind) => (
                <ShadowRow key={kind} label={t(`shadow.kind.${kind}`)} counts={stats.data.shadow[kind]} />
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}
    </div>
  );
}

function ShadowRow({ label, counts }: { label: string; counts: JevShadowCounts }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell>{counts.done}</TableCell>
      <TableCell>{counts.mismatch}</TableCell>
      <TableCell>{counts.escalated}</TableCell>
      <TableCell>{counts.error}</TableCell>
      <TableCell>{counts.pending}</TableCell>
    </TableRow>
  );
}
