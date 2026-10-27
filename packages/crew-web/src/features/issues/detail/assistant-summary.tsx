// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { MarkdownView } from '@/ds';
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
    <section
      data-testid="assistant-summary"
      aria-label={t('detail.assistantSummary.title')}
      className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-primary/5 px-4 py-3"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-primary">
        <Sparkles aria-hidden className="size-4" />
        {t('detail.assistantSummary.title')}
      </h2>
      {summary ? (
        <div className="text-sm break-words [&_h3]:mt-3 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-muted-foreground">
          <MarkdownView markdown={summary} />
        </div>
      ) : null}
    </section>
  );
}
