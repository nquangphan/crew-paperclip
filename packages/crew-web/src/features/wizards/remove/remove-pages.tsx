// Trang tiến độ gỡ project (`projects/remove?resume=<id>`) và gỡ agent (`agents/remove?resume=<id>`): bước theo setup
// run, "Chạy tiếp" khi lỗi (lần gỡ không bỏ được), cảnh báo checkout máy giữ lại kèm lệnh để owner tự gỡ.
import { Link, useSearchParams } from 'react-router-dom';
import { api, queryKeys, type RemoveAgentInput, type RemoveProjectInput, type SetupRun } from '@/api';
import { Alert, CodeBlock, PageHeader } from '@/ds';
import { useT } from '@/i18n';
import { companyHref } from '../resume';
import { type RunHooks, SetupProgress } from '../setup-progress';
import { removeAgentSteps, runRemoveAgent } from './remove-agent';
import { keptCheckouts, REMOVE_PROJECT_STEPS, runRemoveProject } from './remove-project';

function KeptNotice({ run }: { run: SetupRun }) {
  const { t } = useT('wizards');
  const kept = keptCheckouts(run);
  if (kept.length === 0) return null;
  // `-C`: owner chạy lệnh từ bất kỳ thư mục nào (ngoài repo thì `git worktree` báo "not a git repository").
  const commands = kept.filter((k) => k.path).map((k) => `git -C "${k.path}" worktree remove "${k.path}"`);
  return (
    <Alert variant="warning" title={t('remove.kept.title', { count: kept.length })}>
      <div className="flex flex-col gap-2">
        <ul>
          {kept.map((k) => (
            <li key={k.role}>
              {t('remove.kept.item', {
                role: t(`addAgent.slots.${k.role}`),
                reason: t(`remove.kept.reasons.${k.reason}`, { defaultValue: k.reason }),
                path: k.path,
              })}
            </li>
          ))}
        </ul>
        <p>{t('remove.kept.howTo')}</p>
        {commands.length > 0 ? <CodeBlock code={commands.join('\n')} label={t('remove.kept.commandLabel')} /> : null}
      </div>
    </Alert>
  );
}

const notice = (run: SetupRun) => <KeptNotice run={run} />;

const hooksCtx = (hooks: RunHooks) => ({ api, t: hooks.t, onStep: hooks.onStep, onRun: hooks.onRun });

export function RemoveProjectPage() {
  const { t } = useT('wizards');
  const [params] = useSearchParams();
  const runId = params.get('resume');
  return (
    <>
      <PageHeader title={t('removeProject.title')} description={t('removeProject.description')} />
      {runId ? (
        <SetupProgress
          key={runId}
          runId={runId}
          kind="remove-project"
          prefix="removeProject"
          steps={REMOVE_PROJECT_STEPS}
          run={(hooks, run) => runRemoveProject(hooksCtx(hooks), run)}
          invalidate={(run) => [
            queryKeys.projects(run.companyId),
            queryKeys.agents(run.companyId),
            queryKeys.environments(run.companyId),
            ...(run.projectId ? [queryKeys.roles(run.projectId), queryKeys.project(run.projectId)] : []),
          ]}
          notice={notice}
          summary={(run) =>
            t('removeProject.summary', { name: (run.input as RemoveProjectInput).projectName, key: run.projectKey })
          }
          done={(_run, prefix) => (
            <Alert title={t('removeProject.done')}>
              <Link to={companyHref(prefix, 'projects')}>{t('removeProject.openProjects')}</Link>
            </Alert>
          )}
        />
      ) : (
        <Alert variant="warning" title={t('remove.noRun')} />
      )}
    </>
  );
}

export function RemoveAgentPage() {
  const { t } = useT('wizards');
  const [params] = useSearchParams();
  const runId = params.get('resume');
  return (
    <>
      <PageHeader title={t('removeAgent.title')} description={t('removeAgent.description')} />
      {runId ? (
        <SetupProgress
          key={runId}
          runId={runId}
          kind="remove-agent"
          prefix="removeAgent"
          steps={removeAgentSteps}
          run={(hooks, run) => runRemoveAgent(hooksCtx(hooks), run)}
          invalidate={(run) => {
            const input = run.input as RemoveAgentInput;
            return [
              queryKeys.agents(run.companyId),
              queryKeys.environments(run.companyId),
              ...(input.projectId ? [queryKeys.roles(input.projectId)] : []),
              ['agent'],
            ];
          }}
          notice={notice}
          summary={(run) => {
            const input = run.input as RemoveAgentInput;
            return input.role
              ? t('removeAgent.summary', {
                  name: input.agentName,
                  slot: t(`addAgent.slots.${input.role}`),
                  key: run.projectKey,
                })
              : t('removeAgent.summaryNoRole', { name: input.agentName });
          }}
          done={(run, prefix) => (
            <Alert title={t('removeAgent.done')}>
              <Link to={companyHref(prefix, `agents/${(run.input as RemoveAgentInput).agentId}`)}>
                {t('removeAgent.openAgent')}
              </Link>
            </Alert>
          )}
        />
      ) : (
        <Alert variant="warning" title={t('remove.noRun')} />
      )}
    </>
  );
}
