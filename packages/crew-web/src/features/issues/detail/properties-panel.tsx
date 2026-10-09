// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { Link } from 'react-router-dom';
import { useCompany, useMe } from '@/app/hooks';
import { Card, CardContent, CardHeader, CardTitle, type PropertyItem, PropertyList, StatusBadge } from '@/ds';
import { formatDateTime, useT } from '@/i18n';
import type { ChildSummary } from './use-issue';

const DEFAULT_MAX_ROUNDS = 5;
const MODEL_LINE = /^crew-model complexity=(\S+) model=(\S+) effort=(\S+)/m;

/** Dòng `crew-model …` Trợ Lý ghi vào mô tả khi tách việc. */
export function parseCrewModel(description: string | null | undefined) {
  const m = MODEL_LINE.exec(description ?? '');
  return m ? { complexity: m[1], model: m[2], effort: m[3] } : null;
}

interface PropertiesPanelProps {
  issue: Issue;
  agentNames: Record<string, string>;
  projectName: string | null;
  childIssues: ChildSummary[];
}

/** Thuộc tính chỉ đọc (S6.13): không có control sửa nào. */
export function PropertiesPanel({ issue, agentNames, projectName, childIssues }: PropertiesPanelProps) {
  const { t, lang } = useT('issues');
  const { company } = useCompany();
  const me = useMe();
  const none = t('detail.props.none');
  const issueLink = (i: { id: string; identifier: string | null; title: string }) => (
    <Link key={i.id} to={`/${company.issuePrefix}/issues/${i.identifier ?? i.id}`}>
      {i.identifier ?? i.id} · {i.title}
    </Link>
  );
  const stack = (nodes: React.ReactNode[]) => (nodes.length ? <span className="flex flex-col">{nodes}</span> : none);
  const person = (p: { type: 'agent' | 'user'; agentId?: string | null; userId?: string | null }) =>
    p.type === 'agent'
      ? (agentNames[p.agentId ?? ''] ?? t('detail.comments.agent'))
      : p.userId === me.id
        ? t('detail.comments.you')
        : t('detail.props.owner');

  const policy = issue.executionPolicy;
  const state = issue.executionState;
  const model = parseCrewModel(issue.description);
  const isResearch = (issue.labels ?? []).some((l) => l.name === 'research');
  const assignee = issue.assigneeAgentId
    ? (agentNames[issue.assigneeAgentId] ?? t('detail.comments.agent'))
    : issue.assigneeUserId
      ? person({ type: 'user', userId: issue.assigneeUserId })
      : t('detail.props.unassigned');

  const items: PropertyItem[] = [
    { label: t('detail.props.status'), value: <StatusBadge status={issue.status} /> },
    { label: t('detail.props.assignee'), value: assignee },
    { label: t('detail.props.project'), value: projectName ?? none },
    { label: t('detail.props.kind'), value: isResearch ? t('detail.props.kindResearch') : t('detail.props.kindCode') },
    { label: t('detail.props.parent'), value: issue.ancestors?.[0] ? issueLink(issue.ancestors[0]) : none },
    { label: t('detail.props.children'), value: stack(childIssues.map(issueLink)) },
    { label: t('detail.props.blockedBy'), value: stack((issue.blockedBy ?? []).map(issueLink)) },
    {
      label: t('detail.props.stages'),
      value: stack(
        (policy?.stages ?? []).map((stage) => (
          <span key={stage.id}>
            {t(`detail.props.stageType.${stage.type}`)}: {stage.participants.map(person).join(', ')}
            {state?.currentStageId === stage.id ? ` (${t('detail.props.current')})` : ''}
          </span>
        )),
      ),
    },
    {
      label: t('detail.props.round'),
      value: policy ? `${state?.changesRequestedCount ?? 0}/${policy.maxReviewRounds ?? DEFAULT_MAX_ROUNDS}` : none,
    },
    {
      label: t('detail.props.model'),
      value: model ? t('detail.props.modelValue', model) : none,
    },
    { label: t('detail.props.created'), value: formatDateTime(issue.createdAt, lang) },
    { label: t('detail.props.updated'), value: formatDateTime(issue.updatedAt, lang) },
    { label: t('detail.props.started'), value: formatDateTime(issue.startedAt, lang) },
    { label: t('detail.props.completed'), value: formatDateTime(issue.completedAt, lang) },
  ];

  return (
    <Card data-testid="properties-panel">
      <CardHeader>
        <CardTitle>{t('detail.props.heading')}</CardTitle>
      </CardHeader>
      <CardContent>
        <PropertyList items={items} />
      </CardContent>
    </Card>
  );
}
