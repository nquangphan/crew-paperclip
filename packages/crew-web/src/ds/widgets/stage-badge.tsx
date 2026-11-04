// crew: tự dựng
import type * as React from 'react';
import { useT } from '@/i18n';
import { cn } from '../cn';
import { Badge } from '../components/badge';

type StageKey =
  | 'none'
  | 'notStarted'
  | 'reviewer'
  | 'integratorDocs'
  | 'owner'
  | 'integratorPush'
  | 'integratorPr'
  | 'bugFinding'
  | 'integratorMerge'
  | 'done'
  | 'unknown';

interface StageInput {
  currentType: string | null;
  completed: string[];
  position: number | null;
}

/**
 * Khóa giai đoạn theo vị trí stage trong policy ghim của từng loại yêu cầu gốc (`crew.roots`/`crew.map`, cùng quy tắc
 * nhãn với map của plugin):
 * - `code`: reviewer, integrator gộp + docs, owner, integrator push;
 * - `code-bf` (luồng Bug Finding): integrator gộp code + PR, reviewer cầu nối Bug Finding, owner, integrator merge PR;
 * - `research`: reviewer, owner.
 */
function stageOrder(kind?: string | null): StageKey[] {
  if (kind === 'research') return ['reviewer', 'owner'];
  if (kind === 'code-bf') return ['integratorPr', 'bugFinding', 'owner', 'integratorMerge'];
  return ['reviewer', 'integratorDocs', 'owner', 'integratorPush'];
}

/** Suy khóa giai đoạn từ `stage` của `crew.roots`/`crew.map`. */
function resolveStageKey(stage: StageInput | null | undefined, kind?: string | null): StageKey {
  if (!stage) return 'none';
  if (!stage.currentType) return stage.completed.length ? 'done' : 'notStarted';
  if (stage.position === null) return 'unknown';
  return stageOrder(kind)[stage.position] ?? (stage.currentType === 'approval' ? 'owner' : 'reviewer');
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

type StageStepState = 'done' | 'current' | 'waiting';

interface StageStripItem {
  key: StageKey;
  state: StageStepState;
  /** Dòng phụ dưới tên bước; không có thì hiện trạng thái (Xong / Đang ở đây / Chờ). */
  detail?: React.ReactNode;
}

/** Các bước của policy theo loại yêu cầu gốc: bước trước bước hiện tại là xong, sau là chờ; ticket đã xong thì mọi bước xong. */
function stageStripOf(stage: StageInput | null | undefined, kind?: string | null): StageStripItem[] {
  const order = stageOrder(kind);
  const finished = !!stage && !stage.currentType && stage.completed.length > 0;
  const position = stage?.currentType ? stage.position : null;
  return order.map((key, index) => ({
    key,
    state: finished || (position !== null && index < position) ? 'done' : index === position ? 'current' : 'waiting',
  }));
}

const STEP_CLASS: Record<StageStepState, string> = {
  done: 'bg-muted/50',
  current: 'border-primary bg-primary/5',
  waiting: 'text-muted-foreground',
};

/** Dải giai đoạn của yêu cầu gốc: mỗi bước một ô đánh số, bước hiện tại có viền nhấn (`aria-current="step"`). */
function StageStrip({ items }: { items: StageStripItem[] }) {
  const { t } = useT();
  return (
    <ol aria-label={t('stage.strip')} data-slot="stage-strip" className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
      {items.map((item, index) => (
        <li
          key={item.key}
          data-state={item.state}
          aria-current={item.state === 'current' ? 'step' : undefined}
          className={cn('flex min-w-0 flex-col gap-0.5 rounded-lg border p-2', STEP_CLASS[item.state])}
        >
          <span className="font-medium text-foreground">{`${index + 1}. ${t(`stage.${item.key}`)}`}</span>
          <span className="text-xs text-muted-foreground">{item.detail ?? t(`stage.step.${item.state}`)}</span>
        </li>
      ))}
    </ol>
  );
}

export type { StageBadgeProps, StageInput, StageKey, StageStepState, StageStripItem };
export { resolveStageKey, StageBadge, StageStrip, stageStripOf };
