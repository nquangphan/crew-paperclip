// Tab Cấu hình chạy (S11.4): chỉ đọc adapter, command, extraArgs, environment, máy. Chỗ duy nhất sửa được là model
// (S11.5); không sửa command/extraArgs/env/adapter hay quyền.
import type { Agent } from '@paperclipai/shared';
import { Card, CardContent, CardHeader, CardTitle, PropertyList, Spinner } from '@/ds';
import { useT } from '@/i18n';
import { ModelSelect } from './model-select';
import { environmentLabel, useAgentEnvironment } from './use-agent-environment';

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

export function RuntimeTab({ agent, companyId }: { agent: Agent; companyId: string }) {
  const { t } = useT('agents');
  const { environment, machine, isLoading } = useAgentEnvironment(agent, companyId);
  if (isLoading) return <Spinner />;
  const config = agent.adapterConfig;
  const extraArgs = Array.isArray(config.extraArgs) ? config.extraArgs.map(String).join(' ') : '';
  const heartbeat = agent.runtimeConfig?.heartbeat as { enabled?: boolean; maxConcurrentRuns?: number } | undefined;
  const workspace = text(environment?.config?.remoteWorkspacePath);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('runtime.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PropertyList
            items={[
              { label: t('runtime.adapter'), value: agent.adapterType },
              { label: t('runtime.engine'), value: text(config.engine) ?? t('runtime.unknown') },
              { label: t('runtime.command'), value: text(config.command) ?? t('runtime.unknown') },
              { label: t('runtime.extraArgs'), value: extraArgs || t('runtime.none') },
              {
                label: t('runtime.concurrency'),
                value: t('runtime.concurrencyValue', { count: heartbeat?.maxConcurrentRuns ?? 1 }),
              },
              { label: t('runtime.heartbeat'), value: heartbeat?.enabled ? t('runtime.on') : t('runtime.off') },
              {
                label: t('runtime.environment'),
                value: environment ? environmentLabel(environment) : t('runtime.noEnvironment'),
              },
              { label: t('runtime.workspace'), value: workspace ?? t('runtime.unknown') },
              { label: t('runtime.machine'), value: machine?.hostname ?? t('runtime.unknown') },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <ModelSelect agent={agent} companyId={companyId} />
        </CardContent>
      </Card>
    </div>
  );
}
