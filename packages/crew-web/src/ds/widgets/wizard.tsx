// crew: tự dựng
import { useT } from '@/i18n';
import { Button } from '../components/button';
import { Spinner } from '../components/spinner';
import { Check, CircleAlert, Clock } from '../icons';

type WizardStepState = 'pending' | 'running' | 'done' | 'failed' | 'waiting';

interface WizardStep {
  id: string;
  title: string;
  state: WizardStepState;
  detail?: string;
}

interface WizardProps {
  steps: WizardStep[];
  error?: string;
  onResume?: () => void;
}

function StepIcon({ state }: { state: WizardStepState }) {
  if (state === 'done') return <Check className="size-4 text-primary" aria-hidden />;
  if (state === 'failed') return <CircleAlert className="size-4 text-destructive" aria-hidden />;
  if (state === 'running') return <Spinner className="size-4" />;
  return <Clock className="size-4 text-muted-foreground" aria-hidden />;
}

/** Danh sách bước của wizard dài (add-project, add-agent): trạng thái từng bước, lỗi và nút chạy tiếp. */
function Wizard({ steps, error, onResume }: WizardProps) {
  const { t } = useT();
  const failed = steps.some((s) => s.state === 'failed');
  return (
    <div data-slot="wizard" className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.id} data-state={s.state} className="flex items-start gap-3 rounded-md border p-3 text-sm">
            <span className="mt-0.5 shrink-0">
              <StepIcon state={s.state} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{s.title}</span>
              {s.detail ? <span className="text-xs text-muted-foreground">{s.detail}</span> : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{t(`wizard.state.${s.state}`)}</span>
          </li>
        ))}
      </ol>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {failed && onResume ? (
        <div>
          <Button onClick={onResume}>{t('wizard.resume')}</Button>
        </div>
      ) : null}
    </div>
  );
}

export type { WizardProps, WizardStep, WizardStepState };
export { Wizard };
