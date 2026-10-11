// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useState } from 'react';
import { Button, ErrorState, MutedText, Textarea } from '@/ds';
import { useT } from '@/i18n';
import { contributionErrorKey } from './approve-flow';
import { useCreateContribution } from './use-contributions';

/** Ô soạn bình luận của khách góp ý: gửi vào bảng chờ, owner duyệt mới thành bình luận thật. Không đính kèm. */
export function ContributionComposer({ issue }: { issue: Issue }) {
  const { t } = useT('contributions');
  const [text, setText] = useState('');
  const create = useCreateContribution();
  // Chỉ trim để kiểm rỗng; gửi nguyên văn để markdown (khối thụt lề, xuống dòng) giữ đúng như khách viết.
  const blank = text.trim() === '';
  const errorKey = create.error ? contributionErrorKey(create.error) : null;

  const send = () => {
    if (blank || create.isPending) return;
    create.mutate({ kind: 'comment', issueId: issue.id, body: text }, { onSuccess: () => setText('') });
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={t('composer.label')}
        placeholder={t('composer.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {create.error ? (
        <ErrorState title={t('composer.sendFailed')} message={errorKey ? t(errorKey) : create.error.message} />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <MutedText>{t('composer.hint')}</MutedText>
        <Button disabled={blank || create.isPending} onClick={send}>
          {create.isPending ? t('composer.sending') : t('composer.send')}
        </Button>
      </div>
    </div>
  );
}
