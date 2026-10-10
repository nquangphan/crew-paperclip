// Khung tiến độ dùng chung của wizard (thêm project, tạo agent, gỡ project, gỡ agent): danh sách bước theo setup run,
// chạy tiếp từ bước dở, lỗi bước kèm nút "Chạy tiếp", báo khi có người khác đang chạy, "Bỏ lần dở" cho lần thêm project
// chưa tạo project (lần gỡ không bỏ được).
// Câu chữ lấy theo tiền tố khóa của từng wizard. Link dựng theo company của setup run, không theo company đang chọn.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, queryKeys, type SetupRun, type SetupStepId } from '@/api';
import { useCompany } from '@/app/hooks';
import { Alert, Button, ConfirmDialog, ErrorState, MutedText, Spinner, Wizard, type WizardStep } from '@/ds';
import { useT } from '@/i18n';
import { StepBusyError, type Translate } from './add-project/run-step';
import { companyHref } from './resume';

/**
 * `POST /setup-runs/:id/abandon` của plugin (run thêm project chưa có project → `abandoned`, trả khóa project). Lớp
 * `src/api` chưa có hàm này thì không hiện nút "Bỏ lần dở".
 */
type AbandonFn = (companyId: string, id: string) => Promise<SetupRun>;
const abandonOf = (): AbandonFn | undefined => (api.setup as { abandon?: AbandonFn }).abandon;

export interface RunHooks {
  t: Translate;
  onStep: (step: SetupStepId) => void;
  onRun: (run: SetupRun) => void;
}

export interface SetupProgressProps {
  runId: string;
  kind: SetupRun['kind'];
  /** Tiền tố khóa dịch: `<prefix>.steps.<bước>`, `.loadFailed`, `.wrongKind`, `.busy`, `.runFailed`, `.continue`. */
  prefix: 'addProject' | 'addAgent' | 'removeProject' | 'removeAgent';
  /** Bước của run; dạng hàm khi danh sách bước tùy input (gỡ agent có hay không có vai trò). */
  steps: readonly SetupStepId[] | ((run: SetupRun) => readonly SetupStepId[]);
  run: (hooks: RunHooks, run: SetupRun, state: unknown) => Promise<SetupRun>;
  summary: (run: SetupRun) => ReactNode;
  /** `prefix` là issuePrefix của company sở hữu setup run. */
  done: (run: SetupRun, prefix: string) => ReactNode;
  /** Cho "Bỏ lần dở" (thêm project): đường của form để bắt đầu lại, tính từ gốc company. */
  restartPath?: string;
  /** Query cần làm mới sau mỗi lần chạy (ngoài setup run). */
  invalidate?: (run: SetupRun) => readonly (readonly unknown[])[];
  /** Cảnh báo theo kết quả bước đã xong (vd. checkout máy giữ lại), hiện cả khi run chưa xong. */
  notice?: (run: SetupRun) => ReactNode;
}

function stepsOf(t: Translate, prefix: string, ids: readonly SetupStepId[], run: SetupRun, active: SetupStepId | null) {
  return ids.map((id): WizardStep => {
    const saved = run.steps[id];
    const state = active === id ? 'running' : (saved?.status ?? (run.runningStep === id ? 'running' : 'pending'));
    return {
      id,
      title: t(`${prefix}.steps.${id}`),
      state,
      ...(state === 'failed' && saved?.error ? { detail: saved.error } : {}),
    };
  });
}

export function SetupProgress(props: SetupProgressProps) {
  const { runId, prefix } = props;
  const { t } = useT('wizards');
  const { company, companies } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<SetupStepId | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const autostarted = useRef(false);
  const { run: runSteps, invalidate } = props;

  // Mở bằng link: setup run đọc theo company đang xem (key gồm company: đổi company thì đọc lại); sau đó mọi bước
  // dùng companyId của chính setup run.
  const runKey = [...queryKeys.setupRun(runId), company.id] as const;
  const query = useQuery({ queryKey: runKey, queryFn: () => api.setup.get(company.id, runId) });
  const abandonRun = abandonOf();
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const abandon = useMutation({
    mutationFn: (run: SetupRun) => (abandonRun as AbandonFn)(run.companyId, run.id),
    onSuccess: (next) => {
      queryClient.setQueryData(runKey, next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew('crew.setupRuns') });
      navigate({ search: '' }, { replace: true });
    },
  });

  const start = useCallback(
    async (run: SetupRun, state: unknown = null) => {
      setBusy(false);
      setRunError(null);
      setRunning(true);
      const translate: Translate = (key, params) => t(key, params);
      try {
        await runSteps(
          {
            t: translate,
            onStep: setActive,
            onRun: (next) => queryClient.setQueryData([...queryKeys.setupRun(runId), company.id], next),
          },
          run,
          state,
        );
      } catch (error) {
        if (error instanceof StepBusyError) setBusy(true);
        else setRunError(error instanceof Error ? error.message : String(error));
        void queryClient.invalidateQueries({ queryKey: queryKeys.setupRun(runId) });
      } finally {
        setActive(null);
        setRunning(false);
        void queryClient.invalidateQueries({ queryKey: queryKeys.crew('crew.setupRuns') });
        void queryClient.invalidateQueries({ queryKey: ['crew', 'readiness'] });
        for (const key of invalidate?.(run) ?? []) void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [queryClient, runId, company.id, t, runSteps, invalidate],
  );

  const navState = location.state as { autostart?: boolean } | null;
  const autostart = Boolean(navState?.autostart);
  useEffect(() => {
    if (!query.data || !autostart || autostarted.current) return;
    autostarted.current = true;
    // Bỏ cờ tự chạy khỏi lịch sử để tải lại trang không chạy lại ngầm.
    navigate({ search: location.search }, { replace: true, state: null });
    void start(query.data, navState);
  }, [query.data, autostart, navigate, location.search, start, navState]);

  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        title={t(`${prefix}.loadFailed`)}
        message={query.error?.message ?? ''}
        retryLabel={t('common:action.retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const run = query.data;
  if (run.kind !== props.kind) return <Alert variant="warning" title={t(`${prefix}.wrongKind`)} />;

  const stepIds = typeof props.steps === 'function' ? props.steps(run) : props.steps;
  const steps = stepsOf((key, params) => t(key, params), prefix, stepIds, run, active);
  const failedStep = steps.find((s) => s.state === 'failed');
  const done = run.status === 'done';
  const abandoned = (run.status as string) === 'abandoned';
  const runPrefix = companies.find((c) => c.id === run.companyId)?.issuePrefix ?? company.issuePrefix;
  const canAbandon =
    props.restartPath !== undefined &&
    abandonRun !== undefined &&
    !done &&
    !abandoned &&
    !running &&
    run.projectId === null &&
    run.runningStep === null;
  const idle = !done && !abandoned && !running;

  return (
    <div className="flex flex-col gap-4">
      <MutedText>{props.summary(run)}</MutedText>
      <Wizard steps={steps} error={failedStep?.detail} onResume={idle ? () => void start(run) : undefined} />
      {busy ? <Alert variant="warning" title={t(`${prefix}.busy`)} /> : null}
      {runError ? (
        <Alert variant="destructive" title={t(`${prefix}.runFailed`)}>
          {runError}
        </Alert>
      ) : null}
      {abandon.error ? (
        <Alert variant="destructive" title={t(`${prefix}.abandon.failed`)}>
          {abandon.error.message}
        </Alert>
      ) : null}
      {props.notice?.(run)}
      {done ? props.done(run, runPrefix) : null}
      {abandoned ? (
        <Alert title={t(`${prefix}.abandoned`)}>
          {props.restartPath ? (
            <Link to={companyHref(runPrefix, props.restartPath)}>{t(`${prefix}.startOver`)}</Link>
          ) : null}
        </Alert>
      ) : null}
      {(idle && !failedStep) || canAbandon ? (
        <div className="flex gap-2">
          {idle && !failedStep ? <Button onClick={() => void start(run)}>{t(`${prefix}.continue`)}</Button> : null}
          {canAbandon ? (
            <Button variant="outline" disabled={abandon.isPending} onClick={() => setConfirmAbandon(true)}>
              {t(`${prefix}.abandon.button`)}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmAbandon}
        onOpenChange={setConfirmAbandon}
        title={t(`${prefix}.abandon.title`)}
        body={t(`${prefix}.abandon.body`, { key: run.projectKey })}
        confirmLabel={t(`${prefix}.abandon.button`)}
        destructive
        onConfirm={() => abandon.mutate(run)}
      />
    </div>
  );
}
