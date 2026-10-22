// Ca deny/escalate của cổng chặn lệnh (S24.3): giờ, máy, nhóm, lệnh đã che, confidence, đã áp hay chưa, và nút
// Đúng/Nhầm để owner gắn nhãn (bấm lại nhãn đang có thì bỏ nhãn).
import { useState } from 'react';
import type { JevGateEvent } from '@/api';
import {
  Badge,
  Button,
  CodeBlock,
  EmptyState,
  ErrorState,
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
import { Check } from '@/ds/icons';
import { formatDateTime, useT } from '@/i18n';
import { MachineName } from './machine-name';
import { useGateEvents, useLabelEvent } from './use-jev';

type Verdict = 'deny' | 'escalate' | 'error';

/** Số dòng log Mac bỏ chưa gửi, đọc từ `reason` dạng `dropped:<n>`; không đọc được thì null. */
export function droppedCount(reason: string | null): number | null {
  const n = /^dropped:(\d+)$/.exec(reason ?? '')?.[1];
  return n === undefined ? null : Number(n);
}

const KNOWN_ERROR_CODES = [
  'no_key',
  'timeout',
  'unreachable',
  'bad_response',
  'bad_event',
  'internal',
  'skipped_bg',
  'dropped',
];

export const confidenceText = (c: number | null) => (c === null ? '—' : c.toFixed(2));

export function GateEventsTable({ companyId }: { companyId: string }) {
  const { t } = useT('jev');
  const [verdict, setVerdict] = useState<Verdict>('deny');
  const events = useGateEvents(companyId, verdict, true);
  const items: JevGateEvent[] = events.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={verdict} onValueChange={(v) => setVerdict(v as Verdict)}>
        <TabsList aria-label={t('events.verdict')}>
          <TabsTrigger value="deny">{t('events.deny')}</TabsTrigger>
          <TabsTrigger value="escalate">{t('events.escalate')}</TabsTrigger>
          <TabsTrigger value="error">{t('events.error')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {events.isLoading ? <Spinner /> : null}
      {events.error ? (
        <ErrorState
          title={t('events.loadFailed')}
          message={events.error.message}
          retryLabel={t('common:action.retry')}
          onRetry={() => void events.refetch()}
        />
      ) : null}
      {events.data && items.length === 0 ? (
        <EmptyState title={t('events.empty')} description={t('events.emptyHint')} />
      ) : null}
      {items.length > 0 ? <GateEventRows companyId={companyId} items={items} caption={t(`events.${verdict}`)} /> : null}
      {events.hasNextPage ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={events.isFetchingNextPage}
            onClick={() => void events.fetchNextPage()}
          >
            {t('more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Bảng ca của cổng chặn lệnh kèm nút Đúng/Nhầm; dùng chung cho trang Jev và khối Jev trên trang issue. */
export function GateEventRows({
  companyId,
  items,
  caption,
}: {
  companyId: string;
  items: readonly JevGateEvent[];
  caption: string;
}) {
  const { t, lang } = useT('jev');
  const label = useLabelEvent(companyId);
  return (
    <>
      {label.error ? <ErrorState title={t('events.labelFailed')} message={label.error.message} /> : null}
      <Table aria-label={caption}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('events.col.time')}</TableHead>
            <TableHead>{t('events.col.machine')}</TableHead>
            <TableHead>{t('events.col.category')}</TableHead>
            <TableHead>{t('events.col.command')}</TableHead>
            <TableHead>{t('events.col.confidence')}</TableHead>
            <TableHead>{t('events.col.applied')}</TableHead>
            <TableHead>{t('events.col.label')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((e) => (
            <TableRow key={e.id} data-testid="jev-gate-event">
              <TableCell>{formatDateTime(e.occurredAt, lang)}</TableCell>
              <TableCell>
                <MachineName machineId={e.machineId} hostname={e.hostname} />
              </TableCell>
              <TableCell>
                {e.category ?? '—'}
                {e.errorCode ? (
                  <Badge variant="secondary">
                    {t(`events.errorCode.${KNOWN_ERROR_CODES.includes(e.errorCode) ? e.errorCode : 'other'}`)}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                {e.errorCode === 'dropped' ? (
                  t('events.dropped', { count: droppedCount(e.reason) ?? 0 })
                ) : (
                  <CodeBlock code={e.command ?? ''} label={t('events.col.command')} />
                )}
              </TableCell>
              <TableCell>{confidenceText(e.confidence)}</TableCell>
              <TableCell>
                <Badge variant={e.applied === 'deny' ? 'destructive' : 'secondary'}>
                  {e.applied === 'deny' ? t('events.applied') : t('events.notApplied')}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  {(['correct', 'wrong'] as const).map((l) => (
                    <Button
                      key={l}
                      size="sm"
                      variant={e.ownerLabel === l ? 'secondary' : 'outline'}
                      aria-pressed={e.ownerLabel === l}
                      disabled={label.isPending}
                      onClick={() => label.mutate({ event: e, label: l })}
                    >
                      {e.ownerLabel === l ? <Check aria-hidden /> : null}
                      {t(`events.label.${l}`)}
                    </Button>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
