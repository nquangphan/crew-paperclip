// crew: tự dựng
import * as React from 'react';
import { useT } from '@/i18n';
import { Button } from '../components/button';
import { Plus } from '../icons';

interface AttachmentPickerProps {
  onFiles: (files: File[]) => void;
  /** Trả câu cảnh báo cho file đáng ngờ (ví dụ file nén, file chứa khóa), hoặc null nếu ổn. */
  warnFor: (name: string) => string | null;
}

/** Chọn file; file có cảnh báo hiện cho người dùng xem trước, rồi họ chọn gửi tiếp hoặc bỏ. */
function AttachmentPicker({ onFiles, warnFor }: AttachmentPickerProps) {
  const { t } = useT();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<{ files: File[]; warnings: { name: string; warning: string }[] } | null>(
    null,
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const warnings = files.flatMap((f) => {
      const warning = warnFor(f.name);
      return warning ? [{ name: f.name, warning }] : [];
    });
    if (warnings.length === 0) onFiles(files);
    else setPending({ files, warnings });
  };

  return (
    <div data-slot="attachment-picker" className="flex flex-col gap-2">
      <input ref={inputRef} type="file" multiple className="hidden" onChange={onChange} />
      <div>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Plus aria-hidden />
          {t('attachment.choose')}
        </Button>
      </div>
      {pending ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/50 p-3 text-sm">
          <p className="font-medium">{t('attachment.warnTitle')}</p>
          <ul className="list-disc pl-5">
            {pending.warnings.map((w) => (
              <li key={w.name}>{t('attachment.fileWarning', { name: w.name, warning: w.warning })}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onFiles(pending.files);
                setPending(null);
              }}
            >
              {t('attachment.proceed')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              {t('attachment.discard')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { AttachmentPickerProps };
export { AttachmentPicker };
