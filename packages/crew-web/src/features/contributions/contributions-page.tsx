// crew: tự dựng
import { EmptyState, PageHeader } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';

/** Trang góp ý chờ duyệt. Owner xem mọi tác giả (Chờ duyệt), khách xem mục của mình (Góp ý của tôi). */
export function ContributionsPage() {
  const { t } = useT('contributions');
  const { isOwner } = useCompanyAccess();
  const mode = isOwner ? 'owner' : 'mine';
  return (
    <>
      <PageHeader title={t(`page.${mode}.title`)} description={t(`page.${mode}.description`)} />
      <EmptyState title={t(`page.${mode}.empty`)} description={t(`page.${mode}.emptyHint`)} />
    </>
  );
}
