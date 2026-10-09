// crew: tự dựng
import { useEffect, useId, useState } from 'react';
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
  Textarea,
} from '@/ds';
import { useT } from '@/i18n';

interface CommentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  hint: string;
  /** Lời nhắn có sẵn khi mở (ví dụ câu duyệt mặc định). */
  initial: string;
  /** Số ký tự tối thiểu sau khi bỏ khoảng trắng hai đầu. */
  minLength: number;
  submitLabel: string;
  pending: boolean;
  /** Lỗi server, hiện nguyên văn; dialog giữ nguyên lời nhắn để người dùng sửa và tự bấm lại. */
  error: Error | null;
  failedTitle: string;
  onSubmit: (comment: string) => void;
}

/** Dialog Duyệt / Yêu cầu sửa: một ô lời nhắn, gửi kèm thao tác cổng (server ghi lời nhắn làm comment quyết định). */
export function CommentDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  hint,
  initial,
  minLength,
  submitLabel,
  pending,
  error,
  failedTitle,
  onSubmit,
}: CommentDialogProps) {
  const { t } = useT('issues');
  const id = useId();
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);
  const short = text.trim().length < minLength;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!short && !pending) onSubmit(text.trim());
          }}
        >
          <Field label={label} hint={hint} htmlFor={id}>
            <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {error ? <ErrorState title={failedTitle} message={error.message} /> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('gate.close')}
            </Button>
            <Button type="submit" disabled={short || pending}>
              {pending ? t('gate.sending') : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
