// Mở khoá terminal bằng mật khẩu đăng nhập; mở khoá giữ 12 giờ theo phiên. Sai mật khẩu (403) hay bị chặn (429)
// thì hiện nguyên câu server trả.
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { api } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Input,
  Spinner,
} from '@/ds';
import { useT } from '@/i18n';

export function UnlockDialog({ onUnlocked, onCancel }: { onUnlocked: () => void; onCancel: () => void }) {
  const { t } = useT('terminal');
  const { company } = useCompany();
  const passwordId = useId();
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
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false}>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('unlock.title')}</DialogTitle>
            <DialogDescription>{t('unlock.description')}</DialogDescription>
          </DialogHeader>
          <Field label={t('unlock.password')} htmlFor={passwordId}>
            <Input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {unlock.error ? <ErrorState title={t('unlock.failed')} message={unlock.error.message} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('unlock.cancel')}
            </Button>
            <Button type="submit" disabled={unlock.isPending || !password}>
              {unlock.isPending ? <Spinner label={t('unlock.submitting')} /> : null}
              {t('unlock.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
