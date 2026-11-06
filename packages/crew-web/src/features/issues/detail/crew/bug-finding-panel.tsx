// crew: tự dựng
import type {
  BugFindingFinding,
  BugFindingRunTriage,
  BugFindingRunView,
  BugFindingView,
} from '@crew/paperclip-plugin/shared/bug-finding';
import { type ReactNode, useId, useState } from 'react';
import { useBugFinding } from '@/api';
import type { StageStripItem } from '@/ds';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  FindingMeta,
  FindingStatusBadge,
  LaneProgress,
  MonoText,
  MutedText,
  type PropertyItem,
  PropertyList,
  SectionHeading,
  SeverityBadge,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  VerdictBadge,
} from '@/ds';
import { formatDateTime, formatUsd, useT } from '@/i18n';
import { IssueLink } from '../../popup/issue-nav';

type Translate = ReturnType<typeof useT>['t'];

/** Finding còn mở cần xử lý (cùng danh sách với luật cầu nối của plugin, spec TPS-643 mục 5.5). */
const OPEN_STATUSES = new Set(['OPEN', 'STILL_PRESENT', 'REGRESSED', 'PARTIALLY_FIXED', 'UNABLE_TO_VERIFY']);
const OPEN_RUN_STATES = new Set(['requested', 'queued', 'running']);
const BROKEN_RUN_STATES = new Set(['failed', 'timeout', 'cancelled']);
const PR_NUMBER = /\/pull\/(\d+)(?:$|[/?#])/;
/** Thẻ lượt mặc định chỉ hiện chừng này finding đầu (theo thứ tự nhóm); nút "Xem thêm" mở hết. */
export const FINDINGS_COLLAPSED = 3;

export const sha12 = (sha: string) => sha.slice(0, 12);
export function prNumberOf(url: string | null | undefined): string | null {
  return url ? (PR_NUMBER.exec(url)?.[1] ?? null) : null;
}

function minutes(run: BugFindingRunView): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  return Math.max(0, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 60_000));
}

function meta(finding: BugFindingFinding): string {
  return [finding.certainty, finding.action, finding.mr_relation].filter(Boolean).join(' · ');
}

/** Ô finding: mã, tiêu đề, dòng phụ certainty · action · quan hệ; `withSeverity` thêm nhãn mức (bảng hẹp của màn duyệt). */
function FindingCell({ finding, withSeverity = false }: { finding: BugFindingFinding; withSeverity?: boolean }) {
  const extra = meta(finding);
  return (
    <TableCell>
      <span className="flex flex-col gap-1">
        <span>
          <strong>{finding.id}</strong> {finding.title}
        </span>
        {withSeverity || extra ? (
          <span className="flex flex-wrap items-center gap-2">
            {withSeverity ? <SeverityBadge severity={finding.severity} /> : null}
            {extra ? <FindingMeta>{extra}</FindingMeta> : null}
          </span>
        ) : null}
      </span>
    </TableCell>
  );
}

function Location({ finding }: { finding: BugFindingFinding }) {
  return finding.location ? <MonoText>{finding.location}</MonoText> : <span>—</span>;
}

function FindingTable({
  label,
  head,
  rows,
}: {
  label: string;
  head: string[];
  rows: { key: string; cells: ReactNode }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <SectionHeading>{label}</SectionHeading>
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            {head.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>{row.cells}</TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Cắt các nhóm theo thứ tự, tổng không quá `limit` finding (`null` là không cắt). */
function takeRows<T>(groups: T[][], limit: number | null): T[][] {
  if (limit === null) return groups;
  let left = limit;
  return groups.map((group) => {
    const shown = group.slice(0, Math.max(0, left));
    left -= shown.length;
    return shown;
  });
}

/**
 * Ba nhóm theo kế hoạch `crew-bf-triage` của Trợ Lý; finding không có trong kế hoạch vào nhóm "khác". `limit` cắt số
 * dòng hiện (nhãn bảng vẫn ghi đủ số finding của nhóm), dải số đếm ba nhóm luôn hiện.
 */
function TriageGroups({
  run,
  triage,
  limit,
}: {
  run: BugFindingRunView;
  triage: BugFindingRunTriage;
  limit: number | null;
}) {
  const { t } = useT('issues');
  const findings = run.findings ?? [];
  const byId = new Map(findings.map((f) => [f.id, f]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((f): f is BugFindingFinding => !!f);
  const fix = pick(triage.fix);
  const ask = pick(triage.ask);
  const dismiss = pick(triage.dismiss);
  const planned = new Set([...triage.fix, ...triage.ask, ...triage.dismiss]);
  const other = findings.filter((f) => !planned.has(f.id));
  const [fixRows = [], askRows = [], dismissRows = [], otherRows = []] = takeRows([fix, ask, dismiss, other], limit);
  const fixIssues = Object.values(triage.fixIssues).flat();
  const uniqueFix = [...new Map(fixIssues.map((i) => [i.id, i])).values()];
  const fixDone = uniqueFix.filter((i) => i.status === 'done').length;
  const statusLabel = (status: string) => t(`status.${status}`, { ns: 'common', defaultValue: status });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1">
          <Badge>{fix.length}</Badge>
          {t('bugFinding.group.fixShort')}
        </span>
        <span className="flex items-center gap-1">
          <Badge variant="secondary">{ask.length}</Badge>
          {t('bugFinding.group.askShort')}
        </span>
        <span className="flex items-center gap-1">
          <Badge variant="outline">{dismiss.length}</Badge>
          {t('bugFinding.group.dismissShort')}
        </span>
        {uniqueFix.length ? (
          <MutedText>
            {t('bugFinding.batchProgress', { batch: triage.batch, done: fixDone, total: uniqueFix.length })}
          </MutedText>
        ) : null}
      </div>
      {fixRows.length ? (
        <FindingTable
          label={t('bugFinding.group.fix', { count: fix.length })}
          head={[
            t('bugFinding.col.finding'),
            t('bugFinding.col.severity'),
            t('bugFinding.col.location'),
            t('bugFinding.col.fixIssue'),
            t('bugFinding.col.status'),
          ]}
          rows={fixRows.map((f) => {
            const issues = triage.fixIssues[f.id] ?? [];
            return {
              key: f.id,
              cells: (
                <>
                  <FindingCell finding={f} />
                  <TableCell>
                    <SeverityBadge severity={f.severity} />
                  </TableCell>
                  <TableCell>
                    <Location finding={f} />
                  </TableCell>
                  <TableCell>
                    {issues.length ? (
                      <span className="flex flex-col gap-1">
                        {issues.map((i) => (
                          <IssueLink key={i.id} identifier={i.identifier ?? i.id}>
                            {i.identifier ?? i.id}
                          </IssueLink>
                        ))}
                      </span>
                    ) : (
                      t('bugFinding.noFixIssue')
                    )}
                  </TableCell>
                  <TableCell>
                    {issues.length ? (
                      <span className="flex flex-col gap-1">
                        {issues.map((i) => (
                          <Badge key={i.id} variant={i.status === 'done' ? 'default' : 'outline'}>
                            {statusLabel(i.status)}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </>
              ),
            };
          })}
        />
      ) : null}
      {askRows.length ? (
        <div className="flex flex-col gap-1">
          <FindingTable
            label={t('bugFinding.group.ask', { count: ask.length })}
            head={[t('bugFinding.col.finding'), t('bugFinding.col.severity'), t('bugFinding.col.question')]}
            rows={askRows.map((f) => ({
              key: f.id,
              cells: (
                <>
                  <FindingCell finding={f} />
                  <TableCell>
                    <SeverityBadge severity={f.severity} />
                  </TableCell>
                  <TableCell>{f.question ?? triage.reasons[f.id] ?? '—'}</TableCell>
                </>
              ),
            }))}
          />
          <MutedText>{t('bugFinding.askHint')}</MutedText>
        </div>
      ) : null}
      {dismissRows.length ? (
        <FindingTable
          label={t('bugFinding.group.dismiss', { count: dismiss.length })}
          head={[t('bugFinding.col.finding'), t('bugFinding.col.severity'), t('bugFinding.col.reason')]}
          rows={dismissRows.map((f) => ({
            key: f.id,
            cells: (
              <>
                <FindingCell finding={f} />
                <TableCell>
                  <SeverityBadge severity={f.severity} />
                </TableCell>
                <TableCell>{triage.reasons[f.id] ?? '—'}</TableCell>
              </>
            ),
          }))}
        />
      ) : null}
      {otherRows.length ? (
        <PlainFindings label={t('bugFinding.group.other', { count: other.length })} findings={otherRows} />
      ) : null}
    </div>
  );
}

function PlainFindings({ label, findings }: { label: string; findings: BugFindingFinding[] }) {
  const { t } = useT('issues');
  return (
    <FindingTable
      label={label}
      head={[
        t('bugFinding.col.finding'),
        t('bugFinding.col.severity'),
        t('bugFinding.col.location'),
        t('bugFinding.col.status'),
      ]}
      rows={findings.map((f) => ({
        key: f.id,
        cells: (
          <>
            <FindingCell finding={f} />
            <TableCell>
              <SeverityBadge severity={f.severity} />
            </TableCell>
            <TableCell>
              <Location finding={f} />
            </TableCell>
            <TableCell>
              <FindingStatusBadge status={f.status} open={OPEN_STATUSES.has(f.status)} />
            </TableCell>
          </>
        ),
      }))}
    />
  );
}

function runLabel(t: Translate, run: BugFindingRunView): string {
  return run.approvalRound > 0
    ? t('bugFinding.runLabelRound', { round: run.approvalRound + 1, run: run.run })
    : t('bugFinding.runLabel', { run: run.run });
}

function RunCard({ run, maxRuns }: { run: BugFindingRunView; maxRuns: number }) {
  const { t, lang } = useT('issues');
  const [expanded, setExpanded] = useState(false);
  const findingsId = useId();
  const label = runLabel(t, run);
  const pr = prNumberOf(run.prUrl);
  const findings = run.findings ?? [];
  const spent = minutes(run);
  const collapsible = run.state === 'succeeded' && findings.length > FINDINGS_COLLAPSED;
  const limit = collapsible && !expanded ? FINDINGS_COLLAPSED : null;
  const costLine = [
    run.costUsd !== null ? formatUsd(run.costUsd, lang) : null,
    spent !== null ? t('bugFinding.minutes', { count: spent }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const items: PropertyItem[] = [
    {
      label: t('bugFinding.prop.pr'),
      value: (
        <Button asChild variant="link" size="sm">
          <a href={run.prUrl} target="_blank" rel="noreferrer">
            {pr ? t('bugFinding.prShort', { number: pr }) : run.prUrl}
          </a>
        </Button>
      ),
    },
    { label: t('bugFinding.prop.commit'), value: <MonoText>{sha12(run.headSha)}</MonoText> },
    {
      label: t('bugFinding.prop.run'),
      value: t('bugFinding.runOf', { run: run.run, max: maxRuns }),
    },
  ];
  if (OPEN_RUN_STATES.has(run.state)) {
    items.push({
      label: t('bugFinding.prop.progress'),
      value:
        run.lanesTotal !== null && run.lanesTotal > 0 ? (
          <LaneProgress
            done={run.lanesDone ?? 0}
            total={run.lanesTotal}
            label={t('bugFinding.progressLabel')}
            caption={t('bugFinding.lanes', { done: run.lanesDone ?? 0, total: run.lanesTotal })}
          />
        ) : (
          t('bugFinding.noProgress')
        ),
    });
    items.push({ label: t('bugFinding.prop.since'), value: formatDateTime(run.startedAt ?? run.createdAt, lang) });
  } else if (costLine) {
    items.push({ label: t('bugFinding.prop.cost'), value: costLine });
  }
  if (run.reportDocumentKey) {
    items.push({ label: t('bugFinding.prop.report'), value: <MonoText>{run.reportDocumentKey}</MonoText> });
  }
  return (
    <section aria-label={label}>
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex flex-wrap items-center gap-2">
              <span>{label}</span>
              <Badge variant="outline">{t(`bugFinding.state.${run.state}`, { defaultValue: run.state })}</Badge>
              {run.verdict ? <VerdictBadge verdict={run.verdict} /> : null}
              {run.state === 'succeeded' ? (
                <span>{t('bugFinding.findingCount', { count: findings.length })}</span>
              ) : null}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <PropertyList items={items} />
          {BROKEN_RUN_STATES.has(run.state) ? (
            <Alert variant={run.state === 'cancelled' ? 'warning' : 'destructive'} title={t('bugFinding.brokenTitle')}>
              {run.error ?? t('bugFinding.noError')}
            </Alert>
          ) : null}
          {run.state === 'skipped' ? <MutedText>{t('bugFinding.skipped')}</MutedText> : null}
          {run.state === 'succeeded' ? (
            <div id={findingsId} className="flex flex-col gap-3">
              {run.triage ? (
                <TriageGroups run={run} triage={run.triage} limit={limit} />
              ) : findings.length ? (
                <>
                  {findings.some((f) => OPEN_STATUSES.has(f.status)) ? (
                    <MutedText>{t('bugFinding.noTriage')}</MutedText>
                  ) : null}
                  <PlainFindings
                    label={t('bugFinding.group.all', { count: findings.length })}
                    findings={limit === null ? findings : findings.slice(0, limit)}
                  />
                </>
              ) : (
                <MutedText>{t('bugFinding.noFindings')}</MutedText>
              )}
            </div>
          ) : null}
          {collapsible ? (
            <div className="flex">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                aria-controls={findingsId}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded
                  ? t('bugFinding.showLess')
                  : t('bugFinding.showMore', { count: findings.length - FINDINGS_COLLAPSED })}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Tab Bug Finding của ticket tổng code-bf (mockup 2 và 3): mỗi lượt một thẻ, mới nhất trước. Lượt đang chờ/chạy có
 * thanh tiến độ lane do app Bug Finding báo về; lượt xong chia finding thành ba nhóm theo kế hoạch của Trợ Lý.
 */
export function BugFindingPanel({ view }: { view: BugFindingView }) {
  const { t } = useT('issues');
  const maxRuns = view.maxBatches + 1;
  return (
    <section aria-label={t('bugFinding.title')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading>{t('bugFinding.title')}</SectionHeading>
        <MutedText>{t('bugFinding.batches', { used: view.batchesUsed, max: view.maxBatches })}</MutedText>
      </div>
      <MutedText>{t('bugFinding.rerunNote')}</MutedText>
      {view.runs.length ? (
        view.runs.map((run) => <RunCard key={run.id} run={run} maxRuns={maxRuns} />)
      ) : (
        <MutedText>{t('bugFinding.empty')}</MutedText>
      )}
    </section>
  );
}

/** Kế hoạch mới nhất trong vòng nhắc tới finding: Trợ Lý tự sửa (kèm việc con), hỏi owner, hay bỏ qua có lý do. */
function handlingOf(t: Translate, runs: BugFindingRunView[], id: string): string {
  for (const run of runs) {
    const plan = run.triage;
    if (!plan) continue;
    if (plan.fix.includes(id)) {
      const issues = (plan.fixIssues[id] ?? []).map((i) => i.identifier ?? i.id).join(', ');
      return issues ? t('bugFinding.handling.fixWith', { issues }) : t('bugFinding.handling.fix');
    }
    if (plan.ask.includes(id)) return t('bugFinding.handling.ask');
    if (plan.dismiss.includes(id)) {
      const reason = plan.reasons[id];
      return reason ? t('bugFinding.handling.dismissWith', { reason }) : t('bugFinding.handling.dismiss');
    }
  }
  return '—';
}

/**
 * Thẻ Bug Finding trong màn duyệt của owner (mockup 4): kết quả cuối trên head PR sẽ merge, các lượt trước, chi phí và
 * bảng finding của lượt cuối cùng cách Trợ Lý/owner đã xử lý.
 */
export function BugFindingApprovalCard({ view }: { view: BugFindingView }) {
  const { t, lang } = useT('issues');
  const runs = view.runs.filter((run) => run.approvalRound === view.approvalRound);
  const last = runs[0];
  if (!last) {
    return (
      <section aria-label={t('bugFinding.title')}>
        <MutedText>{t('bugFinding.empty')}</MutedText>
      </section>
    );
  }
  const onHead = !!view.currentHead && last.headSha === view.currentHead;
  const earlier = runs.slice(1);
  const costs = runs
    .filter((run) => run.costUsd !== null)
    .reverse()
    .map((run) => formatUsd(run.costUsd ?? 0, lang));
  const findings = last.findings ?? [];
  const items: PropertyItem[] = [
    {
      label: t('bugFinding.approval.final'),
      value: (
        <span className="flex flex-wrap items-center gap-2">
          {last.verdict ? (
            <VerdictBadge verdict={last.verdict} />
          ) : (
            <Badge variant="outline">{t(`bugFinding.state.${last.state}`, { defaultValue: last.state })}</Badge>
          )}
          <span>
            {t(onHead ? 'bugFinding.approval.onHead' : 'bugFinding.approval.offHead', {
              run: last.run,
              sha: sha12(last.headSha),
              head: view.currentHead ? sha12(view.currentHead) : '—',
            })}
          </span>
        </span>
      ),
    },
    ...earlier.map((run) => ({
      label: t('bugFinding.runLabel', { run: run.run }),
      value: [
        run.verdict ?? t(`bugFinding.state.${run.state}`, { defaultValue: run.state }),
        t('bugFinding.findingCount', { count: (run.findings ?? []).length }),
      ].join(' · '),
    })),
  ];
  if (costs.length) items.push({ label: t('bugFinding.prop.cost'), value: costs.join(' + ') });
  return (
    <section aria-label={t('bugFinding.title')} className="flex flex-col gap-2">
      <SectionHeading>{t('bugFinding.title')}</SectionHeading>
      <PropertyList items={items} />
      {findings.length ? (
        <FindingTable
          label={t('bugFinding.group.all', { count: findings.length })}
          head={[t('bugFinding.col.finding'), t('bugFinding.col.handling'), t('bugFinding.col.lastRun')]}
          rows={findings.map((f) => ({
            key: f.id,
            cells: (
              <>
                <FindingCell finding={f} withSeverity />
                <TableCell>{handlingOf(t, runs, f.id)}</TableCell>
                <TableCell>
                  <FindingStatusBadge status={f.status} open={OPEN_STATUSES.has(f.status)} />
                </TableCell>
              </>
            ),
          }))}
        />
      ) : null}
    </section>
  );
}

/** Dòng phụ của dải giai đoạn code-bf: số PR ở bước gộp, lượt và trạng thái ở bước Bug Finding, ghi chú bước merge. */
export function withBugFindingDetails(
  items: StageStripItem[],
  view: BugFindingView | undefined,
  t: Translate,
): StageStripItem[] {
  const runs = view?.runs.filter((run) => run.approvalRound === view.approvalRound) ?? [];
  const last = runs[0];
  const pr = prNumberOf(last?.prUrl);
  return items.map((item) => {
    if (item.key === 'integratorPr' && pr) return { ...item, detail: t('bugFinding.prShort', { number: pr }) };
    if (item.key === 'bugFinding' && last && item.state !== 'waiting') {
      const state = t(`bugFinding.state.${last.state}`, { defaultValue: last.state });
      return { ...item, detail: t('bugFinding.strip.run', { run: last.run, max: (view?.maxBatches ?? 2) + 1, state }) };
    }
    if (item.key === 'integratorMerge' && item.state === 'waiting')
      return { ...item, detail: t('bugFinding.strip.merge') };
    return item;
  });
}

function useView(companyId: string, issueId: string) {
  const query = useBugFinding(companyId, issueId);
  const { t } = useT('issues');
  if (query.error) {
    return {
      node: (
        <ErrorState title={t('bugFinding.failed')} message={query.error.message} onRetry={() => void query.refetch()} />
      ),
    };
  }
  if (!query.data) return { node: <Spinner /> };
  return { view: query.data };
}

/** Khối Bug Finding trên trang ticket tổng code-bf: đọc route của plugin, lượt đang chạy thì đọc lại định kỳ. */
export function BugFindingSection({ companyId, issueId }: { companyId: string; issueId: string }) {
  const state = useView(companyId, issueId);
  return state.view ? <BugFindingPanel view={state.view} /> : state.node;
}

/** Thẻ Bug Finding trong dialog Duyệt và merge. */
export function BugFindingApproval({ companyId, issueId }: { companyId: string; issueId: string }) {
  const state = useView(companyId, issueId);
  return state.view ? <BugFindingApprovalCard view={state.view} /> : state.node;
}
