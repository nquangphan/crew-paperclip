// Khối "Terminal" trên trang Máy (chỉ owner): dự án đã dựng xong (`ready`) trên từng máy, nhóm theo máy. Mỗi dự án có
// nút mở khung nổi terminal (góc dưới bên phải) ở đúng dự án đó; mật khẩu mở khoá hỏi trong khung.
import { useQuery } from '@tanstack/react-query';
import { terminalApi } from '@/api/crew/terminal';
import { queryKeys } from '@/api/queryKeys';
import { Alert, Button, MutedText, Section, SectionHeading, Spinner } from '@/ds';
import { groupTargetsByMachine } from '@/features/terminal/target-switcher';
import { useTerminalDock } from '@/features/terminal/terminal-dock';
import { useT } from '@/i18n';

interface TerminalTargetsBlockProps {
  companyId: string;
}

export function TerminalTargetsBlock({ companyId }: TerminalTargetsBlockProps) {
  const { t } = useT('machines');
  const targets = useQuery({
    queryKey: queryKeys.terminalTargets(companyId),
    queryFn: () => terminalApi.targets(companyId),
  });
  const dock = useTerminalDock();
  const groups = groupTargetsByMachine(targets.data ?? []);

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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!dock}
                onClick={() => dock?.open({ machineId: item.machineId, projectId: item.projectId })}
              >
                {t('terminal.open')}
              </Button>
            </div>
          ))}
        </div>
      ))}
    </Section>
  );
}
