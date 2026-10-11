// Nút "Mở giao diện Paperclip gốc": mở tab mới tới trang tương ứng ở UI gốc; chỉ owner của company thấy, ẩn khi chưa
// cấu hình CREW_STOCK_UI_URL.
import { useLocation } from 'react-router-dom';
import { DropdownMenuItem, SidebarItem } from '@/ds';
import { ExternalLink } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access/use-company-access';
import { useT } from '@/i18n';
import { stockUiBase, stockUiUrl } from '../stock-ui';

export function useStockUiHref(): string | null {
  const { pathname } = useLocation();
  const { isOwner } = useCompanyAccess();
  if (!isOwner) return null;
  return stockUiUrl(stockUiBase(), pathname);
}

/** Mục cuối sidebar (chỉ owner), tách khỏi các mục việc chính. */
export function StockUiSidebarItem() {
  const { t } = useT();
  const href = useStockUiHref();
  if (!href) return null;
  return <SidebarItem href={href} label={t('stockUi.open')} icon={<ExternalLink aria-hidden />} external />;
}

/** Mục trong menu tài khoản. */
export function StockUiMenuItem() {
  const { t } = useT();
  const href = useStockUiHref();
  if (!href) return null;
  return (
    <DropdownMenuItem asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden />
        {t('stockUi.open')}
      </a>
    </DropdownMenuItem>
  );
}
