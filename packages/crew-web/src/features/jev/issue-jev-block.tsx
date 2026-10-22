// Khối Jev trên trang chi tiết issue (S24.4): một dòng tóm tắt các lệnh Jev đã xét trong các run của issue, bấm để mở danh
// sách ca deny/escalate/lỗi và ca lệch C3. Chỉ owner thấy. Tải lười bằng query riêng: chưa tải xong, lỗi, hay không có dữ
// liệu thì không hiện gì (không spinner, không chiếm chỗ, không chặn phần còn lại của trang).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import { Button, Card, CardContent } from '@/ds';
import { ChevronDown, ChevronRight } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';
import { GateEventRows } from './gate-events-table';
import { ShadowRows } from './shadow-table';
import { useJevIssueSummary } from './use-jev';

export function IssueJevBlock({ issueId }: { issueId: string }) {
  const { t } = useT('jev');
  const { company } = useCompany();
  const { isOwner } = useCompanyAccess();
  const [open, setOpen] = useState(false);
  const summary = useJevIssueSummary(company.id, issueId, isOwner);
  const data = summary.data;
  if (!isOwner || !data) return null;
  if (data.calls === 0 && data.shadow.mismatch === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section data-slot="issue-jev" aria-label={t('issue.title')}>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Chevron aria-hidden />
            {t('issue.summary', {
              calls: data.calls,
              deny: data.deny,
              escalate: data.escalate,
              error: data.error,
            })}
          </Button>
          {open ? (
            <div className="flex flex-col gap-3">
              {data.items.length > 0 ? (
                <GateEventRows companyId={company.id} items={data.items} caption={t('issue.eventsCaption')} />
              ) : (
                <p>{t('issue.noEvents')}</p>
              )}
              {data.shadow.items.length > 0 ? (
                <>
                  <p>{t('issue.mismatch', { count: data.shadow.mismatch })}</p>
                  <ShadowRows items={data.shadow.items} caption={t('issue.mismatchCaption')} />
                </>
              ) : null}
              <Link to={companyPath(company.issuePrefix, 'jev')}>{t('issue.viewAll')}</Link>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
