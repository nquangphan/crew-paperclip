// Skill chỉ đọc (S14.6): kiểm và cập nhật từ nguồn GitHub, tạo bản sửa được, đổi nguồn. Stock không có route đổi
// repo/nhánh của một nguồn, nên "Đổi nguồn" ghép ba đường: cập nhật từ nguồn, tạo bản sửa được, hoặc thêm skill từ
// nguồn mới, bật cho agent rồi xóa bản này.
import type { CompanySkillDetail, CompanySkillUpdateStatus } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api';
import { useCompany } from '@/app/hooks';
import { Alert, Button, MutedText, SectionHeading } from '@/ds';
import { Copy, Plus, RefreshCw } from '@/ds/icons';
import { useT } from '@/i18n';
import { AddSkillDialog } from './add-skill-dialog';
import { ForkSkillDialog } from './fork-skill-dialog';
import { invalidateSkills, type QueueAllResult, queueSyncOnAllMachines } from './use-skill-sync';

const REF_LENGTH = 7;

function UpdateFromSource({ skill }: { skill: Pick<CompanySkillDetail, 'id'> }) {
  const { t } = useT('skills');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CompanySkillUpdateStatus | null>(null);
  const [installed, setInstalled] = useState<QueueAllResult | null>(null);

  const check = useMutation({
    mutationFn: () => api.skills.updateStatus(company.id, skill.id),
    onSuccess: (next) => {
      setStatus(next);
      setInstalled(null);
    },
  });
  const install = useMutation({
    mutationFn: async () => {
      await api.skills.installUpdate(company.id, skill.id);
      return queueSyncOnAllMachines(queryClient, company.id, skill.id);
    },
    onSuccess: (done) => {
      setInstalled(done);
      setStatus(null);
      invalidateSkills(queryClient, company.id);
    },
  });

  let line: string | null = null;
  if (status && !status.supported) line = t('upstream.unsupported', { reason: status.reason ?? t('detail.unknown') });
  else if (status?.hasUpdate) line = t('upstream.hasUpdate', { ref: (status.latestRef ?? '').slice(0, REF_LENGTH) });
  else if (status) line = t('upstream.upToDate');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
          <RefreshCw aria-hidden />
          {t('upstream.check')}
        </Button>
        {status?.supported && status.hasUpdate ? (
          <Button type="button" disabled={install.isPending} onClick={() => install.mutate()}>
            {t('upstream.install')}
          </Button>
        ) : null}
      </div>
      {line ? <MutedText>{line}</MutedText> : null}
      {status?.updateHoldReason ? <MutedText>{t(`upstream.hold.${status.updateHoldReason}`)}</MutedText> : null}
      {check.error ? (
        <Alert variant="destructive" title={t('upstream.checkFailed')}>
          {check.error.message}
        </Alert>
      ) : null}
      {install.error ? (
        <Alert variant="destructive" title={t('upstream.installFailed')}>
          {install.error.message}
        </Alert>
      ) : null}
      {installed ? (
        <Alert variant="info" title={t('upstream.installed')}>
          {installed.queued > 0 ? t('add.queued', { count: installed.queued }) : null}
          {installed.waitingApp ? t('add.waitingAppHint') : null}
          {installed.failures.length ? t('editor.queueFailed', { error: installed.failures.join('; ') }) : null}
        </Alert>
      ) : null}
    </div>
  );
}

/** Thao tác cho skill chỉ đọc: cập nhật (chỉ nguồn GitHub), tạo bản sửa được, đổi nguồn. */
export function ReadOnlySkillActions({
  skill,
}: {
  skill: Pick<CompanySkillDetail, 'id' | 'name' | 'slug' | 'sourceType'>;
}) {
  const { t } = useT('skills');
  const [forking, setForking] = useState(false);
  const [adding, setAdding] = useState(false);
  const github = skill.sourceType === 'github';

  return (
    <div className="flex flex-col gap-4">
      {github ? (
        <div className="flex flex-col gap-2">
          <SectionHeading>{t('upstream.updateTitle')}</SectionHeading>
          <UpdateFromSource skill={skill} />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <SectionHeading>{t('fork.heading')}</SectionHeading>
        <MutedText>{t('fork.hint')}</MutedText>
        <div>
          <Button type="button" variant="outline" onClick={() => setForking(true)}>
            <Copy aria-hidden />
            {t('fork.open')}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <SectionHeading>{t('upstream.changeTitle')}</SectionHeading>
        <MutedText>{t('upstream.changeHint')}</MutedText>
        <div>
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t('upstream.addNew')}
          </Button>
        </div>
      </div>
      {forking ? <ForkSkillDialog skill={skill} open onOpenChange={setForking} /> : null}
      {adding ? <AddSkillDialog open onOpenChange={setAdding} /> : null}
    </div>
  );
}
