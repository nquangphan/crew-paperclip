// Tạo bản sửa được (S14.6): skill chỉ đọc (GitHub, URL, danh mục) được chép thành skill sửa được trên Paperclip;
// agent đang bật skill chuyển sang bản mới. Tên trùng skill Superpowers đã ghim thì chặn. Xong mở bản mới, bản gốc
// còn nên gợi ý xóa.
import type { CompanySkillDetail } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  MutedText,
  Spinner,
} from '@/ds';
import { useCrewMachines } from '@/features/machines/use-machines';
import { useT } from '@/i18n';
import { superpowersNameClash } from './name-guard';
import { invalidateSkills, queueSyncOnAllMachines } from './use-skill-sync';

/** Bản gốc đi kèm khi mở bản mới, để trang bản mới gợi ý xóa bản gốc. */
export interface ForkedFromState {
  forkedFrom: { id: string; name: string };
}

interface ForkSkillDialogProps {
  skill: Pick<CompanySkillDetail, 'id' | 'name' | 'slug'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ForkSkillDialog({ skill, open, onOpenChange }: ForkSkillDialogProps) {
  const { t } = useT('skills');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const machines = useCrewMachines(company.id);
  const [name, setName] = useState(t('fork.defaultName', { name: skill.name }));

  const precheck = useQuery({
    queryKey: queryKeys.skillForkPrecheck(company.id, skill.id),
    queryFn: () => api.skills.forkPrecheck(company.id, skill.id),
    enabled: open,
  });
  const agentIds = (precheck.data?.usedByAgents ?? []).filter((a) => a.desired !== false).map((a) => a.id);
  const reports = (machines.data ?? []).map((m) => m.latest);
  const clash = superpowersNameClash(name, reports);

  const fork = useMutation({
    mutationFn: async () => {
      const result = await api.skills.fork(company.id, skill.id, { name: name.trim(), reassignAgentIds: agentIds });
      // Bản mới chưa có trên máy nào: xếp đồng bộ như khi thêm skill. Lỗi xếp việc không chặn việc mở bản mới.
      await queueSyncOnAllMachines(queryClient, company.id, result.skill.id).catch(() => undefined);
      return result;
    },
    onSuccess: (result) => {
      invalidateSkills(queryClient, company.id);
      onOpenChange(false);
      const state: ForkedFromState = { forkedFrom: { id: skill.id, name: skill.name } };
      navigate(companyPath(company.issuePrefix, `skills/${result.skill.id}`), { state });
    },
  });
  const canFork = name.trim() !== '' && clash === null && precheck.isSuccess && !fork.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('fork.title')}</DialogTitle>
          <DialogDescription>{t('fork.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canFork) fork.mutate();
          }}
        >
          <Field label={t('fork.name')} htmlFor="skill-fork-name">
            <Input id="skill-fork-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {clash ? <Alert variant="warning">{t('fork.clash', { name: clash })}</Alert> : null}
          {precheck.isLoading ? <Spinner /> : null}
          {precheck.error ? (
            <Alert variant="destructive" title={t('fork.precheckFailed')}>
              {precheck.error.message}
            </Alert>
          ) : null}
          {precheck.data ? <MutedText>{t('fork.reassign', { count: agentIds.length })}</MutedText> : null}
          {fork.error ? (
            <Alert variant="destructive" title={t('fork.failed')}>
              {fork.error.message}
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" disabled={!canFork}>
              {t('fork.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
