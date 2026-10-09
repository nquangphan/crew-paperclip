// Khung tiến độ dùng chung của wizard (thêm project, tạo agent): danh sách bước theo setup run, chạy tiếp từ bước dở,
// lỗi bước kèm nút "Chạy tiếp", báo khi có người khác đang chạy. Câu chữ lấy theo tiền tố khóa của từng wizard.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, queryKeys, type SetupRun, type SetupStepId } from '@/api';
import { useCompany } from '@/app/hooks';
import { Alert, Button, ErrorState, MutedText, Spinner, Wizard, type WizardStep } from '@/ds';
import { useT } from '@/i18n';
import { StepBusyError, type Translate } from './add-project/run-step';

export interface RunHooks {
  t: Translate;
  onStep: (step: SetupStepId) => void;
  onRun: (run: SetupRun) => void;
}

export interface SetupProgressProps {
  runId: string;
  kind: SetupRun['kind'];
  /** Tiền tố khóa dịch: `<prefix>.steps.<bước>`, `.loadFailed`, `.wrongKind`, `.busy`, `.runFailed`, `.continue`. */
  prefix: 'addProject' | 'addAgent';
  steps: readonly SetupStepId[];
  run: (hooks: RunHooks, run: SetupRun, state: unknown) => Promise<SetupRun>;
  summary: (run: SetupRun) => ReactNode;
  done: (run: SetupRun) => ReactNode;
  /** Query cần làm mới sau mỗi lần chạy (ngoài setup run). */
  invalidate?: (run: SetupRun) => readonly (readonly unknown[])[];
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
  const { company } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<SetupStepId | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const autostarted = useRef(false);
  const { run: runSteps, invalidate } = props;

  // Mở bằng link: setup run đọc theo company đang xem; sau đó mọi bước dùng companyId của chính setup run.
  const query = useQuery({
    queryKey: queryKeys.setupRun(runId),
    queryFn: () => api.setup.get(company.id, runId),
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
            onRun: (next) => queryClient.setQueryData(queryKeys.setupRun(runId), next),
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
    [queryClient, runId, t, runSteps, invalidate],
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

  const steps = stepsOf((key, params) => t(key, params), prefix, props.steps, run, active);
  const failedStep = steps.find((s) => s.state === 'failed');
  const done = run.status === 'done';

  return (
    <div className="flex flex-col gap-4">
      <MutedText>{props.summary(run)}</MutedText>
      <Wizard steps={steps} error={failedStep?.detail} onResume={running ? undefined : () => void start(run)} />
      {busy ? <Alert variant="warning" title={t(`${prefix}.busy`)} /> : null}
      {runError ? (
        <Alert variant="destructive" title={t(`${prefix}.runFailed`)}>
          {runError}
        </Alert>
      ) : null}
      {done ? props.done(run) : null}
      {!done && !running && !failedStep ? (
        <div className="flex gap-2">
          <Button onClick={() => void start(run)}>{t(`${prefix}.continue`)}</Button>
        </div>
      ) : null}
    </div>
  );
}
