// Trang Cài đặt model (S18.4), chỉ owner: sửa bản nháp bốn phần rồi Lưu. Lưu gọi dry-run trước; có agent bị đổi thì hỏi
// xác nhận, rồi lưu thật. Mọi lỗi của server hiện tại chỗ và bản nháp được giữ nguyên.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import {
  api,
  type ModelRuntime,
  type ModelSettings,
  type ModelSettingsError,
  type ModelSettingsSaveResult,
  type ModelSettingsView,
  type ModelUpgradeResult,
  modelSettingsErrorOf,
  queryKeys,
} from '@/api';
import { useMe } from '@/app/hooks';
import {
  Alert,
  Button,
  ConfirmDialog,
  ErrorState,
  MutedText,
  PageHeader,
  Section,
  Spinner,
  StickyActionBar,
} from '@/ds';
import { personName } from '@/features/members/members-model';
import { useMembers } from '@/features/members/use-members';
import { invalidateModelSettings, useModelSettings } from '@/features/model-settings';
import { formatDateTime, useT } from '@/i18n';
import { CatalogSection } from './catalog-section';
import { ComplexitySection } from './complexity-section';
import { cloneSettings, sameSettings } from './model-draft';
import { RolesSection } from './roles-section';
import { FoldedList, UpgradeDialog, upgradeTotal } from './upgrade-dialog';

type Notice =
  | { kind: 'save'; result: ModelSettingsSaveResult }
  | { kind: 'upgrade'; result: ModelUpgradeResult; differs: boolean };

export function ModelSettingsPage() {
  const { t } = useT('settings');
  const view = useModelSettings();
  if (view.error && !view.data) {
    return (
      <ErrorState
        title={t('models.loadFailed')}
        message={view.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void view.refetch()}
      />
    );
  }
  if (!view.data) return <Spinner label={t('models.loading')} />;
  if (!view.data.canEdit) {
    return <ErrorState title={t('models.forbidden.title')} message={t('models.forbidden.message')} />;
  }
  return <Editor initial={view.data} latest={view.data} />;
}

function Editor({ initial, latest }: { initial: ModelSettingsView; latest: ModelSettingsView }) {
  const { t, lang } = useT('settings');
  const queryClient = useQueryClient();
  const me = useMe();
  const members = useMembers();
  // `base` là bản đang lưu ở server mà bản nháp xuất phát từ đó; `draft` là bản đang sửa.
  const [base, setBase] = useState<ModelSettingsView>(initial);
  const [draft, setDraft] = useState<ModelSettings>(() => cloneSettings(initial.settings));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ModelSettingsError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<ModelSettingsSaveResult | null>(null);
  const [upgrade, setUpgrade] = useState<{ runtime: ModelRuntime; model: string } | 'open' | null>(null);
  const proceeding = useRef(false);

  const dirty = !sameSettings(base.settings, draft);
  const issues = problem?.kind === 'invalid' ? problem.issues : [];
  const inUse = problem?.kind === 'in_use' ? problem.inUse : [];
  const newerRevision = latest.revision > base.revision ? latest.revision : null;
  const staleRevision = problem?.kind === 'stale' ? (problem.currentRevision ?? newerRevision ?? 0) : newerRevision;

  // Sau khi lưu, query đọc lại: lấy giờ lưu và người lưu thật của đúng bản này (không đụng bản nháp).
  useEffect(() => {
    if (latest.revision === base.revision && latest !== base) setBase(latest);
  }, [latest, base]);

  // Rời trang khi còn thay đổi chưa lưu thì hỏi lại (đổi route trong app và đóng tab).
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const fail = (err: unknown) => {
    setConfirm(null);
    setProblem(modelSettingsErrorOf(err));
  };

  async function commit() {
    setBusy(true);
    try {
      const result = await api.modelSettings.save({ baseRevision: base.revision, settings: draft }, { dryRun: false });
      setBase({
        ...base,
        revision: result.revision,
        settings: result.settings,
        updatedAt: new Date().toISOString(),
        updatedByUserId: me.id,
      });
      setDraft(cloneSettings(result.settings));
      setNotice({ kind: 'save', result });
      void invalidateModelSettings(queryClient);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setProblem(null);
    setNotice(null);
    setBusy(true);
    try {
      const preview = await api.modelSettings.save({ baseRevision: base.revision, settings: draft }, { dryRun: true });
      if (preview.applied.agents.length > 0) {
        setConfirm(preview);
        setBusy(false);
        return;
      }
    } catch (err) {
      fail(err);
      setBusy(false);
      return;
    }
    await commit();
  }

  async function reload() {
    try {
      const fresh = await queryClient.fetchQuery({
        queryKey: queryKeys.modelSettings,
        queryFn: () => api.modelSettings.get(),
        staleTime: 0,
      });
      setBase(fresh);
      setDraft(cloneSettings(fresh.settings));
      setProblem(null);
      setNotice(null);
      setUpgrade(null);
    } catch (err) {
      fail(err);
    }
  }

  const undo = () => {
    setDraft(cloneSettings(base.settings));
    setProblem(null);
  };

  const upgraded = (result: ModelUpgradeResult, differs: boolean) => {
    setBase({
      ...base,
      revision: result.revision,
      settings: result.settings,
      updatedAt: new Date().toISOString(),
      updatedByUserId: me.id,
    });
    setDraft(cloneSettings(result.settings));
    setProblem(null);
    setNotice({ kind: 'upgrade', result, differs });
    setUpgrade(null);
    void invalidateModelSettings(queryClient);
  };

  const who = (userId: string | null): string => {
    if (!userId) return '';
    if (userId === me.id) return me.name ?? me.email ?? userId;
    const member = members.data?.find((m) => m.principalId === userId);
    return personName(member?.user, userId);
  };
  const description =
    base.revision === 0
      ? t('models.header.default')
      : t('models.header.saved', {
          revision: base.revision,
          time: formatDateTime(base.updatedAt, lang),
          who: who(base.updatedByUserId),
        });

  return (
    <>
      <PageHeader title={t('models.title')} description={description} />
      <div className="flex flex-col gap-4">
        {staleRevision !== null ? (
          <Alert variant="warning" title={t('models.stale.title', { revision: staleRevision })}>
            {t('models.stale.body')}{' '}
            <Button variant="outline" size="xs" onClick={() => void reload()}>
              {t('models.stale.reload')}
            </Button>
          </Alert>
        ) : null}
        {problem?.kind === 'unavailable' ? <Alert variant="warning">{t('models.unavailable')}</Alert> : null}
        {problem?.kind === 'forbidden' ? <Alert variant="destructive">{t('models.forbidden.message')}</Alert> : null}
        {problem?.kind === 'other' ? (
          <Alert variant="destructive" title={t('models.saveFailed')}>
            {problem.message}
          </Alert>
        ) : null}
        {problem?.kind === 'in_use' ? (
          <Alert variant="destructive" title={t('models.inUse.title')}>
            {problem.message}
          </Alert>
        ) : null}
        {issues.length > 0 || (problem?.kind === 'invalid' && problem.issues.length === 0) ? (
          <Alert variant="destructive" title={t('models.errors.summary', { count: issues.length })}>
            {problem?.kind === 'invalid' ? (
              <ul>
                {issues.length === 0 ? <li>{problem.message}</li> : null}
                {issues.map((i) => (
                  <li key={`${i.path}:${i.message}`}>
                    {i.path ? <code>{i.path}</code> : null} {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}

        <Section title={t('models.catalog.title')}>
          <CatalogSection
            settings={draft}
            issues={issues}
            inUse={inUse}
            onChange={setDraft}
            onUpgrade={(runtime, model) => setUpgrade({ runtime, model })}
          />
        </Section>
        <Section title={t('models.complexity.title')}>
          <ComplexitySection settings={draft} issues={issues} onChange={setDraft} />
        </Section>
        <Section title={t('models.roles.title')}>
          <RolesSection settings={draft} issues={issues} onChange={setDraft} />
        </Section>
        <Section title={t('models.upgrade.sectionTitle')}>
          <MutedText>{t('models.upgrade.sectionHint')}</MutedText>
          <div>
            <Button variant="outline" onClick={() => setUpgrade('open')}>
              {t('models.upgrade.open')}
            </Button>
          </div>
        </Section>
      </div>

      <StickyActionBar notice={notice ? <ResultNotice notice={notice} onClose={() => setNotice(null)} /> : undefined}>
        <Button variant="outline" disabled={!dirty || busy} onClick={undo}>
          {t('models.undo')}
        </Button>
        <Button disabled={!dirty || busy} onClick={() => void submit()}>
          {busy ? <Spinner decorative /> : null}
          {t('models.save')}
        </Button>
      </StickyActionBar>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t('models.confirmSave.title')}
        confirmLabel={t('models.confirmSave.confirm')}
        onConfirm={() => void commit()}
        body={
          confirm ? (
            <div className="flex flex-col gap-2">
              <p>
                {t('models.confirmSave.body', {
                  changed: confirm.applied.agents.length,
                  kept: confirm.applied.skipped.length,
                })}
              </p>
              <FoldedList
                label={t('models.upgrade.agents', { n: confirm.applied.agents.length })}
                items={confirm.applied.agents.map((a) => ({
                  key: a.agentId,
                  text: `${a.name} · ${a.role ?? ''} · ${a.from.model} → ${a.to.model}`,
                }))}
              />
              <FoldedList
                label={t('models.upgrade.skipped', { n: confirm.applied.skipped.length })}
                items={confirm.applied.skipped.map((a) => ({
                  key: a.agentId,
                  text: `${a.name} · ${a.role ?? ''} · ${t(`models.skipReason.${a.reason}`)}`,
                }))}
              />
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked' && !proceeding.current) blocker.reset();
        }}
        title={t('models.leave.title')}
        body={t('models.leave.body')}
        confirmLabel={t('models.leave.confirm')}
        destructive
        onConfirm={() => {
          proceeding.current = true;
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />

      {upgrade !== null ? (
        <UpgradeDialog
          open
          onOpenChange={(open) => {
            if (!open) setUpgrade(null);
          }}
          base={base}
          dirty={dirty}
          initial={upgrade === 'open' ? undefined : upgrade}
          onDone={upgraded}
          onReload={() => void reload()}
        />
      ) : null}
    </>
  );
}

function ResultNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const { t } = useT('settings');
  const changes = notice.kind === 'save' ? notice.result.applied.agents : notice.result.changes.agents;
  const skipped = notice.kind === 'save' ? notice.result.applied.skipped : notice.result.changes.skipped;
  const title =
    notice.kind === 'save'
      ? t('models.result.saved', { revision: notice.result.revision })
      : t('models.result.upgraded', { revision: notice.result.revision, n: upgradeTotal(notice.result) });
  return (
    <Alert variant="info" title={title}>
      {notice.kind === 'upgrade' && notice.differs ? <p>{t('models.result.differs')}</p> : null}
      {notice.kind === 'upgrade' ? (
        <p>
          {t('models.result.upgradeCounts', {
            cells: notice.result.changes.cells.length,
            roles: notice.result.changes.roles.length,
            issues: notice.result.changes.issues.length,
          })}
        </p>
      ) : null}
      <FoldedList
        label={t('models.result.agents', { n: changes.length })}
        items={changes.map((a) => ({ key: a.agentId, text: `${a.name} · ${a.from.model} → ${a.to.model}` }))}
      />
      {skipped.length > 0 ? (
        <FoldedList
          label={t('models.result.skipped', { n: skipped.length })}
          items={skipped.map((a) => ({ key: a.agentId, text: `${a.name} · ${t(`models.skipReason.${a.reason}`)}` }))}
        />
      ) : null}
      <Button variant="ghost" size="xs" onClick={onClose}>
        {t('common:action.close')}
      </Button>
    </Alert>
  );
}
