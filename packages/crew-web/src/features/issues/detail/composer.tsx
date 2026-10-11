// crew: tự dựng
import { warnForAttachment } from '@crew/paperclip-plugin/shared/attachment-rules';
import type { Issue } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ClipboardEvent, useState } from 'react';
import { api, queryKeys } from '@/api';
import { AttachmentPicker, Button, ErrorState, Textarea } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { ContributionComposer } from '@/features/contributions/contribution-composer';
import { useT } from '@/i18n';

const linkFor = (id: string, name: string) => `[${name.replace(/[[\]]/g, '')}](${api.attachments.contentUrl(id)})`;

/** Ô soạn bình luận: khách góp ý gửi vào hàng chờ duyệt, người khác đăng thẳng (S6.5). */
export function Composer({ issue }: { issue: Issue }) {
  const { isContributor } = useCompanyAccess();
  return isContributor ? <ContributionComposer issue={issue} /> : <StockComposer issue={issue} />;
}

/** Ô soạn bình luận (S6.5): gửi bình luận, đính kèm hoặc dán file thì upload rồi chèn link. Không có chọn model. */
function StockComposer({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const [held, setHeld] = useState<{ files: File[]; warnings: string[] } | null>(null);

  const send = useMutation({
    mutationFn: (body: string) => api.comments.add(issue.id, body),
    onSuccess: () => {
      setText('');
      setFailed([]);
      void qc.invalidateQueries({ queryKey: queryKeys.comments(issue.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.issue(issue.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.issueRuns(issue.id) });
    },
  });

  const upload = async (files: File[]) => {
    setUploading(true);
    const links: string[] = [];
    const bad: string[] = [];
    for (const file of files) {
      try {
        const att = await api.attachments.upload(issue.companyId, issue.id, file);
        links.push(linkFor(att.id, att.originalFilename ?? file.name));
      } catch {
        bad.push(file.name);
      }
    }
    setUploading(false);
    setFailed(bad);
    if (links.length) setText((cur) => (cur ? `${cur}\n${links.join('\n')}` : links.join('\n')));
    void qc.invalidateQueries({ queryKey: queryKeys.attachments(issue.id) });
  };

  // Dán file: file đáng ngờ phải được người dùng xác nhận rồi mới upload, giống bộ chọn file.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    const warnings = files.flatMap((f) => warnForAttachment(f.name) ?? []);
    if (warnings.length === 0) void upload(files);
    else setHeld({ files, warnings });
  };

  const body = text.trim();
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={t('detail.composer.label')}
        placeholder={t('detail.composer.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
      />
      {held ? (
        <div role="alert" className="flex flex-col gap-2">
          <ul>
            {held.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void upload(held.files);
                setHeld(null);
              }}
            >
              {t('attachment.proceed', { ns: 'common' })}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setHeld(null)}>
              {t('attachment.discard', { ns: 'common' })}
            </Button>
          </div>
        </div>
      ) : null}
      {failed.length ? <ErrorState title={t('detail.composer.uploadFailed', { names: failed.join(', ') })} /> : null}
      {send.error ? <ErrorState title={t('detail.composer.sendFailed')} message={send.error.message} /> : null}
      <div className="flex items-center gap-2">
        <AttachmentPicker onFiles={(files) => void upload(files)} warnFor={warnForAttachment} />
        <Button disabled={body === '' || send.isPending || uploading} onClick={() => send.mutate(body)}>
          {send.isPending
            ? t('detail.composer.sending')
            : uploading
              ? t('detail.composer.uploading')
              : t('detail.composer.send')}
        </Button>
      </div>
    </div>
  );
}
