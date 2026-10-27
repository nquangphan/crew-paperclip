// Phần 2 của trang Cài đặt model: bảng độ khó. Mỗi mức có thứ tự runtime (lên/xuống, bật/tắt) và model, effort của từng
// runtime đang bật. `large` khóa ở Claude.
import type { ModelComplexity, ModelRuntime, ModelSettings, ModelSettingsIssue } from '@/api';
import { Badge, Button, Field, HintTooltip, InlineError, MutedText, ToggleSwitch } from '@/ds';
import { ChevronDown, ChevronUp } from '@/ds/icons';
import { useT } from '@/i18n';
import { crewModelsOf } from '@/lib/instructions';
import { ChoiceSelect, EffortSelect } from './fields';
import { errorAt, LEVELS, moveRuntime, path, RUNTIMES, setCell, toggleRuntime } from './model-draft';

interface ComplexitySectionProps {
  settings: ModelSettings;
  issues: readonly ModelSettingsIssue[];
  onChange: (next: ModelSettings) => void;
}

export function ComplexitySection({ settings, issues, onChange }: ComplexitySectionProps) {
  const { t } = useT('settings');
  return (
    <>
      <MutedText>{t('models.complexity.hint')}</MutedText>
      {LEVELS.map((level) => (
        <LevelBlock key={level} level={level} settings={settings} issues={issues} onChange={onChange} />
      ))}
    </>
  );
}

function LevelBlock({
  level,
  settings,
  issues,
  onChange,
}: {
  level: ModelComplexity;
  settings: ModelSettings;
  issues: readonly ModelSettingsIssue[];
  onChange: (next: ModelSettings) => void;
}) {
  const { t } = useT('settings');
  const order = settings.order[level];
  const locked = level === 'large';
  const off = RUNTIMES.filter((r) => !order.includes(r));
  const levelError = errorAt(issues, path.order(level));
  return (
    <div className="flex flex-col gap-2" data-level={level}>
      <div className="flex items-center gap-2">
        <strong>{level}</strong>
        {locked ? <Badge variant="outline">{t('models.complexity.claudeOnly')}</Badge> : null}
      </div>
      {levelError ? <InlineError>{levelError}</InlineError> : null}
      {order.map((runtime, index) => (
        <RuntimeRow
          key={runtime}
          level={level}
          runtime={runtime}
          settings={settings}
          issues={issues}
          enabled
          position={index + 1}
          canMoveEarlier={!locked && index > 0}
          canMoveLater={!locked && index < order.length - 1}
          canToggle={!locked && order.length > 1}
          onChange={onChange}
        />
      ))}
      {off.map((runtime) => (
        <RuntimeRow
          key={runtime}
          level={level}
          runtime={runtime}
          settings={settings}
          issues={issues}
          enabled={false}
          position={0}
          canMoveEarlier={false}
          canMoveLater={false}
          canToggle={!locked}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

interface RuntimeRowProps {
  level: ModelComplexity;
  runtime: ModelRuntime;
  settings: ModelSettings;
  issues: readonly ModelSettingsIssue[];
  enabled: boolean;
  /** Vị trí trong thứ tự thử (từ 1); 0 khi runtime đang tắt ở mức này. */
  position: number;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  canToggle: boolean;
  onChange: (next: ModelSettings) => void;
}

function RuntimeRow({
  level,
  runtime,
  settings,
  issues,
  enabled,
  position,
  canMoveEarlier,
  canMoveLater,
  canToggle,
  onChange,
}: RuntimeRowProps) {
  const { t } = useT('settings');
  const spec = settings.catalog[runtime];
  const cell = spec.byComplexity[level];
  const cellError = errorAt(issues, path.cell(runtime, level), true);
  const modelError = errorAt(issues, `${path.cell(runtime, level)}.model`);
  const effortError = errorAt(issues, `${path.cell(runtime, level)}.effort`);
  const toggleHint =
    level === 'large'
      ? t('models.complexity.largeLocked')
      : enabled && !canToggle
        ? t('models.complexity.lastRuntime')
        : undefined;
  return (
    <div className="flex flex-col gap-1" data-runtime={runtime}>
      <div className="flex items-center gap-2">
        <HintTooltip hint={toggleHint}>
          <ToggleSwitch
            checked={enabled}
            disabled={!canToggle}
            aria-label={t('models.complexity.toggle', { runtime, level })}
            onCheckedChange={(on) => onChange(toggleRuntime(settings, level, runtime, on))}
          />
        </HintTooltip>
        <Badge variant={enabled ? 'secondary' : 'outline'}>{runtime}</Badge>
        {enabled ? (
          <>
            <Badge variant="outline">{t('models.complexity.position', { n: position })}</Badge>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!canMoveEarlier}
              aria-label={t('models.complexity.earlier', { runtime, level })}
              onClick={() => onChange(moveRuntime(settings, level, runtime, -1))}
            >
              <ChevronUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!canMoveLater}
              aria-label={t('models.complexity.later', { runtime, level })}
              onClick={() => onChange(moveRuntime(settings, level, runtime, 1))}
            >
              <ChevronDown aria-hidden />
            </Button>
          </>
        ) : null}
      </div>
      {enabled && cell ? (
        <div className="flex items-start gap-2">
          <Field label={t('models.complexity.model')} error={modelError}>
            <ChoiceSelect
              label={t('models.complexity.modelOf', { runtime, level })}
              value={cell.model}
              choices={crewModelsOf(runtime, settings).map((id) => ({ value: id, label: id }))}
              invalid={modelError !== undefined || cellError !== undefined}
              onChange={(model) => onChange(setCell(settings, runtime, level, { model }))}
            />
          </Field>
          {spec.effortKey === null ? null : (
            <Field label={t('models.complexity.effort')} error={effortError}>
              <EffortSelect
                label={t('models.complexity.effortOf', { runtime, level })}
                value={cell.effort}
                invalid={effortError !== undefined}
                onChange={(effort) => onChange(setCell(settings, runtime, level, { effort }))}
              />
            </Field>
          )}
        </div>
      ) : null}
      {enabled && cellError && !modelError && !effortError ? <InlineError>{cellError}</InlineError> : null}
    </div>
  );
}
