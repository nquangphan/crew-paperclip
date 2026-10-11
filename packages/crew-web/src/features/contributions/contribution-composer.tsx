// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useState } from 'react';
import { Button, ErrorState, MutedText, Textarea } from '@/ds';
import { useT } from '@/i18n';
import { useCreateContribution } from './use-contributions';

/** Ô soạn bình luận của khách góp ý: gửi vào bảng chờ, owner duyệt mới thành bình luận thật. Không đính kèm. */
export function ContributionComposer({ issue }: { issue: Issue }) {
  const { t } = useT('contributions');
  const [text, setText] = useState('');
  const create = useCreateContribution();
  const body = text.trim();

  const send = () => {
    if (body === '' || create.isPending) return;
    create.mutate({ kind: 'comment', issueId: issue.id, body }, { onSuccess: () => setText('') });
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={t('composer.label')}
        placeholder={t('composer.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {create.error ? <ErrorState title={t('composer.sendFailed')} message={create.error.message} /> : null}
      <div className="flex items-center justify-between gap-2">
        <MutedText>{t('composer.hint')}</MutedText>
        <Button disabled={body === '' || create.isPending} onClick={send}>
          {create.isPending ? t('composer.sending') : t('composer.send')}
        </Button>
      </div>
    </div>
  );
}
