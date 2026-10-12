// crew: tự dựng
import type { IssueAttachment } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/api';
import { useMe } from '@/app/hooks';
import { Button, ConfirmDialog, DetailSection, ErrorState, MutedText, Skeleton } from '@/ds';
import { Trash2 } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';

/** File đính kèm của issue (S6.6): ảnh hiện thành hình, file khác hiện tên; tải về cho mọi người, xóa chỉ với file do chính mình tạo, có xác nhận. */
export function Attachments({ issueId }: { issueId: string }) {
  const { t } = useT('issues');
  const me = useMe();
  const { readOnly } = useCompanyAccess();
  const qc = useQueryClient();
  const [toDelete, setToDelete] = useState<IssueAttachment | null>(null);
  const list = useQuery({ queryKey: queryKeys.attachments(issueId), queryFn: () => api.attachments.list(issueId) });
  const remove = useMutation({
    mutationFn: (id: string) => api.attachments.delete(id),
    onSuccess: () => {
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: queryKeys.attachments(issueId) });
    },
  });
  const nameOf = (a: IssueAttachment) => a.originalFilename ?? t('detail.attachments.unnamed');

  const isImage = (a: IssueAttachment) => a.contentType.startsWith('image/');
  const images = (list.data ?? []).filter(isImage);
  const others = (list.data ?? []).filter((a) => !isImage(a));
  const deleteButton = (a: IssueAttachment, className?: string) =>
    a.createdByUserId === me.id && !readOnly ? (
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={t('detail.attachments.deleteFile', { name: nameOf(a) })}
        onClick={() => {
          remove.reset();
          setToDelete(a);
        }}
      >
        <Trash2 aria-hidden />
      </Button>
    ) : null;

  return (
    <DetailSection title={t('detail.attachments.heading')} count={list.data?.length}>
      {list.isLoading ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState
          title={t('detail.attachments.loadFailed')}
          message={list.error.message}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {list.data?.length === 0 ? <MutedText>{t('detail.attachments.empty')}</MutedText> : null}
      {images.length > 0 ? (
        // Ảnh xếp theo hàng, hết chỗ mới xuống dòng; bấm mở cỡ thật, tên file chỉ còn ở alt.
        <ul className="flex flex-wrap gap-2">
          {images.map((a) => (
            <li key={a.id} className="relative">
              <a href={api.attachments.contentUrl(a.id)} target="_blank" rel="noreferrer noopener">
                <img
                  src={api.attachments.contentUrl(a.id)}
                  alt={nameOf(a)}
                  loading="lazy"
                  className="h-40 w-auto max-w-full rounded-md border object-contain"
                />
              </a>
              {deleteButton(a, 'absolute top-1 right-1 bg-background/80')}
            </li>
          ))}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {others.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <a
                className="min-w-0 flex-1 truncate"
                href={api.attachments.contentUrl(a.id)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {nameOf(a)} · {t('detail.attachments.size', { kb: Math.max(1, Math.round(a.byteSize / 1024)) })}
              </a>
              {deleteButton(a)}
            </li>
          ))}
        </ul>
      ) : null}
      {remove.error ? <ErrorState title={t('detail.attachments.deleteFailed')} message={remove.error.message} /> : null}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title={t('detail.attachments.deleteTitle')}
        body={t('detail.attachments.deleteBody', { name: toDelete ? nameOf(toDelete) : '' })}
        confirmLabel={t('detail.attachments.delete')}
        destructive
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </DetailSection>
  );
}
