// Tab Skills (S11.3): bật/tắt skill company cho agent. Mỗi lần bật/tắt gửi toàn bộ danh sách mong muốn mới
// (POST /agents/:id/skills/sync mode replace). Skill ngoài company (chỉ đọc) không đổi được.
import type { Agent, AgentSkillSnapshot } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import {
  Badge,
  CardDescription,
  EmptyState,
  ErrorState,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleSwitch,
} from '@/ds';
import { useT } from '@/i18n';

export function SkillsTab({ agent, companyId }: { agent: Agent; companyId: string }) {
  const { t } = useT('agents');
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: queryKeys.agentSkills(agent.id),
    queryFn: () => api.agents.skills(agent.id, companyId),
  });
  const sync = useMutation({
    mutationFn: (desired: string[]) => api.agents.syncSkills(agent.id, desired, 'replace', companyId),
    onSuccess: (saved: AgentSkillSnapshot) => queryClient.setQueryData(queryKeys.agentSkills(agent.id), saved),
  });

  if (snapshot.isLoading) return <Spinner />;
  if (snapshot.error || !snapshot.data) {
    return (
      <ErrorState
        title={t('skills.loadFailed')}
        message={snapshot.error?.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void snapshot.refetch()}
      />
    );
  }
  const data = snapshot.data;
  if (!data.supported) return <CardDescription>{t('skills.unsupported')}</CardDescription>;
  if (data.entries.length === 0) return <EmptyState title={t('skills.empty')} description={t('skills.emptyHint')} />;
  const toggle = (key: string, on: boolean) =>
    sync.mutate(
      on ? [...data.desiredSkills.filter((k) => k !== key), key] : data.desiredSkills.filter((k) => k !== key),
    );
  return (
    <div className="flex flex-col gap-2">
      <CardDescription>{t('skills.hint')}</CardDescription>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('skills.col.skill')}</TableHead>
            <TableHead>{t('skills.col.state')}</TableHead>
            <TableHead>{t('skills.col.enabled')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.entries.map((entry) => {
            const locked = !entry.managed || entry.readOnly === true;
            return (
              <TableRow key={entry.key}>
                <TableCell>{locked ? `${entry.key} (${t('skills.readOnly')})` : entry.key}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`skills.state.${entry.state}`, { defaultValue: entry.state })}</Badge>
                </TableCell>
                <TableCell>
                  <ToggleSwitch
                    aria-label={entry.key}
                    checked={entry.desired}
                    disabled={locked || sync.isPending}
                    onCheckedChange={(on) => toggle(entry.key, on)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {sync.error ? <ErrorState title={t('skills.syncFailed')} message={sync.error.message} /> : null}
    </div>
  );
}
