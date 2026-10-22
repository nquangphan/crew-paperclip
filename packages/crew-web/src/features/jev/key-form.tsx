// Ô key OpenRouter (S24.1). Key chỉ sống trong ô nhập đến lúc gửi: không điền sẵn, không đưa vào cache hay state
// của mutation, xóa trắng ngay khi bấm lưu, không log. Server chỉ trả lại vân tay.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type JevErrorCode, type JevSettings, queryKeys } from '@/api';
import { Alert, Button, ConfirmDialog, Field, Input, MutedText } from '@/ds';
import { useT } from '@/i18n';

type Outcome =
  | { kind: 'saved' }
  | { kind: 'tested' }
  | { kind: 'testFailed'; errorCode: JevErrorCode }
  | { kind: 'deleted' };

const ERROR_CODES: readonly JevErrorCode[] = ['auth', 'timeout', 'unreachable', 'bad_response', 'internal'];

export function KeyForm({ companyId, settings }: { companyId: string; settings: JevSettings }) {
  const { t } = useT('jev');
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.jev(companyId, 'settings') });

  const send = async (test: boolean) => {
    const key = apiKey.trim();
    if (!key) return;
    // Xóa ô ngay: từ đây key chỉ còn là đối số của lời gọi, không nằm trong state nào.
    setApiKey('');
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const res = await api.jev.setKey(companyId, key, test);
      if (res.test === 'error') {
        setOutcome({ kind: 'testFailed', errorCode: res.errorCode ?? 'internal' });
      } else {
        setOutcome({ kind: res.test === 'ok' ? 'tested' : 'saved' });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      await api.jev.deleteKey(companyId);
      setOutcome({ kind: 'deleted' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disabledReason = busy ? t('key.working') : apiKey.trim() === '' ? t('key.needKey') : undefined;
  return (
    <form
      className="flex flex-col gap-3"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void send(false);
      }}
    >
      <p data-slot="jev-key-status">
        {settings.hasKey ? t('key.has', { fingerprint: settings.keyFingerprint ?? '' }) : t('key.none')}
      </p>
      <Field label={t('key.label')} hint={t('key.hint')} htmlFor="jev-api-key">
        <Input
          id="jev-api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('key.placeholder')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={busy || apiKey.trim() === ''} title={disabledReason}>
          {t('key.save')}
        </Button>
        <Button
          type="button"
          disabled={busy || apiKey.trim() === ''}
          title={disabledReason}
          onClick={() => void send(true)}
        >
          {t('key.saveAndTest')}
        </Button>
        {settings.hasKey ? (
          <Button type="button" variant="destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
            {t('key.delete')}
          </Button>
        ) : null}
      </div>
      {busy ? <MutedText>{t('key.working')}</MutedText> : null}
      {error ? (
        <Alert variant="destructive" title={t('key.failed')}>
          {error}
        </Alert>
      ) : null}
      {outcome?.kind === 'saved' ? <Alert variant="info">{t('key.result.saved')}</Alert> : null}
      {outcome?.kind === 'tested' ? <Alert variant="info">{t('key.result.tested')}</Alert> : null}
      {outcome?.kind === 'deleted' ? <Alert variant="info">{t('key.result.deleted')}</Alert> : null}
      {outcome?.kind === 'testFailed' ? (
        <Alert variant="warning" title={t('key.result.testFailed')}>
          {t(`key.errorCode.${ERROR_CODES.includes(outcome.errorCode) ? outcome.errorCode : 'internal'}`)}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('key.deleteConfirm.title')}
        body={t('key.deleteConfirm.body')}
        confirmLabel={t('key.deleteConfirm.confirm')}
        destructive
        onConfirm={() => void remove()}
      />
    </form>
  );
}
