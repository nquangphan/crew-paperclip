import { describe, expect, it } from 'vitest';
import { resolveStageKey } from '@/ds/widgets/stage-badge';

const at = (position: number, currentType = 'review') => ({ currentType, completed: [], position });

describe('resolveStageKey', () => {
  it('gốc code: reviewer, integrator gộp, owner, integrator push', () => {
    expect([0, 1, 2, 3].map((p) => resolveStageKey(at(p), 'code'))).toEqual([
      'reviewer',
      'integratorMerge',
      'owner',
      'integratorPush',
    ]);
  });

  it('gốc code-bf: integrator gộp đứng đầu, reviewer cầu nối, owner, integrator merge', () => {
    expect([0, 1, 2, 3].map((p) => resolveStageKey(at(p), 'code-bf'))).toEqual([
      'integratorMerge',
      'reviewer',
      'owner',
      'integratorPush',
    ]);
  });
});
