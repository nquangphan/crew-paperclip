// Tab Sẵn sàng (S8.5): danh sách kiểm P1-P2 của project và A1-A7 của từng agent trong vai trò; mục hỏng có "Làm tiếp".
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Spinner } from '@/ds';
import { useProjectReadiness } from '@/features/readiness';
import { useT } from '@/i18n';
import { resumeHref } from '../paths';

export function ReadinessTab({ projectId }: { projectId: string }) {
  const { t } = useT('projects');
  const { company } = useCompany();
  const readiness = useProjectReadiness(company.id, api);
  const agents = useQuery({ queryKey: queryKeys.agents(company.id), queryFn: () => api.agents.list(company.id) });
  if (readiness.isLoading) return <Spinner />;
  if (readiness.error) {
    return <ErrorState title={t('readiness.loadFailed')} message={readiness.error.message} />;
  }
  const entry = readiness.data?.find((p) => p.projectId === projectId);
  if (!entry) return <CardDescription>{t('readiness.allOk')}</CardDescription>;
  const nameOf = new Map((agents.data ?? []).map((a) => [a.id, a.name]));
  const agentFailures = entry.agents.filter((a) => a.failed.length > 0);
  if (entry.failed.length === 0 && agentFailures.length === 0) {
    return <CardDescription>{t('readiness.allOk')}</CardDescription>;
  }
  return (
    <div className="flex flex-col gap-4">
      {entry.failed.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('readiness.project')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {entry.failed.map((item) => (
                <li key={item.id}>{t(`readiness:${item.detail}`, { defaultValue: item.id })}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {agentFailures.map((agent) => (
        <Card key={agent.agentId}>
          <CardHeader>
            <CardTitle>
              {nameOf.has(agent.agentId)
                ? t('readiness.agentOf', { name: nameOf.get(agent.agentId) })
                : t('readiness.unknownAgent', { id: agent.agentId })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {agent.failed.map((item) => {
                const href = resumeHref(company.issuePrefix, item.resume);
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3">
                    <span>{t(`readiness:${item.detail}`, { defaultValue: item.id })}</span>
                    {href ? (
                      <Button asChild variant="outline" size="sm">
                        <Link to={href}>{t('resume')}</Link>
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
