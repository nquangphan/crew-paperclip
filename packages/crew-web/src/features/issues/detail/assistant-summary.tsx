// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { MarkdownView, SummaryPanel } from '@/ds';
import { Sparkles } from '@/ds/icons';
import { useT } from '@/i18n';
import { splitAssistantSummary } from './split-assistant-summary';

/**
 * Mục "Tổng kết của Trợ Lý" tách khỏi mô tả: khối riêng ngay sau mô tả, không thu gọn (owner đọc toàn bộ). Mô tả không
 * có mục này thì không render gì.
 */
export function AssistantSummary({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const { summary } = splitAssistantSummary(issue.description);
  if (summary === null) return null;
  return (
    <SummaryPanel
      data-testid="assistant-summary"
      title={t('detail.assistantSummary.title')}
      icon={<Sparkles aria-hidden />}
    >
      {summary ? <MarkdownView markdown={summary} /> : null}
    </SummaryPanel>
  );
}
