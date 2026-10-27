// Phần 1 của trang Cài đặt model: danh sách model của từng runtime, cờ xem ảnh và key effort.
import { useState } from 'react';
import type { ModelEffortKey, ModelInUse, ModelRuntime, ModelSettings, ModelSettingsIssue } from '@/api';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  HintTooltip,
  InlineError,
  Input,
  Label,
  MutedText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { Plus, Trash2 } from '@/ds/icons';
import { useT } from '@/i18n';
import { crewModelsOf } from '@/lib/instructions';
import { type Choice, ChoiceSelect, NONE } from './fields';
import {
  addModel,
  EFFORT_KEYS,
  errorAt,
  isUsed,
  MAX_MODELS,
  MODEL_ID_RE,
  modelUsage,
  path,
  RUNTIMES,
  removeModel,
  setEffortKey,
  setVision,
} from './model-draft';

interface CatalogSectionProps {
  settings: ModelSettings;
  issues: readonly ModelSettingsIssue[];
  inUse: readonly ModelInUse[];
  onChange: (next: ModelSettings) => void;
  /** Mở hộp thoại nâng hàng loạt với model cũ điền sẵn. */
  onUpgrade: (runtime: ModelRuntime, model: string) => void;
}

export function CatalogSection({ settings, issues, inUse, onChange, onUpgrade }: CatalogSectionProps) {
  const { t } = useT('settings');
  const keyChoices: Choice[] = EFFORT_KEYS.map((k) => ({
    value: k ?? NONE,
    label: k ?? t('models.catalog.noEffortKey'),
  }));
  return (
    <>
      <MutedText>{t('models.catalog.hint')}</MutedText>
      {RUNTIMES.map((runtime) => {
        const spec = settings.catalog[runtime];
        const ids = crewModelsOf(runtime, settings);
        const blockError = errorAt(issues, path.models(runtime));
        return (
          <div key={runtime} className="flex flex-col gap-3" data-runtime={runtime}>
            <div className="flex items-end justify-between gap-3">
              <Badge variant="secondary">{runtime}</Badge>
              <Field label={t('models.catalog.effortKey')} error={errorAt(issues, path.effortKey(runtime))}>
                <ChoiceSelect
                  label={t('models.catalog.effortKeyOf', { runtime })}
                  value={spec.effortKey ?? NONE}
                  choices={keyChoices}
                  invalid={errorAt(issues, path.effortKey(runtime)) !== undefined}
                  onChange={(v) => onChange(setEffortKey(settings, runtime, v === NONE ? null : (v as ModelEffortKey)))}
                />
              </Field>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('models.catalog.model')}</TableHead>
                  <TableHead>{t('models.catalog.vision')}</TableHead>
                  <TableHead aria-label={t('models.catalog.actions')} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ids.map((id) => {
                  const usage = modelUsage(settings, runtime, id);
                  const used = isUsed(usage);
                  const rowError = errorAt(issues, path.model(runtime, id), true);
                  return (
                    <TableRow key={id}>
                      <TableCell>
                        <code>{id}</code>
                        {rowError ? <InlineError>{rowError}</InlineError> : null}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={spec.models[id]?.vision === true}
                          aria-label={t('models.catalog.visionOf', { model: id })}
                          onCheckedChange={(c) => onChange(setVision(settings, runtime, id, c === true))}
                        />
                      </TableCell>
                      <TableCell>
                        <HintTooltip
                          hint={
                            used
                              ? t('models.catalog.inUseHint', {
                                  where: [
                                    ...usage.levels.map((l) => t('models.catalog.whereLevel', { level: l })),
                                    ...usage.roles.map((r) => t('models.catalog.whereRole', { role: r })),
                                  ].join(', '),
                                })
                              : undefined
                          }
                        >
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={used}
                            aria-label={t('models.catalog.remove', { model: id })}
                            onClick={() => onChange(removeModel(settings, runtime, id))}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </HintTooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {blockError ? <InlineError>{blockError}</InlineError> : null}
            {inUse
              .filter((u) => u.runtime === runtime)
              .map((u) => (
                <div key={u.model} className="flex items-center gap-2">
                  <InlineError>
                    {t('models.catalog.inUse', { model: u.model, agents: u.agents, issues: u.issues })}
                  </InlineError>
                  <Button variant="outline" size="xs" onClick={() => onUpgrade(runtime, u.model)}>
                    {t('models.catalog.upgradeThis')}
                  </Button>
                </div>
              ))}
            <AddModelRow
              runtime={runtime}
              existing={ids}
              onAdd={(id, vision) => onChange(addModel(settings, runtime, id, vision))}
            />
          </div>
        );
      })}
    </>
  );
}

interface AddModelRowProps {
  runtime: ModelRuntime;
  existing: readonly string[];
  onAdd: (id: string, vision: boolean) => void;
}

function AddModelRow({ runtime, existing, onAdd }: AddModelRowProps) {
  const { t } = useT('settings');
  const [id, setId] = useState('');
  const [vision, setVisionFlag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = existing.length >= MAX_MODELS;

  const submit = () => {
    const value = id.trim();
    if (!MODEL_ID_RE.test(value)) return setError(t('models.catalog.idInvalid'));
    if (existing.includes(value)) return setError(t('models.catalog.idDuplicate'));
    onAdd(value, vision);
    setId('');
    setVisionFlag(false);
    setError(null);
  };

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          value={id}
          placeholder={t('models.catalog.newPlaceholder')}
          aria-label={t('models.catalog.newLabel', { runtime })}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          onChange={(e) => {
            setId(e.target.value);
            setError(null);
          }}
        />
        <div className="flex shrink-0 items-center gap-2">
          <Checkbox
            id={`new-vision-${runtime}`}
            checked={vision}
            aria-label={t('models.catalog.newVision', { runtime })}
            onCheckedChange={(c) => setVisionFlag(c === true)}
          />
          <Label htmlFor={`new-vision-${runtime}`}>{t('models.catalog.vision')}</Label>
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={full || id.trim() === ''}>
          <Plus aria-hidden />
          {t('models.catalog.add')}
        </Button>
      </div>
      {full ? <MutedText>{t('models.catalog.full', { max: MAX_MODELS })}</MutedText> : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </form>
  );
}
