// Huy hiệu "Cần Đại Ca để ý" trên mục hộp duyệt (S24.9). Tooltip và nhãn đọc màn hình liệt kê lý do. Chỉ vẽ khi có lý do.
import type { AttentionFlag } from '@/api';
import { Badge } from '@/ds';
import { useT } from '@/i18n';

export function InboxAttentionBadge({ reasons }: { reasons: AttentionFlag['reasons'] | undefined }) {
  const { t } = useT('jev');
  if (!reasons || reasons.length === 0) return null;
  const detail = reasons.map((r) => r.text).join('\n');
  return (
    <Badge
      variant="outline"
      data-testid="jev-attention"
      title={detail}
      aria-label={`${t('attention.badge')}: ${reasons.map((r) => r.text).join('; ')}`}
    >
      {t('attention.badge')}
    </Badge>
  );
}
