// crew: tự dựng
import type { DocsCheckResult } from '@crew/paperclip-plugin/shared/docs-tree';
import { formatDateTime, useT } from '@/i18n';

interface DocsCheckPanelProps {
  /** Kết quả `crew.docsCheck`; null/undefined khi issue chưa có bằng chứng. */
  result: DocsCheckResult | null | undefined;
}

/** Kết quả kiểm docs của một yêu cầu Crew. Giờ hiển thị theo Asia/Ho_Chi_Minh. */
function DocsCheckPanel({ result }: DocsCheckPanelProps) {
  const { t, lang } = useT();
  if (!result) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('docsCheck.empty')}
      </p>
    );
  }
  const verdict = result.invalid
    ? t('docsCheck.invalid')
    : result.exit === 0
      ? t('docsCheck.pass')
      : t('docsCheck.fail', { exit: result.exit });
  return (
    <section aria-label={t('docsCheck.title')} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
      <h3 className="font-medium">{t('docsCheck.title')}</h3>
      <p className={result.invalid || result.exit !== 0 ? 'text-destructive' : undefined}>{verdict}</p>
      {result.invalid ? null : (
        <>
          <p className="font-mono text-xs break-all text-muted-foreground">
            {t('docsCheck.commit', { value: result.commit })}
          </p>
          <p className="font-mono text-xs break-all text-muted-foreground">
            {t('docsCheck.range', { value: result.range })}
          </p>
        </>
      )}
      <p className="text-muted-foreground">
        {t('docsCheck.author', { value: result.author ?? t('docsCheck.unknown') })}
      </p>
      <p className="text-muted-foreground">{t('docsCheck.at', { value: formatDateTime(result.at, lang) })}</p>
    </section>
  );
}

export type { DocsCheckPanelProps };
export { DocsCheckPanel };
