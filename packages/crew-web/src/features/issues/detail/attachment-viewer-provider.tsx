// crew: tự dựng
import type { IssueAttachment } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { ApiError, api, queryKeys } from '@/api';
import {
  AttachmentLinkContext,
  type AttachmentLinkHandler,
  AttachmentViewer,
  type AttachmentViewerFile,
  isTextual,
  stepIndex,
  viewerKindFor,
} from '@/ds';
import { useT } from '@/i18n';

interface ViewerTarget {
  id: string;
  /** Chữ của link / alt của ảnh: tên tạm khi file không có trong danh sách đính kèm của yêu cầu. */
  name?: string;
  image?: boolean;
  /** Ảnh base64 nhúng thẳng trong markdown: hiện từ chính `src`, không phải file trên server. */
  inline?: { src: string; contentType: string; byteSize: number };
}

/** Đếm lần mở ảnh nhúng để mỗi lần có id riêng (trạng thái lỗi tải của hộp xem ghi theo id). */
let inlineSeq = 0;

/** Ảnh trong danh sách đính kèm của yêu cầu, đúng thứ tự danh sách: dãy để bấm trước/sau. */
export function imageAttachments(files: readonly IssueAttachment[]): IssueAttachment[] {
  return files.filter(
    (a) =>
      viewerKindFor({ contentType: a.contentType, name: a.originalFilename ?? '', byteSize: a.byteSize }) === 'image',
  );
}

/**
 * File cần hiện: lấy thông tin từ danh sách đính kèm; link trỏ file ngoài danh sách (yêu cầu khác) thì dùng chữ của
 * link làm tên và đoán loại theo đuôi (ảnh trong markdown chắc chắn là ảnh). Ảnh base64 nhúng trong markdown hiện từ
 * chính `src` (đã qua luật ảnh của markdown), tải về cũng từ `src`.
 */
export function viewerFileFor(
  target: ViewerTarget,
  files: readonly IssueAttachment[],
  unnamed: string,
): AttachmentViewerFile {
  if (target.inline) {
    return {
      id: target.id,
      name: target.name?.trim() || unnamed,
      contentType: target.inline.contentType,
      byteSize: target.inline.byteSize,
      url: target.inline.src,
      downloadUrl: target.inline.src,
    };
  }
  const meta = files.find((a) => a.id === target.id);
  return {
    id: target.id,
    name: meta?.originalFilename || target.name?.trim() || unnamed,
    contentType: meta ? meta.contentType : target.image ? 'image/*' : null,
    byteSize: meta?.byteSize ?? null,
    url: api.attachments.contentUrl(target.id),
    downloadUrl: api.attachments.downloadUrl(target.id),
  };
}

/**
 * Hộp xem file đính kèm cho một yêu cầu: mục Đính kèm và mọi markdown bên trong (mô tả, bình luận, tài liệu) mở file
 * tại chỗ thay vì tab mới. Đặt bao quanh chi tiết yêu cầu, nên chạy cả ở trang đầy đủ lẫn popup `?issue=`.
 */
export function AttachmentViewerProvider({ issueId, children }: { issueId: string; children: ReactNode }) {
  const { t } = useT('issues');
  const [target, setTarget] = useState<ViewerTarget | null>(null);
  const list = useQuery({ queryKey: queryKeys.attachments(issueId), queryFn: () => api.attachments.list(issueId) });
  const files = list.data ?? [];
  const file = target ? viewerFileFor(target, files, t('detail.attachments.unnamed')) : null;
  const kind = file ? viewerKindFor(file) : 'other';

  const images = imageAttachments(files);
  const index = file && kind === 'image' ? images.findIndex((a) => a.id === file.id) : -1;
  const nav =
    index >= 0
      ? {
          index,
          total: images.length,
          onStep: (delta: -1 | 1) => setTarget({ id: images[stepIndex(index, images.length, delta)].id }),
        }
      : undefined;

  const textual = file !== null && isTextual(kind);
  const text = useQuery({
    queryKey: queryKeys.attachmentText(file?.id ?? ''),
    queryFn: ({ signal }) => api.attachments.text(file?.id ?? '', signal),
    enabled: textual,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const handler = useMemo<AttachmentLinkHandler>(
    () => ({
      match: api.attachments.idFromHref,
      open: (id, opts) => setTarget({ id, ...opts }),
      openImage: (src, { name, contentType, byteSize }) => {
        inlineSeq += 1;
        setTarget({ id: `inline-${inlineSeq}`, name, image: true, inline: { src, contentType, byteSize } });
      },
    }),
    [],
  );

  return (
    <AttachmentLinkContext.Provider value={handler}>
      {children}
      <AttachmentViewer
        file={file}
        onClose={() => setTarget(null)}
        nav={nav}
        text={
          textual
            ? {
                status: text.status,
                data: text.data,
                error: text.error?.message,
                missing: text.error instanceof ApiError && text.error.status === 404,
                onRetry: () => void text.refetch(),
              }
            : undefined
        }
      />
    </AttachmentLinkContext.Provider>
  );
}
