// crew: tự dựng
// Chế độ Bảng của trang Yêu cầu (KanbanBoard của Paperclip): cùng dữ liệu, tìm kiếm và bộ lọc với danh sách, mỗi
// trạng thái một cột. Thẻ giữ phần Crew của dòng: chip giai đoạn và x/y con xong. Kéo thẻ sang cột khác gửi
// PATCH đổi trạng thái; thẻ sang cột mới ngay, server từ chối (vd. 422 vì cổng Crew chặn) thì thẻ về cột cũ và hiện
// nguyên văn câu lỗi, không tự thử lại. Người chỉ đọc không kéo được.
import type { CompactIssue } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, type CrewRoot, queryKeys } from '@/api';
import {
  ErrorState,
  KANBAN_BOARD_HIGH_VOLUME_THRESHOLD,
  KANBAN_COLD_STATUSES,
  KANBAN_COLUMN_DEFAULT_PAGE_SIZE,
  KanbanBoard,
  type KanbanCardData,
  RowNote,
  resolveStageKey,
  StageBadge,
} from '@/ds';
import { useT } from '@/i18n';
import type { useIssueOpener } from '../popup/issue-nav';
import { needsNextStep, subtreeLiveCounts } from './list-view';
import type { ListState } from './use-issues';

/** Mật độ thẻ và cột lạnh đang áp dụng; mật độ "tự động" gọn thẻ khi bảng quá nhiều thẻ. */
export function boardLayout(state: Pick<ListState, 'density' | 'lanes' | 'pageSize'>, cardCount: number) {
  const highVolume = cardCount > KANBAN_BOARD_HIGH_VOLUME_THRESHOLD;
  const compact = state.density === 'compact' || (state.density === 'auto' && highVolume);
  const collapsedStatuses: readonly string[] = state.lanes === 'collapsed' ? KANBAN_COLD_STATUSES : [];
  const customized =
    state.density !== 'auto' || state.lanes !== 'expanded' || state.pageSize !== KANBAN_COLUMN_DEFAULT_PAGE_SIZE;
  return { compact, collapsedStatuses, customized };
}

interface MoveError {
  identifier: string;
  message: string;
}

interface IssuesBoardProps {
  companyId: string;
  /** Yêu cầu đã lọc và sắp như danh sách. */
  issues: readonly CompactIssue[];
  state: ListState;
  rootsById: ReadonlyMap<string, CrewRoot>;
  agentName: ReadonlyMap<string, string>;
  live: ReadonlySet<string>;
  opener: ReturnType<typeof useIssueOpener>;
  readOnly: boolean;
}

export function IssuesBoard({
  companyId,
  issues,
  state,
  rootsById,
  agentName,
  live,
  opener,
  readOnly,
}: IssuesBoardProps) {
  const { t } = useT('issues');
  const { t: tc } = useT();
  const qc = useQueryClient();
  // Trạng thái vừa kéo tới, giữ tới khi server nhận và danh sách tải lại; lỗi thì bỏ để thẻ về cột cũ.
  const [moved, setMoved] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<MoveError | null>(null);

  const forget = (id: string) =>
    setMoved((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

  const move = useMutation({
    mutationFn: ({ issue, status }: { issue: CompactIssue; status: string }) => api.issues.update(issue.id, { status }),
    onMutate: ({ issue, status }) => {
      setError(null);
      setMoved((prev) => new Map(prev).set(issue.id, status));
    },
    onError: (err, { issue }) => {
      forget(issue.id);
      setError({ identifier: issue.identifier ?? issue.id, message: err.message });
    },
    onSuccess: async (_updated, { issue }) => {
      const keys = [queryKeys.issues(companyId), queryKeys.issue(issue.id), queryKeys.crew()];
      if (issue.identifier) keys.push(queryKeys.issue(issue.identifier));
      // Làm mới hỏng thì vẫn bỏ trạng thái tạm; lần tải sau đồng bộ lại.
      await Promise.allSettled(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
      forget(issue.id);
    },
  });

  const liveBelow = useMemo(() => subtreeLiveCounts(issues, live), [issues, live]);
  const { compact, collapsedStatuses } = boardLayout(state, issues.length);

  const cards = issues.map((issue): KanbanCardData => {
    const identifier = issue.identifier ?? issue.id;
    const root = rootsById.get(issue.id);
    return {
      id: issue.id,
      status: moved.get(issue.id) ?? issue.status,
      title: issue.title,
      identifier: issue.identifier ?? issue.id.slice(0, 8),
      href: opener.href(identifier),
      onOpen: () => opener.open(identifier),
      assigneeName: issue.assigneeAgentId ? agentName.get(issue.assigneeAgentId) : null,
      assigneeId: issue.assigneeAgentId,
      live: live.has(issue.id),
      liveBelow: liveBelow.get(issue.id) ?? 0,
      needsNextStep: needsNextStep(issue),
      meta: root ? (
        <>
          <StageBadge stage={resolveStageKey(root.stage, root.kind)} />
          {root.totalChildren > 0 ? (
            <RowNote>{t('list.progress', { done: root.doneChildren, total: root.totalChildren })}</RowNote>
          ) : null}
        </>
      ) : null,
    };
  });

  const byId = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <ErrorState title={t('board.moveFailed', { identifier: error.identifier })} message={error.message} />
      ) : null}
      <KanbanBoard
        cards={cards}
        compact={compact}
        collapsedStatuses={collapsedStatuses}
        pageSize={state.pageSize}
        canDrag={!readOnly}
        onMove={(id, status) => {
          const issue = byId.get(id);
          if (issue) move.mutate({ issue, status });
        }}
        labels={{
          status: (s) => tc(`status.${s}`, { defaultValue: s }),
          showMore: (count) => t('board.showMore', { count }),
          showing: (shown, total) => t('board.showing', { shown, total }),
          live: t('list.live'),
          liveBelow: (count) => t('board.liveBelow', { count }),
          nextStep: t('board.nextStep'),
          nextStepTitle: t('board.nextStepTitle'),
        }}
      />
    </div>
  );
}
