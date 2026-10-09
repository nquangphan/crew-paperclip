// crew: tự dựng
import * as React from 'react';
import { useT } from '@/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/alert-dialog';
import { Input } from '../components/input';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Bắt người dùng gõ đúng chuỗi này mới bật nút xác nhận. */
  requireText?: string;
  onConfirm: () => void;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  destructive,
  requireText,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useT();
  const [typed, setTyped] = React.useState('');
  React.useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  const locked = requireText !== undefined && typed !== requireText;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{body}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {requireText !== undefined ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t('confirm.typeToConfirm', { text: requireText })}</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={locked}
            data-variant={destructive ? 'destructive' : 'default'}
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type { ConfirmDialogProps };
export { ConfirmDialog };
