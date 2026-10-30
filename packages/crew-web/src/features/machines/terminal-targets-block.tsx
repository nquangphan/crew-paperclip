// Khối "Terminal" trên trang Máy (chỉ owner): dự án đã dựng xong (`ready`) trên từng máy, nhóm theo máy. Mỗi dự án có
// link mở trang terminal ở tab mới để mở nhiều dự án cùng lúc; mật khẩu mở khoá hỏi ở trang terminal.
import { useQuery } from '@tanstack/react-query';
import { type TerminalTarget, terminalApi } from '@/api/crew/terminal';
import { queryKeys } from '@/api/queryKeys';
import { companyPath } from '@/app/routes-util';
import { Alert, Button, MutedText, Section, SectionHeading, Spinner } from '@/ds';
import { useT } from '@/i18n';

interface TerminalTargetsBlockProps {
  companyId: string;
  companyPrefix: string;
}

/** Nhóm theo máy, giữ thứ tự server trả. */
function groupByMachine(
  targets: readonly TerminalTarget[],
): { machineId: string; hostname: string; items: TerminalTarget[] }[] {
  const groups = new Map<string, { machineId: string; hostname: string; items: TerminalTarget[] }>();
  for (const target of targets) {
    const group = groups.get(target.machineId) ?? { machineId: target.machineId, hostname: target.hostname, items: [] };
    group.items.push(target);
    groups.set(target.machineId, group);
  }
  return [...groups.values()];
}

export function TerminalTargetsBlock({ companyId, companyPrefix }: TerminalTargetsBlockProps) {
  const { t } = useT('machines');
  const targets = useQuery({
    queryKey: queryKeys.terminalTargets(companyId),
    queryFn: () => terminalApi.targets(companyId),
  });
  const groups = groupByMachine(targets.data ?? []);

  return (
    <Section title={t('terminal.title')}>
      {targets.isLoading ? <Spinner /> : null}
      {targets.error ? (
        <Alert variant="destructive" title={t('terminal.loadFailed')}>
          {targets.error.message}
        </Alert>
      ) : null}
      {targets.data && groups.length === 0 ? <MutedText>{t('terminal.empty')}</MutedText> : null}
      {groups.map((group) => (
        // biome-ignore lint/a11y/useSemanticElements: nhóm có tên máy làm nhãn, fieldset kéo theo viền và lề mặc định.
        <div key={group.machineId} role="group" aria-label={group.hostname} className="flex flex-col gap-2">
          <SectionHeading>{group.hostname}</SectionHeading>
          {group.items.map((item) => (
            <div key={item.projectId} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{item.projectName}</span>
                <MutedText>{item.projectKey}</MutedText>
              </div>
              <Button asChild variant="outline" size="sm">
                <a
                  href={companyPath(companyPrefix, `terminal/${item.machineId}/${item.projectId}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('terminal.open')}
                </a>
              </Button>
            </div>
          ))}
        </div>
      ))}
    </Section>
  );
}
