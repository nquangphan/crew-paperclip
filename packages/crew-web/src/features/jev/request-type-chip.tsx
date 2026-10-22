// Chip "Jev gợi ý: <loại>" dưới ô Loại. Bấm mới chọn; Jev không bao giờ tự đổi lựa chọn của owner.
import { Button } from '@/ds';
import { useT } from '@/i18n';

export function RequestTypeChip({
  suggestion,
  current,
  allowed,
  onPick,
}: {
  suggestion: string | null;
  current: string;
  /** Loại chọn được trong form (loại có nhãn chỉ hiện khi company có nhãn đó). */
  allowed: readonly string[];
  onPick: (kind: string) => void;
}) {
  const { t } = useT('jev');
  const { t: ti } = useT('issues');
  if (!suggestion || suggestion === current || !allowed.includes(suggestion)) return null;
  return (
    <Button type="button" size="xs" variant="outline" data-testid="jev-kind-chip" onClick={() => onPick(suggestion)}>
      {t('requestType.chip', { kind: ti(`new.kinds.${suggestion}`) })}
    </Button>
  );
}
