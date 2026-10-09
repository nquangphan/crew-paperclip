// crew: tự dựng
import type { DocsCheckResult } from '@crew/paperclip-plugin/shared/docs-tree';
import type { CrewMap, CrewRoot } from '@crew/paperclip-plugin/shared/map';
import { useT } from '@/i18n';
import { Button } from '../../components/button';
import { resolveStageKey, StageBadge } from '../stage-badge';
import { StatusBadge } from '../status-badge';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type DocsCheck = DocsCheckResult | null | undefined;

function docsState(docs: DocsCheck): 'none' | 'invalid' | 'pass' | 'fail' {
  if (!docs) return 'none';
  if (docs.invalid) return 'invalid';
  return docs.exit === 0 ? 'pass' : 'fail';
}

/** Một dòng: "Crew · 1/4 con xong · <giai đoạn của issue> · docs Đạt". */
function crewSummaryLine(map: CrewMap, issueId: string, docs: DocsCheck, t: Translate): string {
  const children = map.nodes.filter((node) => node.parentId === map.root.id);
  const done = children.filter((node) => node.status === 'done').length;
  const current = map.nodes.find((node) => node.id === issueId) ?? map.root;
  const stage = current.stage
    ? t(`stage.${resolveStageKey(current.stage, current.kind)}`)
    : t(`status.${current.status}`, { defaultValue: current.status });
  return [
    t('crewSummary.name'),
    t('crewSummary.children', { done, total: children.length }),
    stage,
    t('crewSummary.docsLine', { state: t(`crewSummary.docs.${docsState(docs)}`) }),
  ].join(' · ');
}

interface CrewSummaryProps {
  /** Tóm tắt một yêu cầu: cần `map` và `issueId` (issue đang xem). */
  map?: CrewMap;
  issueId?: string;
  /** Danh sách yêu cầu gốc (`crew.roots`) khi không có `map`. */
  roots?: CrewRoot[];
  docsCheck: DocsCheck;
  expanded?: boolean;
  onToggleMap: () => void;
}

function CrewSummary({ map, issueId, roots, docsCheck, expanded = false, onToggleMap }: CrewSummaryProps) {
  const { t } = useT();
  if (map) {
    return (
      <section aria-label={t('crewSummary.label')} className="flex flex-wrap items-center gap-2 text-sm">
        <p>{crewSummaryLine(map, issueId ?? map.root.id, docsCheck, t)}</p>
        <Button type="button" variant="outline" size="sm" aria-expanded={expanded} onClick={onToggleMap}>
          {expanded ? t('crewSummary.close') : t('crewSummary.open')}
        </Button>
      </section>
    );
  }
  if (!roots?.length) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('crewSummary.empty')}
      </p>
    );
  }
  return (
    <ul aria-label={t('crewSummary.label')} className="flex flex-col divide-y text-sm">
      {roots.map((root) => (
        <li key={root.id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="font-medium">{`${root.identifier} · ${root.title}`}</span>
          <StatusBadge status={root.status} />
          <StageBadge stage={resolveStageKey(root.stage, root.kind)} />
          <span className="text-muted-foreground" title={t('crewSummary.rootProgress')}>
            {`${root.doneChildren}/${root.totalChildren}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export type { CrewSummaryProps };
export { CrewSummary, crewSummaryLine };
