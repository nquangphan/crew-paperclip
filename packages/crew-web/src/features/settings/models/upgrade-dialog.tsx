// Phần 4 của trang Cài đặt model: hộp thoại nâng model hàng loạt. Mở hộp thoại chọn runtime, model cũ, model mới; "Xem
// trước" gọi dry-run; "Nâng N chỗ" gửi lại đúng body với dryRun false.
import { useMutation } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import {
  api,
  type ModelRuntime,
  type ModelSettings,
  type ModelSettingsAgentChange,
  type ModelSettingsAgentSkip,
  type ModelUpgradeInput,
  type ModelUpgradeResult,
  modelSettingsErrorOf,
} from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Alert,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  MutedText,
} from '@/ds';
import { useT } from '@/i18n';
import { crewModelsOf } from '@/lib/instructions';
import { ChoiceSelect } from './fields';
import { MODEL_ID_RE, RUNTIMES } from './model-draft';

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bản đang lưu ở server (không phải bản nháp): nâng hàng loạt luôn áp trên bản này. */
  base: { revision: number; settings: ModelSettings };
  /** Có thay đổi chưa lưu: nâng xong thì bản nháp bị bỏ. */
  dirty: boolean;
  initial?: { runtime: ModelRuntime; model: string };
  /** Nâng thật xong. `differs` là true khi số thật khác bản xem trước. */
  onDone: (result: ModelUpgradeResult, differs: boolean) => void;
  /** Có người vừa lưu bản mới: tải lại bản mới nhất. */
  onReload: () => void;
}

/** Số chỗ sẽ đổi: catalog (1), ô bảng độ khó, vai, agent, issue đang mở. */
export function upgradeTotal(r: ModelUpgradeResult): number {
  const c = r.changes;
  return 1 + c.cells.length + c.roles.length + c.agents.length + c.issues.length;
}

const countsOf = (r: ModelUpgradeResult) =>
  [
    r.changes.catalog,
    r.changes.cells.length,
    r.changes.roles.length,
    r.changes.agents.length,
    r.changes.issues.length,
  ].join('/');

export function UpgradeDialog({ open, onOpenChange, base, dirty, initial, onDone, onReload }: UpgradeDialogProps) {
  const { t } = useT('settings');
  const { companies } = useCompany();
  const listId = useId();
  const firstRuntime = initial?.runtime ?? 'claude_local';
  const [runtime, setRuntime] = useState<ModelRuntime>(firstRuntime);
  const [fromModel, setFromModel] = useState(initial?.model ?? '');
  const [toModel, setToModel] = useState('');
  const [vision, setVision] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<ModelUpgradeResult | null>(null);
  const [problem, setProblem] = useState<{ messages: string[]; stale: boolean } | null>(null);

  const models = base.settings.catalog[runtime].models;
  const ids = crewModelsOf(runtime, base.settings);
  const from = fromModel !== '' && fromModel in models ? fromModel : (ids[0] ?? '');
  const to = toModel.trim();
  const isNew = to !== '' && !(to in models);
  const visionValue = vision ?? models[from]?.vision === true;
  const toInvalid = to !== '' && !MODEL_ID_RE.test(to);
  const ready = from !== '' && to !== '' && !toInvalid && to !== from;

  const body = useMemo<ModelUpgradeInput>(
    () => ({
      baseRevision: base.revision,
      runtime,
      fromModel: from,
      toModel: to,
      ...(isNew ? { vision: visionValue } : {}),
    }),
    [base.revision, runtime, from, to, isNew, visionValue],
  );

  const reset = () => {
    setPreview(null);
    setProblem(null);
  };

  const fail = (err: unknown) => {
    const e = modelSettingsErrorOf(err);
    setPreview(null);
    if (e.kind === 'invalid')
      setProblem({ messages: e.issues.length > 0 ? e.issues.map((i) => i.message) : [e.message], stale: false });
    else setProblem({ messages: [e.message], stale: e.kind === 'stale' });
  };

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.modelSettings.upgrade(body, { dryRun }),
    onSuccess: (result, dryRun) => {
      if (dryRun) {
        setProblem(null);
        setPreview(result);
        return;
      }
      onDone(result, preview !== null && countsOf(preview) !== countsOf(result));
    },
    onError: fail,
  });

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('models.upgrade.title')}</DialogTitle>
          <DialogDescription>{t('models.upgrade.description')}</DialogDescription>
        </DialogHeader>
        <Alert variant="warning">{t('models.upgrade.macWarning')}</Alert>
        {dirty ? <Alert variant="warning">{t('models.upgrade.dirtyWarning')}</Alert> : null}
        <Field label={t('models.upgrade.runtime')}>
          <ChoiceSelect
            label={t('models.upgrade.runtime')}
            value={runtime}
            choices={RUNTIMES.map((r) => ({ value: r, label: r }))}
            onChange={(v) => {
              setRuntime(v as ModelRuntime);
              setFromModel('');
              reset();
            }}
          />
        </Field>
        <Field label={t('models.upgrade.from')}>
          <ChoiceSelect
            label={t('models.upgrade.from')}
            value={from}
            choices={ids.map((id) => ({ value: id, label: id }))}
            onChange={(v) => {
              setFromModel(v);
              reset();
            }}
          />
        </Field>
        <Field
          label={t('models.upgrade.to')}
          htmlFor="upgrade-to"
          hint={t('models.upgrade.toHint')}
          error={toInvalid ? t('models.catalog.idInvalid') : undefined}
        >
          <Input
            id="upgrade-to"
            list={listId}
            value={toModel}
            autoComplete="off"
            aria-invalid={toInvalid ? true : undefined}
            onChange={(e) => {
              setToModel(e.target.value);
              reset();
            }}
          />
          <datalist id={listId}>
            {ids
              .filter((id) => id !== from)
              .map((id) => (
                <option key={id} value={id} />
              ))}
          </datalist>
        </Field>
        {isNew && !toInvalid ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="upgrade-vision"
              checked={visionValue}
              onCheckedChange={(c) => {
                setVision(c === true);
                reset();
              }}
            />
            <Label htmlFor="upgrade-vision">{t('models.upgrade.vision')}</Label>
          </div>
        ) : null}
        {problem ? (
          <Alert variant="destructive" title={t('models.upgrade.failed')}>
            {problem.messages.join('; ')}
            {problem.stale ? (
              <>
                {' '}
                <Button variant="outline" size="xs" onClick={onReload}>
                  {t('models.stale.reload')}
                </Button>
              </>
            ) : null}
          </Alert>
        ) : null}
        {preview ? (
          <UpgradePreview result={preview} companyName={companyName} />
        ) : (
          <MutedText>{t('models.upgrade.previewHint')}</MutedText>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:action.cancel')}
          </Button>
          {preview ? (
            <Button disabled={run.isPending} onClick={() => run.mutate(false)}>
              {t('models.upgrade.apply', { n: upgradeTotal(preview) })}
            </Button>
          ) : (
            <Button disabled={!ready || run.isPending} onClick={() => run.mutate(true)}>
              {t('models.upgrade.preview')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpgradePreview({ result, companyName }: { result: ModelUpgradeResult; companyName: (id: string) => string }) {
  const { t } = useT('settings');
  const c = result.changes;
  return (
    <section aria-label={t('models.upgrade.previewTitle')} className="flex flex-col gap-2">
      <strong>{t('models.upgrade.previewTitle')}</strong>
      <MutedText>
        {t(c.catalog === 'renamed' ? 'models.upgrade.catalogRenamed' : 'models.upgrade.catalogMerged')}
      </MutedText>
      <MutedText>
        {t('models.upgrade.cells', { n: c.cells.length })}
        {c.cells.length > 0 ? ` (${c.cells.map((x) => x.level).join(', ')})` : ''}
      </MutedText>
      <MutedText>
        {t('models.upgrade.roles', { n: c.roles.length })}
        {c.roles.length > 0 ? ` (${c.roles.join(', ')})` : ''}
      </MutedText>
      <FoldedList
        label={t('models.upgrade.agents', { n: c.agents.length })}
        items={c.agents.map((a: ModelSettingsAgentChange) => ({
          key: a.agentId,
          text: `${a.name} · ${companyName(a.companyId)} · ${a.from.model} → ${a.to.model}`,
        }))}
      />
      <FoldedList
        label={t('models.upgrade.issues', { n: c.issues.length })}
        items={c.issues.map((i) => ({ key: i.issueId, text: `${i.identifier} · ${companyName(i.companyId)}` }))}
      />
      <FoldedList
        label={t('models.upgrade.skipped', { n: c.skipped.length })}
        items={c.skipped.map((a: ModelSettingsAgentSkip) => ({
          key: a.agentId,
          text: `${a.name} · ${companyName(a.companyId)} · ${t(`models.skipReason.${a.reason}`)}`,
        }))}
      />
      <strong>{t('models.upgrade.total', { n: upgradeTotal(result) })}</strong>
    </section>
  );
}

/** Đầu mục có số, bấm để mở danh sách chi tiết; danh sách rỗng thì chỉ hiện đầu mục. */
export function FoldedList({ label, items }: { label: string; items: { key: string; text: string }[] }) {
  const { t } = useT('settings');
  if (items.length === 0) return <MutedText>{label}</MutedText>;
  return (
    <Collapsible>
      <div className="flex items-center gap-2">
        <MutedText>{label}</MutedText>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="xs">
            {t('models.upgrade.toggleList')}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul>
          {items.map((i) => (
            <li key={i.key}>{i.text}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
