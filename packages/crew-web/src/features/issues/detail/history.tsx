// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useMe } from '@/app/hooks';
import { Badge, DetailSection, ErrorState, MutedText, Skeleton } from '@/ds';
import { useT } from '@/i18n';
import { buildHistory, type HistoryEntry } from './history-format';
import { useIssueActivity } from './use-issue';

/**
 * Khối Lịch sử (S6.18) ở cột Thuộc tính: hoạt động của yêu cầu, mới nhất trước, giờ Asia/Ho_Chi_Minh. Lần Ép Done
 * (và board đóng vượt cổng) hiện nổi bật với lý do và các cổng bị bỏ qua đã dịch thành câu.
 */
export function History({ issue, agentNames }: { issue: Issue; agentNames: Record<string, string> }) {
  const { t, lang } = useT('issues');
  const me = useMe();
  const list = useIssueActivity(issue.id);

  const person = (p: { type?: string; agentId?: string | null; userId?: string | null }) =>
    p.type === 'agent'
      ? (agentNames[p.agentId ?? ''] ?? t('history.actor.agent'))
      : p.userId === me.id
        ? t('history.actor.you')
        : t('history.actor.owner');
  const stageName = (stageId: string): string | null => {
    const stage = issue.executionPolicy?.stages.find((s) => s.id === stageId);
    if (!stage) return null;
    const type = t(`detail.props.stageType.${stage.type}`, { defaultValue: stage.type });
    const who = stage.participants.map(person).join(', ');
    return who ? `${type} (${who})` : type;
  };
  const actorName = (a: HistoryEntry['actor']): string => {
    if (a.type === 'user') return person({ type: 'user', userId: a.id });
    if (a.type === 'agent') return person({ type: 'agent', agentId: a.id });
    return t(`history.actor.${a.type}`);
  };
  const rows = list.data ? buildHistory(list.data, { t, lang, stageName }) : [];

  return (
    <DetailSection title={t('history.heading')} count={list.data ? rows.length : undefined}>
      {list.isLoading ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState title={t('history.loadFailed')} message={list.error.message} onRetry={() => void list.refetch()} />
      ) : null}
      {list.data && rows.length === 0 ? <MutedText>{t('history.empty')}</MutedText> : null}
      {rows.map((row) => (
        <div key={row.id} data-testid="history-row" className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {row.forced ? <Badge variant="destructive">{t('history.forced')}</Badge> : null}
            <span>{row.text}</span>
          </div>
          <MutedText>
            {actorName(row.actor)} · {row.time}
          </MutedText>
          {row.reason ? <MutedText>{t('history.reason', { reason: row.reason })}</MutedText> : null}
          {row.skipped.length > 0 ? (
            <MutedText>{t('history.skipped', { list: row.skipped.join(', ') })}</MutedText>
          ) : null}
        </div>
      ))}
    </DetailSection>
  );
}
