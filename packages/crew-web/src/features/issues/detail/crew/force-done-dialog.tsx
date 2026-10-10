// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, type ForceDoneWarning, type LiveRun, queryKeys } from '@/api';
import { useCompany, useMe } from '@/app/hooks';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Label,
  MutedText,
  Textarea,
} from '@/ds';
import { useT } from '@/i18n';
import { type ChildSummary, useAgentNames } from '../use-issue';
import { useRefreshAfterGate } from './actions-slot';
import {
  type ChildFailure,
  cancelShownChildren,
  type ForceDoneDeps,
  type ForceDoneOutcome,
  forceDoneAvailable,
  MAX_FORCE_REASON,
  MIN_FORCE_REASON,
  openChildren,
  runForceDone,
  type SkippedGate,
  skippedGates,
  validReason,
} from './force-done';

const ACTIVE_RUN = new Set(['running', 'queued']);

type Notice =
  | { kind: 'stale'; status: string }
  | { kind: 'done'; warnings: ForceDoneWarning[]; failures: ChildFailure[] };

/**
 * Nút Ép Done (S6.17) cạnh các nút cổng, chỉ khi yêu cầu chưa đóng. Trang này chỉ mở được bằng phiên board (owner);
 * route plugin chặn lại actor không phải board. Dialog liệt kê cổng sẽ bỏ qua, run sẽ dừng và việc con chưa xong (ô
 * "Hủy luôn" bật sẵn), bắt buộc lý do 10–1000 ký tự. Chỉ hủy đúng các con đã liệt kê, sau khi yêu cầu đã đóng. Lỗi trước
 * khi đóng thì dừng, hiện nguyên văn trong dialog, giữ lý do; con hủy lỗi sau khi đóng thì báo kèm nút hủy lại.
 */
export function ForceDoneAction({ issue, childIssues }: { issue: Issue; childIssues: ChildSummary[] }) {
  const { t } = useT('issues');
  const qc = useQueryClient();
  const refresh = useRefreshAfterGate(issue);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelChildren, setCancelChildren] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const refreshAll = () => {
    refresh();
    void qc.invalidateQueries({ queryKey: queryKeys.issueActivity(issue.id) });
  };
  const deps: ForceDoneDeps = {
    getIssue: () => api.issues.get(issue.id),
    listChildren: () => api.issues.listCompact(issue.companyId, { parentId: issue.id, limit: 200 }),
    cancelChild: (id) => api.issues.update(id, { status: 'cancelled' }),
    listActiveRuns: async () => (await api.runs.liveForIssue(issue.id)) as LiveRun[],
    cancelRun: (runId) => api.runs.cancel(runId),
    forceDone: (text) => api.crew.forceDone(issue.id, { companyId: issue.companyId, reason: text }),
  };
  // Đúng các con đang hiện trong dialog (ô ẩn khi không có con nào thì không hủy gì).
  const shownChildIds = cancelChildren ? openChildren(childIssues).map((c) => c.id) : [];
  const doneNotice = (warnings: ForceDoneWarning[], failures: ChildFailure[]): Notice | null =>
    warnings.length > 0 || failures.length > 0 ? { kind: 'done', warnings, failures } : null;
  const force = useMutation({
    mutationFn: (): Promise<ForceDoneOutcome> => runForceDone(deps, { reason, childIds: shownChildIds }),
    onSuccess: (out) => {
      setOpen(false);
      refreshAll();
      if (out.kind === 'stale') setNotice({ kind: 'stale', status: out.status });
      else {
        setReason('');
        // Route luôn kèm `violations_unread` (plugin không đọc được activity); cổng bỏ qua xem ở Lịch sử.
        const warnings = out.result.warnings.filter((w) => w !== 'violations_unread');
        setNotice(doneNotice(warnings, out.childFailures));
      }
    },
  });
  const retryChildren = useMutation({
    mutationFn: (failures: ChildFailure[]) =>
      cancelShownChildren(
        deps,
        failures.map((f) => f.id),
      ),
    onSuccess: (failures) => {
      refreshAll();
      setNotice((prev) => (prev?.kind === 'done' ? doneNotice(prev.warnings, failures) : prev));
    },
  });
  const childLabel = (id: string) => childIssues.find((c) => c.id === id)?.identifier ?? id;
  const available = forceDoneAvailable(issue);

  return (
    <div className="flex flex-col gap-2">
      {available ? (
        <Button
          size="sm"
          variant="destructive"
          disabled={force.isPending}
          onClick={() => {
            force.reset();
            setNotice(null);
            setCancelChildren(true);
            setOpen(true);
          }}
        >
          {t('forceDone.button')}
        </Button>
      ) : null}
      {notice?.kind === 'stale' ? (
        <Alert variant="warning">
          {t('forceDone.stale', {
            status: t(`status.${notice.status}`, { ns: 'common', defaultValue: notice.status }),
          })}
        </Alert>
      ) : null}
      {notice?.kind === 'done' && notice.warnings.length > 0 ? (
        <Alert variant="warning" title={t('forceDone.warnings')}>
          {notice.warnings.map((w) => t(`forceDone.warning.${w}`, { defaultValue: w })).join('; ')}
        </Alert>
      ) : null}
      {notice?.kind === 'done' && notice.failures.length > 0 ? (
        <Alert variant="warning" title={t('forceDone.childFailures', { count: notice.failures.length })}>
          <div className="flex flex-col gap-2">
            <ul>
              {notice.failures.map((f) => (
                <li key={f.id}>{`${childLabel(f.id)}: ${f.message}`}</li>
              ))}
            </ul>
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={retryChildren.isPending}
                onClick={() => retryChildren.mutate(notice.failures)}
              >
                {t('forceDone.retryChildren')}
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}
      {available ? (
        <ForceDoneDialog
          open={open}
          onOpenChange={(next) => {
            if (!next) setOpen(false);
          }}
          issue={issue}
          childIssues={childIssues}
          reason={reason}
          onReason={setReason}
          cancelChildren={cancelChildren}
          onCancelChildren={setCancelChildren}
          pending={force.isPending}
          error={force.error}
          onSubmit={() => force.mutate()}
        />
      ) : null}
    </div>
  );
}

interface ForceDoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: Issue;
  childIssues: ChildSummary[];
  reason: string;
  onReason: (reason: string) => void;
  cancelChildren: boolean;
  onCancelChildren: (on: boolean) => void;
  pending: boolean;
  error: Error | null;
  onSubmit: () => void;
}

function ForceDoneDialog({
  open,
  onOpenChange,
  issue,
  childIssues,
  reason,
  onReason,
  cancelChildren,
  onCancelChildren,
  pending,
  error,
  onSubmit,
}: ForceDoneDialogProps) {
  const { t } = useT('issues');
  const { company } = useCompany();
  const me = useMe();
  const agentNames = useAgentNames(company.id);
  const reasonId = useId();
  const childrenId = useId();
  const live = useQuery({
    queryKey: queryKeys.issueLiveRuns(issue.id),
    queryFn: async () => (await api.runs.liveForIssue(issue.id)) as LiveRun[],
    enabled: open,
  });
  const runs = (live.data ?? []).filter((r) => ACTIVE_RUN.has(r.status));
  const gates = skippedGates(issue);
  const kids = openChildren(childIssues);
  const ok = validReason(reason);

  const holderName = (holder: SkippedGate['holder']): string | null => {
    if (!holder) return null;
    if (holder.type === 'agent') return agentNames[holder.agentId] ?? t('history.actor.agent');
    return holder.userId === me.id ? t('history.actor.you') : t('history.actor.owner');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('forceDone.title')}</DialogTitle>
          <DialogDescription>{t('forceDone.body')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok && !pending) onSubmit();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label>{t('forceDone.gates')}</Label>
            {gates.length === 0 ? <MutedText>{t('forceDone.noGates')}</MutedText> : null}
            {gates.map((g) => {
              const holder = holderName(g.holder);
              const line = t('forceDone.gateLine', {
                n: g.index + 1,
                type: t(`detail.props.stageType.${g.type}`, { defaultValue: g.type }),
              });
              return (
                <MutedText key={g.stageId}>
                  {holder ? `${line} (${t('forceDone.gateCurrent', { holder })})` : line}
                </MutedText>
              );
            })}
          </div>
          {runs.length > 0 ? (
            <div className="flex flex-col gap-1">
              <MutedText>{t('forceDone.runs', { count: runs.length })}</MutedText>
              <ul className="flex flex-col">
                {runs.map((r) => (
                  <li key={r.id}>
                    <MutedText>
                      {t('forceDone.runLine', {
                        agent: agentNames[r.agentId] ?? r.agentName ?? t('history.actor.agent'),
                      })}
                    </MutedText>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {kids.length > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={childrenId}
                  checked={cancelChildren}
                  onCheckedChange={(on) => onCancelChildren(on === true)}
                />
                <Label htmlFor={childrenId}>{t('forceDone.cancelChildren', { count: kids.length })}</Label>
              </div>
              <ul className="flex flex-col">
                {kids.map((k) => (
                  <li key={k.id} className="flex gap-2">
                    <MutedText>{k.identifier ?? k.id}</MutedText>
                    <MutedText className="truncate">{k.title}</MutedText>
                  </li>
                ))}
              </ul>
              <MutedText>{t('forceDone.grandchildren')}</MutedText>
            </div>
          ) : null}
          <Field
            label={t('forceDone.reason')}
            hint={t('forceDone.reasonHint', { min: MIN_FORCE_REASON, max: MAX_FORCE_REASON })}
            htmlFor={reasonId}
          >
            <Textarea id={reasonId} value={reason} onChange={(e) => onReason(e.target.value)} />
          </Field>
          {error ? <ErrorState title={t('forceDone.failed')} message={error.message} /> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('forceDone.close')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!ok || pending}>
              {pending ? t('forceDone.sending') : t('forceDone.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
