// S0.6: menu tài khoản. Đăng xuất gọi POST /api/auth/sign-out, xóa cache rồi về trang đăng nhập.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ds';
import { LogOut } from '@/ds/icons';
import { useT } from '@/i18n';
import { useMe } from '../hooks';
import { StockUiMenuItem } from './stock-ui-link';

export function AccountMenu() {
  const { t } = useT();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => api.auth.signOut(),
    onSuccess: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
  const display = me.name ?? me.email ?? me.id;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('account.menu')}>
          <Avatar>
            <AvatarFallback>{display.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate">{display}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{me.email ?? display}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <StockUiMenuItem />
        <DropdownMenuItem disabled={signOut.isPending} onSelect={() => signOut.mutate()}>
          <LogOut aria-hidden />
          {signOut.isError ? t('account.signOutFailed') : t('account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
