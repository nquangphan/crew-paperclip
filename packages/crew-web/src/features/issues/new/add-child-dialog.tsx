// crew: tự dựng
import type { CompactIssue, Issue } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, queryKeys } from '@/api';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Input,
} from '@/ds';
import { Plus } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';
import { childIssuesKey } from '../detail/use-issue';
import { IssueLink } from '../popup/issue-nav';
import {
  type AddChildBlock,
  type AddChildResult,
  AddChildStaleError,
  addChildAvailability,
  newAddChildProgress,
  runAddChild,
} from './add-child';
import { labelledKindOf } from './kinds';
import { AttachmentsField, DescriptionField } from './request-fields';
import { uploadAttachments } from './use-create-request';

/** Yêu cầu là gốc Crew khi bản đồ Crew của plugin lấy chính nó làm gốc (cùng query với tóm tắt Crew, dùng chung cache). */
function useIsCrewRoot(issue: Issue): boolean {
  const map = useQuery({
    queryKey: queryKeys.crew('crew.map', { companyId: issue.companyId, issueId: issue.id }),
    queryFn: () => api.crew.map(issue.companyId, issue.id),
  }).data;
  return !!map && !map.diagnostics.includes('not_crew_root') && map.root.id === issue.id;
}

/**
 * Nút "Thêm việc con" trên yêu cầu gốc Crew (trang chi tiết và popup), chỉ với người ghi được (owner, thành viên không
 * chỉ đọc). Ẩn khi yêu cầu đã xong hay đã hủy. Nháp hoặc đã qua bước Trợ Lý thì dialog giải thích thay cho form.
 * Thêm xong: việc con hiện ở "Yêu cầu con", bình luận báo Trợ Lý hiện trong luồng của yêu cầu gốc.
 */
export function AddChildAction({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const { readOnly } = useCompanyAccess();
  const crewRoot = useIsCrewRoot(issue);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<AddChildResult | null>(null);
  const availability = addChildAvailability(issue, crewRoot);
  if (readOnly || availability.kind === 'hidden') return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        size="sm"
        variant="outline"
        data-testid="add-child"
        onClick={() => {
          setAdded(null);
          setOpen(true);
        }}
      >
        <Plus aria-hidden />
        {t('addChild.button')}
      </Button>
      {added ? (
        <Alert variant="info" title={t('addChild.added', { identifier: added.child.identifier ?? added.child.id })}>
          <div className="flex flex-col items-start gap-2" data-testid="add-child-notice">
            <span>{t('addChild.addedBody')}</span>
            <IssueLink identifier={added.child.identifier ?? added.child.id}>{t('addChild.openChild')}</IssueLink>
            {added.failedUploads.length > 0 ? (
              <span>{t('addChild.failedUploads', { names: added.failedUploads.join(', ') })}</span>
            ) : null}
            <Button type="button" size="xs" variant="outline" onClick={() => setAdded(null)}>
              {t('addChild.dismiss')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addChild.title', { identifier: issue.identifier ?? issue.id })}</DialogTitle>
            <DialogDescription>{t('addChild.description')}</DialogDescription>
          </DialogHeader>
          {availability.kind === 'blocked' ? (
            <BlockedBody reason={availability.reason} onClose={() => setOpen(false)} />
          ) : (
            <AddChildForm
              issue={issue}
              onClose={() => setOpen(false)}
              onAdded={(result) => {
                setAdded(result);
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BlockedBody({ reason, onClose }: { reason: AddChildBlock; onClose: () => void }) {
  const { t } = useT('issues');
  return (
    <>
      <Alert variant="warning" title={t(`addChild.blocked.${reason}.title`)}>
        {t(`addChild.blocked.${reason}.body`)}
      </Alert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('addChild.close')}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Server lõi giữ kết quả danh sách issue dạng compact khoảng 2 giây cho mỗi người dùng và bộ lọc
 * (`ISSUE_LIST_SERVER_CACHE_TTL_MS`), nên tải lại danh sách ngay sau khi tạo có thể nhận bản cũ chưa có việc con.
 */
const LIST_CACHE_MS = 2_500;

/**
 * Làm mới những gì việc thêm con làm đổi: bản đồ Crew, bình luận và chính yêu cầu gốc ngay; việc con vừa tạo được chèn
 * ngay vào "Yêu cầu con", còn các danh sách issue tải lại sau khi cache danh sách của server hết hạn.
 */
function useRefreshAfterAdd(issue: Issue) {
  const qc = useQueryClient();
  return (child: Issue | null) => {
    const keys = [
      queryKeys.issue(issue.id),
      queryKeys.comments(issue.id),
      queryKeys.sidebarBadges(issue.companyId),
      queryKeys.crew(),
    ];
    if (issue.identifier) keys.push(queryKeys.issue(issue.identifier));
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    if (child) {
      // Issue đầy đủ là bản compact có thêm trường; hai trường compact bắt buộc có giá trị (null khi không có).
      const compact: CompactIssue = {
        ...child,
        activeRecoveryAction: child.activeRecoveryAction ?? null,
        successfulRunHandoff: child.successfulRunHandoff ?? null,
      };
      qc.setQueryData<CompactIssue[]>(childIssuesKey(issue.companyId, issue.id), (old) =>
        old && !old.some((c) => c.id === child.id) ? [...old, compact] : old,
      );
    }
    setTimeout(() => void qc.invalidateQueries({ queryKey: queryKeys.issues(issue.companyId) }), LIST_CACHE_MS);
  };
}

/**
 * Form chỉ có trong lúc dialog mở, nên đóng rồi mở lại là form trống và một lần thêm mới (khóa idempotent mới). Tiến độ
 * giữ trong form: tạo xong mà bình luận lỗi thì bấm lại chỉ gửi bình luận.
 */
function AddChildForm({
  issue,
  onClose,
  onAdded,
}: {
  issue: Issue;
  onClose: () => void;
  onAdded: (result: AddChildResult) => void;
}) {
  const { t } = useT('issues');
  const refresh = useRefreshAfterAdd(issue);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const progress = useRef(newAddChildProgress());
  const keys = useRef({
    idempotencyKey: `crew-add-child:${issue.id}:${crypto.randomUUID()}`,
    comment: crypto.randomUUID(),
  });
  const kind = labelledKindOf(issue.labels) ?? 'code';

  const add = useMutation({
    mutationFn: () =>
      runAddChild(
        {
          getRoot: () => api.issues.get(issue.id),
          create: (body) => api.issues.create(issue.companyId, body),
          upload: (issueId, list) => uploadAttachments(issue.companyId, issueId, list),
          comment: (body, clientRequestId) => api.comments.add(issue.id, body, undefined, clientRequestId),
        },
        {
          title,
          description,
          files,
          idempotencyKey: keys.current.idempotencyKey,
          commentRequestId: keys.current.comment,
          commentBody: (child) =>
            t('addChild.rootComment', { identifier: child.identifier ?? child.id, title: child.title }),
        },
        progress.current,
      ),
    onSuccess: (result) => {
      refresh(result.child);
      onAdded(result);
    },
    onError: () => refresh(progress.current.child),
  });

  const created = progress.current.child;
  const ready = title.trim() !== '' && !add.isPending;
  const error = add.error;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) add.mutate();
      }}
    >
      <Field label={t('new.titleLabel')} htmlFor="add-child-title">
        <Input
          id="add-child-title"
          value={title}
          disabled={created !== null}
          placeholder={t('new.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      {created === null ? (
        <>
          <DescriptionField
            id="add-child-description"
            value={description}
            onChange={setDescription}
            setFiles={setFiles}
          />
          <AttachmentsField files={files} setFiles={setFiles} />
        </>
      ) : null}

      <Field label={t('addChild.assignee')}>
        <p>{t('addChild.assigneeValue')}</p>
      </Field>
      <Field label={t('new.kind')}>
        <p>{t('addChild.kindValue', { kind: t(`new.kinds.${kind}`) })}</p>
      </Field>

      {error instanceof AddChildStaleError ? (
        <Alert variant="warning" title={t('addChild.staleTitle')}>
          {t(`addChild.stale.${error.reason}`, {
            status: t(`status.${error.status}`, { ns: 'common', defaultValue: error.status }),
          })}
        </Alert>
      ) : error && created ? (
        <Alert
          variant="destructive"
          title={t('addChild.partialTitle', { identifier: created.identifier ?? created.id })}
        >
          {t('addChild.partialBody', { message: error.message })}
        </Alert>
      ) : error ? (
        <ErrorState title={t('addChild.failed')} message={error.message} />
      ) : null}

      <DialogFooter className="items-center">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('new.cancel')}
        </Button>
        <Button type="submit" disabled={!ready || error instanceof AddChildStaleError}>
          {add.isPending ? t('addChild.adding') : created ? t('addChild.retryNotify') : t('addChild.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
