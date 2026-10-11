// crew: tự dựng
import { PageHeader } from '@/ds';
import { useT } from '@/i18n';
import { InvitesSection } from './invites-section';
import { JoinRequestsSection } from './join-requests-section';
import { MembersSection } from './members-section';

/** Trang Thành viên (chỉ owner): mời khách góp ý, duyệt tham gia, bật hoặc gỡ dấu Phòng Marketing. */
export function MembersPage() {
  const { t } = useT('members');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex flex-col gap-4">
        <JoinRequestsSection />
        <MembersSection />
        <InvitesSection />
      </div>
    </>
  );
}
