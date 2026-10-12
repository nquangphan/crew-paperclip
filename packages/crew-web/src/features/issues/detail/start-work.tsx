// crew: tự dựng
// Nút "Bắt đầu làm" của yêu cầu nháp (`backlog`). Gửi PATCH stock `{ status: "todo" }`: route PATCH issue của server
// đánh thức assignee khi issue rời `backlog` (`issue_status_changed`), giống hệt lúc tạo thẳng `todo`, nên không cần cờ
// hay bình luận nào khác. Cổng Crew cho board (owner và thành viên ghi được) đổi `backlog → todo` trên issue gốc; viewer
// nhận 403 ở mọi route ghi, nên nút ẩn với người chỉ đọc. Đây không phải bộ chọn trạng thái tự do: chỉ đúng một phép
// chuyển, từ nháp sang Cần làm.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { Alert, Button, FloatingNotice } from '@/ds';
import { Play } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';

/** Phần issue mà nút cần; dùng được cho cả issue đầy đủ lẫn dòng compact của danh sách. */
export interface StartWorkIssue {
  id: string;
  companyId: string;
  identifier?: string | null;
  status: string;
  assigneeAgentId?: string | null;
}

export const DRAFT_STATUS = 'backlog';
/** Thông báo thành công tự ẩn sau chừng này; lỗi giữ tới khi người dùng đóng. */
export const START_WORK_NOTICE_MS = 6_000;

/** Nháp có agent nhận việc: bắt đầu thì có người được đánh thức. Nháp không assignee agent thì không có gì để gọi. */
export function canStartWork(issue: Pick<StartWorkIssue, 'status' | 'assigneeAgentId'>): boolean {
  return issue.status === DRAFT_STATUS && Boolean(issue.assigneeAgentId);
}

export type StartWorkNoticeState =
  | { kind: 'started'; identifier: string }
  | { kind: 'failed'; identifier: string; message: string };

/** Khóa riêng, không nằm dưới tiền tố `issues(c)` để các lần invalidate danh sách không xóa thông báo. */
const noticeKey = (companyId: string) => ['start-work-notice', companyId] as const;

class StaleDraftError extends Error {
  constructor(readonly status: string) {
    super(`stale_draft:${status}`);
  }
}

/**
 * Bắt đầu làm một nháp. Đọc lại issue ngay trước khi gửi: trang cũ có thể còn nút trong khi issue đã chạy (tab khác,
 * agent khác), và PATCH `todo` lúc đó sẽ kéo việc đang làm về Cần làm. Hết là nháp thì không gửi, chỉ làm mới.
 */
export function useStartWork(issue: StartWorkIssue) {
  const { t } = useT('issues');
  const qc = useQueryClient();
  const identifier = issue.identifier ?? issue.id;
  const refresh = () => {
    const keys = [
      queryKeys.issue(issue.id),
      queryKeys.issues(issue.companyId),
      queryKeys.issueRuns(issue.id),
      queryKeys.issueLiveRuns(issue.id),
      queryKeys.issueActivity(issue.id),
      queryKeys.sidebarBadges(issue.companyId),
      queryKeys.crew(),
    ];
    if (issue.identifier) keys.push(queryKeys.issue(issue.identifier));
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };
  const show = (next: StartWorkNoticeState) => qc.setQueryData(noticeKey(issue.companyId), next);
  return useMutation({
    mutationFn: async () => {
      const fresh = await api.issues.get(issue.id);
      if (fresh.status !== DRAFT_STATUS) throw new StaleDraftError(fresh.status);
      return api.issues.update(issue.id, { status: 'todo' });
    },
    onSuccess: () => {
      refresh();
      show({ kind: 'started', identifier });
    },
    onError: (error) => {
      refresh();
      const message =
        error instanceof StaleDraftError
          ? t('startWork.stale', { status: t(`status.${error.status}`, { ns: 'common', defaultValue: error.status }) })
          : error.message;
      show({ kind: 'failed', identifier, message });
    },
  });
}

/**
 * Nút chính trên yêu cầu nháp. Ẩn với người chỉ đọc (viewer, kể cả khách góp ý) và khi issue không phải nháp có
 * agent nhận việc. `size="xs"` cho dòng danh sách.
 */
export function StartWorkButton({ issue, size = 'sm' }: { issue: StartWorkIssue; size?: 'sm' | 'xs' }) {
  const { t } = useT('issues');
  const { readOnly } = useCompanyAccess();
  const start = useStartWork(issue);
  if (readOnly || !canStartWork(issue)) return null;
  return (
    <Button
      type="button"
      size={size}
      disabled={start.isPending}
      data-testid="start-work"
      onClick={(event) => {
        // Dòng danh sách là link phủ cả dòng: bấm nút không được mở yêu cầu.
        event.stopPropagation();
        start.mutate();
      }}
    >
      <Play aria-hidden />
      {start.isPending ? t('startWork.sending') : t('startWork.button')}
    </Button>
  );
}

/**
 * Thông báo kết quả Bắt đầu làm (thay cho toast). `floating`: góc màn hình, gắn ở shell khi không có popup; không
 * floating: nằm trong popup chi tiết (popup là modal nên phần ngoài popup không bấm được). Thành công tự ẩn.
 */
export function StartWorkNotice({ floating = false }: { floating?: boolean }) {
  const { t } = useT('issues');
  const { company } = useCompany();
  const qc = useQueryClient();
  const key = noticeKey(company.id);
  const notice = useQuery<StartWorkNoticeState | null>({
    queryKey: key,
    queryFn: () => null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  useEffect(() => {
    if (notice?.kind !== 'started') return;
    const timer = setTimeout(() => qc.setQueryData(noticeKey(company.id), null), START_WORK_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, qc, company.id]);
  if (!notice) return null;
  const body = (
    <Alert
      variant={notice.kind === 'started' ? 'info' : 'destructive'}
      title={t(`startWork.${notice.kind}`, { identifier: notice.identifier })}
    >
      <div className="flex flex-col items-start gap-2">
        <span>{notice.kind === 'started' ? t('startWork.startedBody') : notice.message}</span>
        <Button type="button" size="xs" variant="outline" onClick={() => qc.setQueryData(key, null)}>
          {t('startWork.dismiss')}
        </Button>
      </div>
    </Alert>
  );
  return floating ? (
    <FloatingNotice data-testid="start-work-notice" data-kind={notice.kind}>
      {body}
    </FloatingNotice>
  ) : (
    <div data-testid="start-work-notice" data-kind={notice.kind}>
      {body}
    </div>
  );
}
