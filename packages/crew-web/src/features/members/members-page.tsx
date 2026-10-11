// crew: tự dựng
import { EmptyState, PageHeader } from '@/ds';
import { useT } from '@/i18n';

/** Trang Thành viên (chỉ owner): mời khách góp ý, duyệt tham gia, bật/gỡ dấu Phòng Marketing. */
export function MembersPage() {
  const { t } = useT('members');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <EmptyState title={t('empty')} description={t('emptyHint')} />
    </>
  );
}
