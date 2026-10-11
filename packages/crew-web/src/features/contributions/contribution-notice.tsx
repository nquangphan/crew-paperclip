// crew: tự dựng
// Thông báo sau một quyết định duyệt/từ chối mà dòng của mục có thể đã biến mất (mục rời tab Chờ duyệt, rời luồng
// bình luận chờ). Lưu ở cache của react-query theo company, nên mọi nơi trong shell đọc cùng một thông báo.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/app/hooks';
import { Alert, Button, FloatingNotice } from '@/ds';
import { useT } from '@/i18n';

export type ContributionNoticeKind = 'alreadyPosted' | 'rejectAlreadyApproved';

interface NoticeState {
  kind: ContributionNoticeKind;
  contributionId: string;
}

/** Khóa riêng, không nằm dưới tiền tố `contributions(c)` để các lần invalidate không xóa thông báo. */
const noticeKey = (companyId: string) => ['contribution-notice', companyId] as const;

/** Hàm đặt thông báo cho company đang xem. */
export function useShowContributionNotice(): (kind: ContributionNoticeKind, contributionId: string) => void {
  const { company } = useCompany();
  const qc = useQueryClient();
  return (kind, contributionId) => {
    const next: NoticeState = { kind, contributionId };
    qc.setQueryData<NoticeState | null>(noticeKey(company.id), () => next);
  };
}

/**
 * Thông báo hiện tại. `floating`: góc màn hình, dùng ở shell khi không có popup; không floating: nằm trong popup góp
 * ý (popup là modal nên phần ngoài popup không bấm được, không đọc được).
 */
export function ContributionNotice({ floating = false }: { floating?: boolean }) {
  const { t } = useT('contributions');
  const { company } = useCompany();
  const qc = useQueryClient();
  const key = noticeKey(company.id);
  const notice = useQuery<NoticeState | null>({
    queryKey: key,
    queryFn: () => null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  if (!notice) return null;
  const body = (
    <Alert variant="info" title={t(`notice.${notice.kind}.title`)}>
      <div className="flex flex-col items-start gap-2">
        <span>{t(`notice.${notice.kind}.body`)}</span>
        <Button type="button" size="xs" variant="outline" onClick={() => qc.setQueryData(key, null)}>
          {t('notice.dismiss')}
        </Button>
      </div>
    </Alert>
  );
  return floating ? (
    <FloatingNotice data-testid="contribution-notice" data-kind={notice.kind}>
      {body}
    </FloatingNotice>
  ) : (
    <div data-testid="contribution-notice" data-kind={notice.kind}>
      {body}
    </div>
  );
}
