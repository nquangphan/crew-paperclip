// Tab Hướng dẫn (S11.2): xem AGENTS.md chỉ đọc và "Render lại theo vai trò". Render lại dùng template của vai trò agent
// đang giữ (Trợ Lý thì kèm danh sách executor của project) rồi PUT có baseHash; xung đột 409 báo, không ghi đè.
import type { Agent } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, queryKeys } from '@/api';
import { Button, CardDescription, ErrorState, MarkdownView, Spinner } from '@/ds';
import { syncAssistantInstructions } from '@/features/projects/detail/use-save-roles';
import { useT } from '@/i18n';
import { INSTRUCTIONS_PATH, putInstructions, renderInstructions } from '@/lib/instructions';
import { type AgentHolding, useAgentHoldings } from '../use-agent-roles';

type Outcome = 'ok' | 'unchanged' | 'conflict';

/** Agent giữ nhiều vai trò thì ưu tiên Trợ Lý (file của Trợ Lý là file duy nhất có phần riêng theo project). */
export function pickHolding(holdings: AgentHolding[]): AgentHolding | null {
  return holdings.find((h) => h.role === 'assistant') ?? holdings[0] ?? null;
}

async function renderAgain(agent: Agent, companyId: string, holding: AgentHolding): Promise<Outcome> {
  if (holding.role === 'assistant') return syncAssistantInstructions(api, companyId, holding.roles);
  const content = renderInstructions(holding.role, { agentId: agent.id });
  const res = await putInstructions(api, agent.id, content, { companyId });
  if (!res.ok) return 'conflict';
  return res.changed ? 'ok' : 'unchanged';
}

export function InstructionsTab({ agent, companyId }: { agent: Agent; companyId: string }) {
  const { t } = useT('agents');
  const queryClient = useQueryClient();
  const { byAgent, isLoading: holdingsLoading } = useAgentHoldings();
  const holding = pickHolding(byAgent.get(agent.id) ?? []);
  const key = queryKeys.agentInstructions(agent.id);
  const file = useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return await api.agents.instructionsFile(agent.id, INSTRUCTIONS_PATH, companyId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  const render = useMutation({
    mutationFn: () => {
      if (!holding) throw new Error(t('instructions.noRole'));
      return renderAgain(agent, companyId, holding);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew('readiness') });
    },
  });

  if (file.isLoading) return <Spinner />;
  if (file.error) {
    return (
      <ErrorState
        title={t('instructions.loadFailed')}
        message={file.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void file.refetch()}
      />
    );
  }
  const outcome = render.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={!holding || holdingsLoading || render.isPending}
          onClick={() => render.mutate()}
        >
          {t('instructions.render')}
        </Button>
        {!holding && !holdingsLoading ? <CardDescription>{t('instructions.noRole')}</CardDescription> : null}
        {outcome === 'ok' ? <CardDescription>{t('instructions.rendered')}</CardDescription> : null}
        {outcome === 'unchanged' ? <CardDescription>{t('instructions.unchanged')}</CardDescription> : null}
      </div>
      {outcome === 'conflict' ? (
        <ErrorState
          title={t('instructions.conflict')}
          message={t('instructions.conflictHint')}
          retryLabel={t('instructions.reload')}
          onRetry={() => {
            render.reset();
            void file.refetch();
          }}
        />
      ) : null}
      {render.error ? <ErrorState title={t('instructions.renderFailed')} message={render.error.message} /> : null}
      {file.data ? (
        <MarkdownView markdown={file.data.content} />
      ) : (
        <CardDescription>{t('instructions.missing')}</CardDescription>
      )}
    </div>
  );
}
