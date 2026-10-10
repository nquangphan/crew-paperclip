import { describe, expect, it } from 'vitest';
import type { ProjectRoles } from '@/api';
import { removeAgentEligibility, rolesWithout } from '@/features/wizards/remove/eligibility';

const ID = {
  assistant: 'a1111111-1111-4111-8111-111111111111',
  executor: 'e2222222-2222-4222-8222-222222222222',
  executor2: 'e3333333-3333-4333-8333-333333333333',
  reviewer: 'b4444444-4444-4444-8444-444444444444',
  integrator: 'c5555555-5555-4555-8555-555555555555',
  spare: 'd6666666-6666-4666-8666-666666666666',
};
const P = 'p0000000-0000-4000-8000-000000000001';
const roles = (executors: string[]): ProjectRoles => ({
  assistantAgentId: ID.assistant,
  executorAgentIds: executors,
  reviewerAgentId: ID.reviewer,
  integratorAgentId: ID.integrator,
});
const byProject = (r: ProjectRoles | null) => new Map([[P, r]]);
const agent = (id: string, status = 'idle') => ({ id, status });

describe('removeAgentEligibility (spec §4.5)', () => {
  it('không giữ vai trò nào → gỡ được, không project, không vai trò', () => {
    expect(removeAgentEligibility(agent(ID.spare), byProject(roles([ID.executor])))).toEqual({
      kind: 'ok',
      projectId: null,
      role: null,
    });
    expect(removeAgentEligibility(agent(ID.spare), new Map([[P, null]]))).toEqual({
      kind: 'ok',
      projectId: null,
      role: null,
    });
  });

  it('executor-2, project còn executor khác → gỡ được ở ô executor-2', () => {
    expect(removeAgentEligibility(agent(ID.executor2), byProject(roles([ID.executor, ID.executor2])))).toEqual({
      kind: 'ok',
      projectId: P,
      role: 'executor-2',
    });
  });

  it('executor-1 khi có executor-2 → gỡ được ở ô executor (so id không phân biệt hoa thường)', () => {
    expect(
      removeAgentEligibility(agent(ID.executor.toUpperCase()), byProject(roles([ID.executor, ID.executor2]))),
    ).toEqual({ kind: 'ok', projectId: P, role: 'executor' });
  });

  it('executor duy nhất → không gỡ được', () => {
    expect(removeAgentEligibility(agent(ID.executor), byProject(roles([ID.executor])))).toEqual({
      kind: 'blocked',
      reason: 'onlyExecutor',
      projectId: P,
      role: 'executor',
    });
  });

  it.each([
    ['assistant', ID.assistant],
    ['reviewer', ID.reviewer],
    ['integrator', ID.integrator],
  ] as const)('%s → không gỡ được', (reason, id) => {
    expect(removeAgentEligibility(agent(id), byProject(roles([ID.executor, ID.executor2])))).toEqual({
      kind: 'blocked',
      reason,
      projectId: P,
      role: reason,
    });
  });

  it('agent đã terminated → không có nút', () => {
    expect(removeAgentEligibility(agent(ID.spare, 'terminated'), byProject(null))).toEqual({ kind: 'hidden' });
    expect(removeAgentEligibility(agent(ID.executor, 'terminated'), byProject(roles([ID.executor])))).toEqual({
      kind: 'hidden',
    });
  });
});

describe('rolesWithout', () => {
  it('bỏ executor-2', () => {
    expect(rolesWithout(roles([ID.executor, ID.executor2]), ID.executor2).executorAgentIds).toEqual([ID.executor]);
  });
  it('bỏ executor-1 thì executor-2 lên executor-1', () => {
    expect(rolesWithout(roles([ID.executor, ID.executor2]), ID.executor).executorAgentIds).toEqual([ID.executor2]);
  });
});

describe('ô runtime', () => {
  const withRuntime = (): ProjectRoles => ({
    ...roles([ID.executor]),
    codexExecutorAgentId: ID.spare,
    opencodeExecutorAgentId: ID.executor2,
    codexReviewerAgentId: 'f8888888-8888-4888-8888-888888888888',
  });

  it.each([
    ['executor-codex', ID.spare],
    ['executor-opencode', ID.executor2],
    ['reviewer-codex', 'f8888888-8888-4888-8888-888888888888'],
  ] as const)('%s luôn gỡ được (ô tùy chọn)', (role, id) => {
    expect(removeAgentEligibility(agent(id), byProject(withRuntime()))).toEqual({ kind: 'ok', projectId: P, role });
  });

  it('rolesWithout bỏ agent ô runtime → ô thành null, ô khác giữ', () => {
    expect(rolesWithout(withRuntime(), ID.spare)).toEqual({ ...withRuntime(), codexExecutorAgentId: null });
    expect(rolesWithout(withRuntime(), 'F8888888-8888-4888-8888-888888888888').codexReviewerAgentId).toBeNull();
  });
});
