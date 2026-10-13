// crew: tự dựng
// Hộp xem file đính kèm ngay trong trang (không mở tab mới): ảnh lớn có trước/sau, PDF và video nhúng, markdown và
// code render từ nội dung chữ, HTML (mockup) trong iframe sandbox, file khác hiện thông tin và nút tải về.
// Màn hẹp (dưới md) là tấm phủ kín màn hình; màn rộng là hộp lớn giữa màn hình.
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/i18n';
import { Button } from '../components/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog';
import { ErrorState } from '../components/error-state';
import { Spinner } from '../components/spinner';
import { formatBytes, type ViewerKind, viewerKindFor } from './attachment-viewer-logic';
import { MarkdownView } from './markdown-view';

interface AttachmentViewerFile {
  id: string;
  name: string;
  contentType?: string | null;
  byteSize?: number | null;
  /** Link nội dung (hiện inline). */
  url: string;
  /** Link buộc tải về. */
  downloadUrl: string;
}

/** Nội dung chữ (markdown, code, HTML) do nơi gọi tải; widget chỉ hiện. */
interface AttachmentViewerText {
  status: 'pending' | 'error' | 'success';
  data?: string;
  error?: string;
  onRetry?: () => void;
}

interface AttachmentViewerNav {
  /** Vị trí ảnh đang xem, tính từ 0. */
  index: number;
  total: number;
  onStep: (delta: -1 | 1) => void;
}

interface AttachmentViewerProps {
  /** null là đóng. */
  file: AttachmentViewerFile | null;
  onClose: () => void;
  /** Dãy ảnh của yêu cầu (chỉ khi đang xem ảnh nằm trong dãy). */
  nav?: AttachmentViewerNav;
  /** Bắt buộc khi loại file là markdown, text hay HTML. */
  text?: AttachmentViewerText;
}

/** Thân hộp: mỗi loại một cách hiện. Ảnh/video/PDF lỗi tải thì quay về thẻ thông tin. */
function ViewerBody({
  file,
  kind,
  text,
  failed,
  onFail,
}: {
  file: AttachmentViewerFile;
  kind: ViewerKind;
  text?: AttachmentViewerText;
  failed: boolean;
  onFail: () => void;
}) {
  const { t, lang } = useT();
  if (kind === 'other' || failed) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border bg-background p-6 text-center">
          <FileText aria-hidden className="size-10 text-muted-foreground" />
          <p className="w-full truncate font-medium" title={file.name}>
            {file.name}
          </p>
          <dl className="grid w-full grid-cols-2 gap-x-3 gap-y-1 text-left text-sm">
            <dt className="text-muted-foreground">{t('attachment.viewer.size')}</dt>
            <dd className="truncate">{file.byteSize != null ? formatBytes(file.byteSize, lang) : '—'}</dd>
            <dt className="text-muted-foreground">{t('attachment.viewer.type')}</dt>
            <dd className="truncate">{file.contentType || t('attachment.viewer.unknownType')}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">
            {t(failed ? 'attachment.viewer.previewFailed' : 'attachment.viewer.noPreview')}
          </p>
          <Button asChild>
            <a href={file.downloadUrl} download={file.name}>
              <Download aria-hidden />
              {t('attachment.viewer.download')}
            </a>
          </Button>
        </div>
      </div>
    );
  }
  if (kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center p-2 md:p-4">
        <img
          key={file.id}
          src={file.url}
          alt={file.name}
          onError={onFail}
          className="max-h-full max-w-full rounded-sm object-contain"
        />
      </div>
    );
  }
  if (kind === 'video') {
    return (
      <div className="flex h-full items-center justify-center bg-black p-2">
        {/* biome-ignore lint/a11y/useMediaCaption: file người dùng tải lên, không có phụ đề đi kèm. */}
        <video key={file.id} src={file.url} controls onError={onFail} className="max-h-full max-w-full" />
      </div>
    );
  }
  if (kind === 'pdf') {
    return <iframe key={file.id} src={file.url} title={file.name} className="block h-full w-full border-0" />;
  }

  // Loại chữ: chờ nội dung do nơi gọi tải.
  if (!text || text.status === 'pending') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (text.status === 'error') {
    return (
      <div className="p-4">
        <ErrorState title={t('attachment.viewer.loadFailed')} message={text.error} onRetry={text.onRetry} />
      </div>
    );
  }
  const body = text.data ?? '';
  if (kind === 'html') {
    // Không có allow-same-origin: trang mockup chạy ở origin rỗng, không đọc được cookie, storage hay DOM của app.
    return (
      <iframe
        key={file.id}
        sandbox="allow-scripts"
        srcDoc={body}
        title={file.name}
        className="block h-full w-full border-0 bg-white"
      />
    );
  }
  if (kind === 'markdown') {
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
          <MarkdownView markdown={body} variant="document" />
        </div>
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto">
      <pre className="min-h-full bg-background p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {body}
      </pre>
    </div>
  );
}

function AttachmentViewer({ file, onClose, nav, text }: AttachmentViewerProps) {
  const { t } = useT();
  // Ảnh/video/PDF lỗi tải: ghi theo id file để chuyển ảnh khác thì thử lại từ đầu.
  const [failedId, setFailedId] = useState<string | null>(null);
  const kind = file
    ? viewerKindFor({ contentType: file.contentType, name: file.name, byteSize: file.byteSize })
    : 'other';
  const hasNav = Boolean(nav && nav.total > 1 && kind === 'image');

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {file ? (
        <DialogContent
          data-testid="attachment-viewer"
          data-kind={kind}
          showCloseButton={false}
          onOpenAutoFocus={(e) => {
            // Không tự đặt focus vào nút Tải về (vòng focus gây hiểu nhầm); focus khung để phím mũi tên chạy ngay.
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onKeyDown={(e) => {
            if (!hasNav || !nav) return;
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              nav.onStep(-1);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              nav.onStep(1);
            }
          }}
          className="top-0 left-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none md:top-(--pct-50) md:left-(--pct-50) md:h-[90vh] md:max-h-[90vh] md:w-[94vw] md:max-w-[1200px] md:translate-x-(--pct-neg-50) md:translate-y-(--pct-neg-50) md:rounded-lg md:border"
        >
          <div className="flex shrink-0 items-center gap-1 border-b bg-background py-2 pr-2 pl-4 pt-[max(0.5rem,env(safe-area-inset-top))] md:pt-2">
            <DialogTitle className="min-w-0 flex-1 truncate text-base" title={file.name}>
              {file.name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('attachment.viewer.description', { name: file.name })}
            </DialogDescription>
            {hasNav && nav ? (
              <span data-testid="attachment-viewer-counter" className="px-2 text-sm text-muted-foreground tabular-nums">
                {t('attachment.viewer.counter', { n: nav.index + 1, total: nav.total })}
              </span>
            ) : null}
            <Button variant="ghost" size="sm" asChild>
              <a href={file.downloadUrl} download={file.name} aria-label={t('attachment.viewer.download')}>
                <Download aria-hidden />
                <span className="max-sm:hidden">{t('attachment.viewer.download')}</span>
              </a>
            </Button>
            <Button variant="ghost" size="icon-sm" asChild>
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={t('attachment.viewer.openInNewTab')}
                title={t('attachment.viewer.openInNewTab')}
              >
                <ExternalLink aria-hidden />
              </a>
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('action.close')}>
                <XIcon aria-hidden />
              </Button>
            </DialogClose>
          </div>
          <div className="relative min-h-0 flex-1 bg-muted/40">
            <ViewerBody
              file={file}
              kind={kind}
              text={text}
              failed={failedId === file.id}
              onFail={() => setFailedId(file.id)}
            />
            {hasNav && nav ? (
              <>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={t('attachment.viewer.previous')}
                  disabled={nav.index <= 0}
                  onClick={() => nav.onStep(-1)}
                  className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full shadow-md md:left-4"
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={t('attachment.viewer.next')}
                  disabled={nav.index >= nav.total - 1}
                  onClick={() => nav.onStep(1)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full shadow-md md:right-4"
                >
                  <ChevronRight aria-hidden />
                </Button>
              </>
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export type { AttachmentViewerFile, AttachmentViewerNav, AttachmentViewerProps, AttachmentViewerText };
export { AttachmentViewer };
