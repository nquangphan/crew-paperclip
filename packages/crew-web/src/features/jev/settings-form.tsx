// Form cấu hình Jev (S24.2): bật/tắt, chế độ gate, model, ngưỡng, timeout, C3 phía server. Chọn "Chặn thật" phải xác nhận.
// Form dựng lại theo `version` của server, nên sau khi lưu hoặc có máy khác đổi cấu hình thì giá trị trên màn là bản mới nhất.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type JevGateMode, type JevSettings, type JevSettingsInput, queryKeys } from '@/api';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleSwitch,
} from '@/ds';
import { useT } from '@/i18n';

export const THRESHOLD_RANGE = { min: 0.3, max: 0.95 } as const;
export const TIMEOUT_RANGE = { min: 500, max: 3000 } as const;
const MODEL_RE = /^typesafe\/jev-[A-Za-z0-9._-]{1,60}$/;

type FieldErrors = Partial<Record<'model' | 'threshold' | 'timeoutMs', 'model' | 'threshold' | 'timeout'>>;

/** Đọc ô nhập thành cấu hình gửi lên; trả lỗi theo ô thay vì gửi giá trị server sẽ từ chối. */
export function parseSettingsForm(draft: {
  enabled: boolean;
  gateMode: JevGateMode;
  model: string;
  threshold: string;
  timeoutMs: string;
  serverShadow: boolean;
}): { value: JevSettingsInput } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const model = draft.model.trim();
  if (!MODEL_RE.test(model)) errors.model = 'model';
  const threshold = Number(draft.threshold);
  if (
    !draft.threshold.trim() ||
    !Number.isFinite(threshold) ||
    threshold < THRESHOLD_RANGE.min ||
    threshold > THRESHOLD_RANGE.max
  ) {
    errors.threshold = 'threshold';
  }
  const timeoutMs = Number(draft.timeoutMs);
  if (
    !draft.timeoutMs.trim() ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < TIMEOUT_RANGE.min ||
    timeoutMs > TIMEOUT_RANGE.max
  ) {
    errors.timeoutMs = 'timeout';
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    value: {
      enabled: draft.enabled,
      gateMode: draft.gateMode,
      model,
      threshold,
      timeoutMs,
      serverShadow: draft.serverShadow,
    },
  };
}

export function SettingsForm({ companyId, settings }: { companyId: string; settings: JevSettings }) {
  // Dựng lại khi version đổi để ô nhập luôn khớp bản đã lưu; câu "Đã lưu" nằm ở đây để sống qua lần dựng lại.
  const [saved, setSaved] = useState<number | null>(null);
  return (
    <SettingsFormBody
      key={settings.version}
      companyId={companyId}
      settings={settings}
      saved={saved}
      onSaved={setSaved}
    />
  );
}

interface BodyProps {
  companyId: string;
  settings: JevSettings;
  saved: number | null;
  onSaved: (version: number | null) => void;
}

function SettingsFormBody({ companyId, settings, saved, onSaved }: BodyProps) {
  const { t } = useT('jev');
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [gateMode, setGateMode] = useState<JevGateMode>(settings.gateMode);
  const [model, setModel] = useState(settings.model);
  const [threshold, setThreshold] = useState(String(settings.threshold));
  const [timeoutMs, setTimeoutMs] = useState(String(settings.timeoutMs));
  const [serverShadow, setServerShadow] = useState(settings.serverShadow);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmEnforce, setConfirmEnforce] = useState(false);

  const save = useMutation({
    mutationFn: (body: JevSettingsInput) => api.jev.setSettings(companyId, body),
    onSuccess: (next) => {
      onSaved(next.version);
      queryClient.setQueryData(queryKeys.jev(companyId, 'settings'), next);
    },
  });

  const submit = () => {
    onSaved(null);
    const parsed = parseSettingsForm({ enabled, gateMode, model, threshold, timeoutMs, serverShadow });
    if ('errors' in parsed) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    save.mutate(parsed.value);
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('settings.enabled')} hint={t('settings.enabledHint')} htmlFor="jev-enabled">
          <ToggleSwitch id="jev-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </Field>
        <Field label={t('settings.serverShadow')} hint={t('settings.serverShadowHint')} htmlFor="jev-server-shadow">
          <ToggleSwitch id="jev-server-shadow" checked={serverShadow} onCheckedChange={setServerShadow} />
        </Field>
        <Field label={t('settings.gateMode')} hint={t(`settings.gateModeHint.${gateMode}`)} htmlFor="jev-gate-mode">
          <Select
            value={gateMode}
            onValueChange={(v) => {
              if (v === 'enforce' && gateMode !== 'enforce') setConfirmEnforce(true);
              else setGateMode(v as JevGateMode);
            }}
          >
            <SelectTrigger id="jev-gate-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shadow">{t('settings.mode.shadow')}</SelectItem>
              <SelectItem value="enforce">{t('settings.mode.enforce')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={t('settings.model')}
          hint={t('settings.modelHint')}
          error={errors.model ? t('settings.error.model') : undefined}
          htmlFor="jev-model"
        >
          <Input
            id="jev-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errors.model ? true : undefined}
          />
        </Field>
        <Field
          label={t('settings.threshold')}
          hint={t('settings.thresholdHint', THRESHOLD_RANGE)}
          error={errors.threshold ? t('settings.error.threshold', THRESHOLD_RANGE) : undefined}
          htmlFor="jev-threshold"
        >
          <Input
            id="jev-threshold"
            type="number"
            inputMode="decimal"
            step="0.05"
            min={THRESHOLD_RANGE.min}
            max={THRESHOLD_RANGE.max}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            aria-invalid={errors.threshold ? true : undefined}
          />
        </Field>
        <Field
          label={t('settings.timeout')}
          hint={t('settings.timeoutHint', TIMEOUT_RANGE)}
          error={errors.timeoutMs ? t('settings.error.timeout', TIMEOUT_RANGE) : undefined}
          htmlFor="jev-timeout"
        >
          <Input
            id="jev-timeout"
            type="number"
            inputMode="numeric"
            step="100"
            min={TIMEOUT_RANGE.min}
            max={TIMEOUT_RANGE.max}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(e.target.value)}
            aria-invalid={errors.timeoutMs ? true : undefined}
          />
        </Field>
      </div>
      {save.error ? (
        <Alert variant="destructive" title={t('settings.saveFailed')}>
          {save.error.message}
        </Alert>
      ) : null}
      {saved !== null ? <Alert variant="info">{t('settings.saved', { version: saved })}</Alert> : null}
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('settings.saving') : t('settings.save')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmEnforce}
        onOpenChange={setConfirmEnforce}
        title={t('settings.enforceConfirm.title')}
        body={t('settings.enforceConfirm.body')}
        confirmLabel={t('settings.enforceConfirm.confirm')}
        destructive
        onConfirm={() => {
          setGateMode('enforce');
          setConfirmEnforce(false);
        }}
      />
    </form>
  );
}
