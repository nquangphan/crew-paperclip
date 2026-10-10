// Nút "Mở giao diện Paperclip gốc": mở tab mới tới trang tương ứng ở UI gốc; ẩn khi chưa cấu hình CREW_STOCK_UI_URL.
import { useLocation } from 'react-router-dom';
import { DropdownMenuItem, SidebarItem } from '@/ds';
import { ExternalLink } from '@/ds/icons';
import { useT } from '@/i18n';
import { stockUiBase, stockUiUrl } from '../stock-ui';

export function useStockUiHref(): string | null {
  const { pathname } = useLocation();
  return stockUiUrl(stockUiBase(), pathname);
}

/** Mục cuối sidebar: luôn thấy được, tách khỏi các mục việc chính. */
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
