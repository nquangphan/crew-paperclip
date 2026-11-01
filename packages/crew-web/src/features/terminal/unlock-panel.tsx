// Mở khoá terminal bằng mật khẩu đăng nhập, ngay giữa khung terminal; mở khoá giữ 12 giờ theo phiên. Sai mật khẩu (403)
// hay bị chặn (429) thì hiện nguyên câu server trả, ngay dưới ô mật khẩu.
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { api } from '@/api';
import { useCompany } from '@/app/hooks';
import { Button, Field, Input, Spinner, TerminalFieldError, TerminalPanel, TerminalPanelActions } from '@/ds';
import { Lock } from '@/ds/icons';
import { useT } from '@/i18n';

export function UnlockPanel({ onUnlocked, onCancel }: { onUnlocked: () => void; onCancel: () => void }) {
  const { t } = useT('terminal');
  const { company } = useCompany();
  const passwordId = useId();
  const errorId = useId();
  const [password, setPassword] = useState('');
  const unlock = useMutation({
    mutationFn: (value: string) => api.terminal.unlock(company.id, value),
    onSuccess: () => {
      setPassword('');
      onUnlocked();
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (password && !unlock.isPending) unlock.mutate(password);
  };
  return (
    <TerminalPanel icon={<Lock />} title={t('unlock.title')} description={t('unlock.description')}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field label={t('unlock.password')} htmlFor={passwordId}>
          <Input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-invalid={unlock.error ? true : undefined}
            aria-describedby={unlock.error ? errorId : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {unlock.error ? <TerminalFieldError id={errorId}>{unlock.error.message}</TerminalFieldError> : null}
        <TerminalPanelActions>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('unlock.cancel')}
          </Button>
          <Button type="submit" disabled={unlock.isPending || !password}>
            {unlock.isPending ? <Spinner label={t('unlock.submitting')} /> : null}
            {t('unlock.submit')}
          </Button>
        </TerminalPanelActions>
      </form>
    </TerminalPanel>
  );
}
