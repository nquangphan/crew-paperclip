// crew: tự dựng
// Ô Mô tả (dán ảnh thành đính kèm) và ô Đính kèm, dùng chung cho dialog Yêu cầu mới và dialog Thêm việc con.
import { warnForAttachment } from '@crew/paperclip-plugin/shared/attachment-rules';
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from 'react';
import { AttachmentPicker, Button, Field, ImageGallery, ImageTile, Textarea } from '@/ds';
import { useT } from '@/i18n';

/**
 * Ảnh dán từ clipboard thành file đính kèm. Ảnh chụp màn hình nào cũng tên `image.png`, nên đặt lại tên theo giờ dán
 * và thứ tự để hai lần dán không trùng tên.
 */
export function pastedImages(data: Pick<DataTransfer, 'files'>, now = Date.now()): File[] {
  return Array.from(data.files)
    .filter((f) => f.type.startsWith('image/'))
    .map((f, i) => {
      const ext = (f.type.slice('image/'.length).split('+')[0] ?? '').replace('jpeg', 'jpg') || 'png';
      return new File([f], `anh-dan-${now}-${i + 1}.${ext}`, { type: f.type, lastModified: now });
    });
}

const isImageFile = (file: File) => file.type.startsWith('image/');
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

/** Thêm file mới, bỏ file trùng tên-cỡ-ngày đã chọn. */
export const addFiles = (current: File[], picked: File[]): File[] => {
  const seen = new Set(current.map(fileKey));
  return [...current, ...picked.filter((f) => !seen.has(fileKey(f)))];
};

/** Ảnh chưa upload hiện xem trước từ object URL; thu hồi URL khi bỏ ảnh hay đóng dialog. */
function LocalImageTile({ file, action }: { file: File; action: ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <ImageTile src={url} alt={file.name} size="sm" action={action} /> : null;
}

/** Ô Mô tả (markdown). Dán ảnh: ảnh vào danh sách đính kèm, mô tả giữ một dòng nhắc tên file ở chỗ con trỏ. */
export function DescriptionField({
  id,
  value,
  onChange,
  setFiles,
}: {
  id: string;
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  setFiles: Dispatch<SetStateAction<File[]>>;
}) {
  const { t } = useT('issues');
  return (
    <Field label={t('new.descriptionLabel')} htmlFor={id}>
      <Textarea
        id={id}
        value={value}
        placeholder={t('new.descriptionPlaceholder')}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const images = pastedImages(e.clipboardData);
          if (images.length === 0) return;
          // Ảnh vào danh sách đính kèm; mô tả giữ một dòng nhắc tên file ở chỗ con trỏ để agent biết ảnh nói về đoạn nào.
          e.preventDefault();
          setFiles((prev) => addFiles(prev, images));
          const el = e.currentTarget;
          const note = images.map((f) => t('new.pastedImage', { name: f.name })).join('\n');
          onChange((prev) => `${prev.slice(0, el.selectionStart)}${note}${prev.slice(el.selectionEnd)}`);
        }}
      />
    </Field>
  );
}

/** Ô Đính kèm: chọn file, ảnh xem trước theo hàng, file khác theo danh sách; mỗi mục có nút bỏ. */
export function AttachmentsField({ files, setFiles }: { files: File[]; setFiles: Dispatch<SetStateAction<File[]>> }) {
  const { t } = useT('issues');
  const removeButton = (file: File) => (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label={t('new.remove', { name: file.name })}
      onClick={() => setFiles((prev) => prev.filter((f) => fileKey(f) !== fileKey(file)))}
    >
      ×
    </Button>
  );
  return (
    <Field label={t('new.attachments')}>
      <AttachmentPicker onFiles={(picked) => setFiles((prev) => addFiles(prev, picked))} warnFor={warnForAttachment} />
      {files.some(isImageFile) ? (
        // Ảnh xếp theo hàng, hết chỗ mới xuống dòng.
        <ImageGallery>
          {files.filter(isImageFile).map((file) => (
            <LocalImageTile key={fileKey(file)} file={file} action={removeButton(file)} />
          ))}
        </ImageGallery>
      ) : null}
      {files.some((f) => !isImageFile(f)) ? (
        <ul className="grid gap-2">
          {files
            .filter((f) => !isImageFile(f))
            .map((file) => (
              <li key={fileKey(file)} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                {removeButton(file)}
              </li>
            ))}
        </ul>
      ) : null}
    </Field>
  );
}
