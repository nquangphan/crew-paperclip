// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useState } from 'react';
import { Alert, Button, ErrorState } from '@/ds';
import { ListChecks } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';
import { IssueLink } from '../popup/issue-nav';
import { canFollowPlan, followPlanInitial } from './follow-plan';
import { type CreatedRequest, NewRequestDialog } from './new-request-dialog';

/**
 * Nút "Làm theo kế hoạch này" trên yêu cầu gốc Lập kế hoạch đã xong (trang chi tiết và popup). Chỉ người ghi được
 * thấy nút (viewer và khách góp ý thì không). Bấm mở hộp Yêu cầu mới loại Code với project, tiêu đề và mô tả điền sẵn
 * từ kế hoạch; tạo xong hiện thông báo kèm link tới yêu cầu mới.
 */
export function FollowPlanAction({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const { readOnly } = useCompanyAccess();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ identifier: string; draft: boolean; failedUploads: string[] } | null>(null);
  if (readOnly || !canFollowPlan(issue)) return null;
  const onCreated = (made: Issue, info: CreatedRequest) =>
    setCreated({ identifier: made.identifier ?? made.id, draft: info.draft, failedUploads: info.failedUploads });
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        size="sm"
        variant="outline"
        data-testid="follow-plan"
        onClick={() => {
          setCreated(null);
          setOpen(true);
        }}
      >
        <ListChecks aria-hidden />
        {t('followPlan.button')}
      </Button>
      {created ? (
        <Alert
          variant="info"
          title={t(created.draft ? 'followPlan.createdDraft' : 'followPlan.created', { identifier: created.identifier })}
        >
          <IssueLink identifier={created.identifier}>{t('followPlan.open')}</IssueLink>
        </Alert>
      ) : null}
      {created && created.failedUploads.length > 0 ? (
        <ErrorState title={t('page.uploadFailed', { names: created.failedUploads.join(', ') })} />
      ) : null}
      <NewRequestDialog
        open={open}
        onOpenChange={setOpen}
        companyId={issue.companyId}
        onCreated={onCreated}
        initial={followPlanInitial(issue)}
      />
    </div>
  );
}
