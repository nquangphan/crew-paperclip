// crew: tự dựng
import { useT } from '@/i18n';
import { Badge } from '../components/badge';

type StageKey =
  | 'none'
  | 'notStarted'
  | 'reviewer'
  | 'integratorMerge'
  | 'owner'
  | 'integratorPush'
  | 'done'
  | 'unknown';

interface StageInput {
  currentType: string | null;
  completed: string[];
  position: number | null;
}

/** Suy khóa giai đoạn từ `stage` của `crew.roots`/`crew.map` (cùng quy tắc nhãn với map của plugin). */
function resolveStageKey(stage: StageInput | null | undefined, kind?: string | null): StageKey {
  if (!stage) return 'none';
  if (!stage.currentType) return stage.completed.length ? 'done' : 'notStarted';
  if (stage.position === null) return 'unknown';
  const order: StageKey[] =
    kind === 'research' ? ['reviewer', 'owner'] : ['reviewer', 'integratorMerge', 'owner', 'integratorPush'];
  return order[stage.position] ?? (stage.currentType === 'approval' ? 'owner' : 'reviewer');
}

interface StageBadgeProps {
  stage: StageKey;
  round?: number;
  maxRounds?: number;
}

function StageBadge({ stage, round, maxRounds }: StageBadgeProps) {
  const { t } = useT();
  const showRound = round !== undefined && maxRounds !== undefined && stage !== 'none';
  return (
    <span className="inline-flex items-center gap-1" data-slot="stage-badge" data-stage={stage}>
      <Badge variant="outline">{t(`stage.${stage}`)}</Badge>
      {showRound ? <Badge variant="secondary">{t('stage.round', { round, max: maxRounds })}</Badge> : null}
    </span>
  );
}

export type { StageBadgeProps, StageInput, StageKey };
export { resolveStageKey, StageBadge };
