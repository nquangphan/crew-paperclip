import { describe, expect, it } from 'vitest';
import type { ProjectRoles } from '@/api';
import { withSlot } from '@/features/wizards/add-agent/run-step';
import { projectSlots } from '@/features/wizards/add-project/steps';

const roles = (executorAgentIds: string[]): ProjectRoles => ({
  assistantAgentId: 'a',
  executorAgentIds,
  reviewerAgentId: 'r',
  integratorAgentId: 'i',
  codexExecutorAgentId: null,
  opencodeExecutorAgentId: null,
  codexReviewerAgentId: null,
});

describe('ô executor từ 1 đến 5', () => {
  it('wizard thêm project tạo đúng số ô executor', () => {
    expect(projectSlots(1)).toEqual(['assistant', 'executor', 'reviewer', 'integrator']);
    expect(projectSlots(5)).toEqual([
      'assistant',
      'executor',
      'executor-2',
      'executor-3',
      'executor-4',
      'executor-5',
      'reviewer',
      'integrator',
    ]);
  });

  it('đặt agent vào ô executor-N: thay agent cũ của ô, ô chưa có thì thêm vào cuối', () => {
    expect(withSlot(roles(['e1', 'e2']), 'executor-3', 'n').executorAgentIds).toEqual(['e1', 'e2', 'n']);
    expect(withSlot(roles(['e1', 'e2', 'e3']), 'executor-2', 'n').executorAgentIds).toEqual(['e1', 'n', 'e3']);
    expect(withSlot(roles(['e1']), 'executor-5', 'n').executorAgentIds).toEqual(['e1', 'n']);
    expect(withSlot(roles(['e1', 'e2', 'e3', 'e4', 'e5']), 'executor-5', 'n').executorAgentIds).toEqual([
      'e1',
      'e2',
      'e3',
      'e4',
      'n',
    ]);
    expect(withSlot(roles(['e1', 'e2']), 'executor', 'n').executorAgentIds).toEqual(['n', 'e2']);
  });
});
