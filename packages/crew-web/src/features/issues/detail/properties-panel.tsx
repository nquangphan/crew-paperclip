// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import type * as React from 'react';
import { useMe } from '@/app/hooks';
import {
  Badge,
  ProjectTag,
  PropertyChip,
  PropertyEmpty,
  PropertyRow,
  PropertySection,
  StatusGlyph,
  StatusLabel,
} from '@/ds';
import { formatDateTime, useT } from '@/i18n';
import { IssueLink } from '../popup/issue-nav';
import { RuntimeSlot } from './crew/runtime-slot';
import type { ChildSummary } from './use-issue';

const DEFAULT_MAX_ROUNDS = 5;
const MODEL_LINE =
  /^crew-model complexity=(\S+) model=(\S+) effort=(\S+)(?: runtime=(claude_local|codex_local|opencode_local))?/m;

/** Dòng `crew-model …` Trợ Lý ghi vào mô tả khi tách việc. Không có `runtime=` thì là claude_local. */
export function parseCrewModel(description: string | null | undefined) {
  const m = MODEL_LINE.exec(description ?? '');
  return m ? { complexity: m[1], model: m[2], effort: m[3], runtime: m[4] ?? 'claude_local' } : null;
}

interface PropertiesPanelProps {
  issue: Issue;
  agentNames: Record<string, string>;
  projectName: string | null;
  childIssues: ChildSummary[];
  /** Lần Ép Done mới nhất còn hiệu lực (sau lần mở lại gần nhất): hiện badge "Đã ép Done" cạnh trạng thái. */
  forcedDone?: boolean;
}

interface IssueRef {
  id: string;
  identifier: string | null;
  title: string;
  status?: string;
}

/**
 * Cột Thuộc tính chỉ đọc (S6.13), chia nhóm như cột Properties của Paperclip (Công việc, Liên kết, Thực thi,
 * Thông tin). Không có control sửa nào: các nút chọn trạng thái/người làm/người duyệt/nhãn của Paperclip bị bỏ
 * (BA mục 2: freeStatus, freeAssignee, pickReviewers, editRelations).
 */
export function PropertiesPanel({
  issue,
  agentNames,
  projectName,
  childIssues,
  forcedDone = false,
}: PropertiesPanelProps) {
  const { t, lang } = useT('issues');
  const me = useMe();
  const none = <PropertyEmpty>{t('detail.props.none')}</PropertyEmpty>;
  const issueChip = (i: IssueRef) => (
    <PropertyChip key={i.id}>
      {i.status ? <StatusGlyph status={i.status} size="sm" /> : null}
      <IssueLink identifier={i.identifier ?? i.id}>
        <span title={i.title}>{i.identifier ?? i.id}</span>
      </IssueLink>
    </PropertyChip>
  );
  const chips = (refs: IssueRef[]) =>
    refs.length ? <span className="flex flex-wrap items-center gap-1">{refs.map(issueChip)}</span> : none;
  const stack = (nodes: React.ReactNode[]) => (nodes.length ? <span className="flex flex-col">{nodes}</span> : none);
  const person = (p: { type: 'agent' | 'user'; agentId?: string | null; userId?: string | null }) =>
    p.type === 'agent'
      ? (agentNames[p.agentId ?? ''] ?? t('detail.comments.agent'))
      : p.userId === me.id
        ? t('detail.comments.you')
        : t('detail.props.owner');
  const when = (value: Date | string | null | undefined) => (value ? formatDateTime(value, lang) : none);

  const policy = issue.executionPolicy;
  const state = issue.executionState;
  const model = parseCrewModel(issue.description);
  const isResearch = (issue.labels ?? []).some((l) => l.name === 'research');
  const assignee = issue.assigneeAgentId
    ? (agentNames[issue.assigneeAgentId] ?? t('detail.comments.agent'))
    : issue.assigneeUserId
      ? person({ type: 'user', userId: issue.assigneeUserId })
      : null;

  return (
    <div data-testid="properties-panel" className="flex flex-col">
      <PropertySection title={t('detail.props.section.work')} first>
        <PropertyRow label={t('detail.props.status')}>
          <span className="flex flex-wrap items-center gap-2">
            <StatusLabel
              status={issue.status}
              label={t(`status.${issue.status}`, { ns: 'common', defaultValue: issue.status })}
            />
            {forcedDone ? <Badge variant="destructive">{t('history.forcedBadge')}</Badge> : null}
          </span>
        </PropertyRow>
        <PropertyRow label={t('detail.props.assignee')}>
          {assignee ?? <PropertyEmpty>{t('detail.props.unassigned')}</PropertyEmpty>}
        </PropertyRow>
        <PropertyRow label={t('detail.props.project')}>
          {projectName ? <ProjectTag name={projectName} /> : none}
        </PropertyRow>
        <PropertyRow label={t('detail.props.kind')}>
          {isResearch ? t('detail.props.kindResearch') : t('detail.props.kindCode')}
        </PropertyRow>
        <PropertyRow label={t('detail.props.model')} wrap>
          {model ? t('detail.props.modelValue', { ...model, runtime: t(`crew.runtime.name.${model.runtime}`) }) : none}
        </PropertyRow>
      </PropertySection>
      <PropertySection title={t('detail.props.section.relations')}>
        <PropertyRow label={t('detail.props.parent')} wrap>
          {issue.ancestors?.[0] ? chips([issue.ancestors[0]]) : none}
        </PropertyRow>
        <PropertyRow label={t('detail.props.blockedBy')} wrap>
          {chips(issue.blockedBy ?? [])}
        </PropertyRow>
        <PropertyRow label={t('detail.props.children')} wrap>
          {chips(childIssues)}
        </PropertyRow>
      </PropertySection>
      <PropertySection title={t('detail.props.section.execution')}>
        <PropertyRow label={t('detail.props.stages')} wrap>
          {stack(
            (policy?.stages ?? []).map((stage) => (
              <span key={stage.id}>
                {t(`detail.props.stageType.${stage.type}`)}: {stage.participants.map(person).join(', ')}
                {state?.currentStageId === stage.id ? ` (${t('detail.props.current')})` : ''}
              </span>
            )),
          )}
        </PropertyRow>
        <PropertyRow label={t('detail.props.round')}>
          {policy ? `${state?.changesRequestedCount ?? 0}/${policy.maxReviewRounds ?? DEFAULT_MAX_ROUNDS}` : none}
        </PropertyRow>
      </PropertySection>
      <RuntimeSlot issue={issue} />
      <PropertySection title={t('detail.props.section.about')}>
        <PropertyRow label={t('detail.props.started')}>{when(issue.startedAt)}</PropertyRow>
        <PropertyRow label={t('detail.props.completed')}>{when(issue.completedAt)}</PropertyRow>
        <PropertyRow label={t('detail.props.created')}>{when(issue.createdAt)}</PropertyRow>
        <PropertyRow label={t('detail.props.updated')}>{when(issue.updatedAt)}</PropertyRow>
      </PropertySection>
    </div>
  );
}
