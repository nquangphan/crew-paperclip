// S1.1: đăng nhập email/mật khẩu (POST /api/auth/sign-in/email). Không có đăng ký. Xong thì về `next` an toàn.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, queryKeys } from '@/api';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CenteredPage,
  ErrorState,
  Field,
  Input,
  Logo,
  Spinner,
} from '@/ds';
import { useT } from '@/i18n';
import { useSession } from '../hooks';
import { safeNext } from '../routes-util';

export function LoginPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const session = useSession();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useMutation({
    mutationFn: () => api.auth.signIn({ email: email.trim(), password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      navigate(next, { replace: true });
    },
  });

  if (session.data) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!signIn.isPending) signIn.mutate();
  };
  const err = signIn.error;
  const errorMessage =
    err instanceof ApiError && (err.status === 401 || err.code === 'INVALID_EMAIL_OR_PASSWORD')
      ? t('login.invalid')
      : err?.message;

  return (
    <CenteredPage>
      <div className="flex justify-center">
        <Logo />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('login.title')}</CardTitle>
          <CardDescription>{t('login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <Field label={t('login.email')} htmlFor={emailId}>
              <Input
                id={emailId}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t('login.password')} htmlFor={passwordId}>
              <Input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {err ? <ErrorState title={t('login.failed')} message={errorMessage} /> : null}
            <Button type="submit" disabled={signIn.isPending || !email.trim() || !password}>
              {signIn.isPending ? <Spinner label={t('login.submitting')} /> : null}
              {t('login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </CenteredPage>
  );
}
