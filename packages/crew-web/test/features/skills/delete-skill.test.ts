import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/http';
import {
  type DeleteSkillDeps,
  type DeleteSkillTarget,
  newDeleteProgress,
  removalTargets,
  runDeleteSkill,
} from '@/features/skills/delete-skill';

const SKILL = '33333333-3333-4333-8333-333333333333';
const A1 = 'a1111111-1111-4111-8111-111111111111';
const A2 = 'a2222222-2222-4222-8222-222222222222';
const M1 = 'm1';
const M2 = 'm2';

const target = (over: Partial<DeleteSkillTarget> = {}): DeleteSkillTarget => ({
  id: SKILL,
  key: 'github/acme/viet-test',
  slug: 'viet-test',
  agentIds: [A1, A2],
  skillSourceId: 'src1',
  skillSourcePath: 'skills/viet-test/SKILL.md',
  ...over,
});

const source = (revision: number, selected: string[]) => ({
  id: 'src1',
  revision,
  excludedFolders: ['old'],
  entries: [
    {
      path: 'skills/viet-test/SKILL.md',
      selection: selected.includes('skills/viet-test/SKILL.md') ? 'selected' : 'excluded',
    },
    { path: 'skills/khac/SKILL.md', selection: selected.includes('skills/khac/SKILL.md') ? 'selected' : 'excluded' },
  ],
});

type Overrides = Partial<{ [K in keyof DeleteSkillDeps]: DeleteSkillDeps[K] }>;

/** Deps giả ghi lại thứ tự gọi. */
function fakeDeps(over: Overrides = {}) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const deps: DeleteSkillDeps = {
    agentSkills: async (agentId) => {
      calls.push(`agentSkills ${agentId}`);
      return { desiredSkills: ['crew/review', 'github/acme/viet-test'] };
    },
    syncAgentSkills: async (agentId, desired) => {
      calls.push(`sync ${agentId}`);
      bodies.push(desired);
    },
    getSource: async () => {
      calls.push('getSource');
      return source(4, ['skills/viet-test/SKILL.md', 'skills/khac/SKILL.md']) as never;
    },
    selectSource: async (_id, body) => {
      calls.push('selectSource');
      bodies.push(body);
    },
    removeSkill: async () => {
      calls.push('remove');
    },
    queueRemove: async (machineId) => {
      calls.push(`queue ${machineId}`);
    },
  };
  for (const [k, fn] of Object.entries(over)) {
    const key = k as keyof DeleteSkillDeps;
    const wrapped = async (...args: unknown[]) => {
      calls.push(`${key}*`);
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
    (deps as unknown as Record<string, unknown>)[key] = wrapped;
  }
  return { deps, calls, bodies };
}

describe('runDeleteSkill', () => {
  it('đúng thứ tự: gỡ khỏi từng agent → bỏ chọn ở nguồn → DELETE → xếp skill-remove từng máy', async () => {
    const { deps, calls, bodies } = fakeDeps();
    const progress = newDeleteProgress();
    await runDeleteSkill({ target: target(), queueMachineIds: [M1, M2], deps, progress });
    expect(calls).toEqual([
      `agentSkills ${A1}`,
      `sync ${A1}`,
      `agentSkills ${A2}`,
      `sync ${A2}`,
      'getSource',
      'selectSource',
      'remove',
      `queue ${M1}`,
      `queue ${M2}`,
    ]);
    expect(bodies[0]).toEqual(['crew/review']);
    expect(bodies[2]).toEqual({ revision: 4, selectedPaths: ['skills/khac/SKILL.md'], excludedFolders: ['old'] });
    expect(progress).toEqual({ detached: [A1, A2], sourceDone: true, deleted: true, queued: [M1, M2] });
  });

  it('agent không còn khai skill thì không POST sync; skill không có nguồn thì bỏ bước nguồn', async () => {
    const { deps, calls } = fakeDeps({ agentSkills: async () => ({ desiredSkills: ['crew/review'] }) });
    await runDeleteSkill({
      target: target({ agentIds: [A1], skillSourceId: null, skillSourcePath: null }),
      queueMachineIds: [],
      deps,
      progress: newDeleteProgress(),
    });
    expect(calls).toEqual(['agentSkills*', 'remove']);
  });

  it('đường dẫn đã bỏ chọn ở nguồn thì không PATCH; nguồn đã mất (404) thì coi như xong', async () => {
    const a = fakeDeps({ getSource: async () => source(2, ['skills/khac/SKILL.md']) as never });
    await runDeleteSkill({
      target: target({ agentIds: [] }),
      queueMachineIds: [],
      deps: a.deps,
      progress: newDeleteProgress(),
    });
    expect(a.calls).toEqual(['getSource*', 'remove']);
    const b = fakeDeps({
      getSource: async () => {
        throw new ApiError(404, 'Not found');
      },
    });
    await runDeleteSkill({
      target: target({ agentIds: [] }),
      queueMachineIds: [],
      deps: b.deps,
      progress: newDeleteProgress(),
    });
    expect(b.calls).toEqual(['getSource*', 'remove']);
  });

  it('409 sai revision ở nguồn → đọc lại, thử một lần nữa', async () => {
    let reads = 0;
    let tries = 0;
    const { deps, calls, bodies } = fakeDeps({
      getSource: async () => {
        reads += 1;
        return source(reads === 1 ? 4 : 5, ['skills/viet-test/SKILL.md']) as never;
      },
      selectSource: async (_id, body) => {
        tries += 1;
        bodies.push(body);
        if (tries === 1) throw new ApiError(409, 'This source changed. Reload before saving your selection.');
      },
    });
    await runDeleteSkill({
      target: target({ agentIds: [] }),
      queueMachineIds: [],
      deps,
      progress: newDeleteProgress(),
    });
    expect(calls).toEqual(['getSource*', 'selectSource*', 'getSource*', 'selectSource*', 'remove']);
    expect(bodies.at(-1)).toEqual({ revision: 5, selectedPaths: [], excludedFolders: ['old'] });
  });

  it('409 lần hai ở nguồn thì báo lỗi, không DELETE', async () => {
    const { deps, calls } = fakeDeps({
      selectSource: async () => {
        throw new ApiError(409, 'This source changed.');
      },
    });
    const progress = newDeleteProgress();
    await expect(
      runDeleteSkill({ target: target({ agentIds: [] }), queueMachineIds: [], deps, progress }),
    ).rejects.toThrow('This source changed.');
    expect(calls).not.toContain('remove');
    expect(progress.sourceDone).toBe(false);
  });

  it('422 usedByAgents → gỡ lại các agent đó rồi DELETE thêm một lần', async () => {
    let removes = 0;
    const { deps, calls } = fakeDeps({
      removeSkill: async () => {
        removes += 1;
        if (removes === 1)
          throw new ApiError(422, 'Cannot delete skill', null, {
            error: 'Cannot delete skill',
            details: { usedByAgents: [{ id: A2, name: 'Executor Hai' }] },
          });
      },
    });
    const progress = newDeleteProgress();
    await runDeleteSkill({
      target: target({ agentIds: [A1], skillSourceId: null }),
      queueMachineIds: [M1],
      deps,
      progress,
    });
    expect(calls).toEqual([
      `agentSkills ${A1}`,
      `sync ${A1}`,
      'removeSkill*',
      `agentSkills ${A2}`,
      `sync ${A2}`,
      'removeSkill*',
      `queue ${M1}`,
    ]);
    expect(progress.deleted).toBe(true);
  });

  it('422 lần hai thì báo lỗi, không xếp việc máy', async () => {
    const { deps, calls } = fakeDeps({
      removeSkill: async () => {
        throw new ApiError(422, 'Cannot delete skill', null, { details: { usedByAgents: [{ id: A2 }] } });
      },
    });
    await expect(
      runDeleteSkill({
        target: target({ agentIds: [], skillSourceId: null }),
        queueMachineIds: [M1],
        deps,
        progress: newDeleteProgress(),
      }),
    ).rejects.toThrow('Cannot delete skill');
    expect(calls.filter((c) => c === 'removeSkill*')).toHaveLength(2);
    expect(calls).not.toContain(`queue ${M1}`);
  });

  it('DELETE trả 404 (đã xóa ở lần trước) coi như xong', async () => {
    const { deps, calls } = fakeDeps({
      removeSkill: async () => {
        throw new ApiError(404, 'Skill not found');
      },
    });
    const progress = newDeleteProgress();
    await runDeleteSkill({
      target: target({ agentIds: [], skillSourceId: null }),
      queueMachineIds: [M1],
      deps,
      progress,
    });
    expect(calls).toEqual(['removeSkill*', `queue ${M1}`]);
    expect(progress.deleted).toBe(true);
  });

  it('chạy lại sau lỗi không gọi lại bước đã xong', async () => {
    let fail = true;
    const { deps, calls } = fakeDeps({
      queueRemove: async (machineId) => {
        if (machineId === M2 && fail) throw new ApiError(500, 'mất mạng');
      },
    });
    const progress = newDeleteProgress();
    await expect(runDeleteSkill({ target: target(), queueMachineIds: [M1, M2], deps, progress })).rejects.toThrow(
      'mất mạng',
    );
    expect(progress).toEqual({ detached: [A1, A2], sourceDone: true, deleted: true, queued: [M1] });
    fail = false;
    calls.length = 0;
    await runDeleteSkill({ target: target(), queueMachineIds: [M1, M2], deps, progress });
    expect(calls).toEqual(['queueRemove*']);
    expect(progress.queued).toEqual([M1, M2]);
  });
});

describe('removalTargets', () => {
  const machines = [
    { machineId: M1, hostname: 'mac-mini', canQueue: true },
    { machineId: M2, hostname: 'macbook', canQueue: false },
    { machineId: 'm3', hostname: 'imac', canQueue: true },
    { machineId: 'm4', hostname: 'studio', canQueue: true },
  ];
  it('chỉ máy đã có bản chép; máy chưa có app nhận việc thì chờ; việc gỡ đang chờ thì không xếp lại', () => {
    const states = [
      { skillId: SKILL, machineId: M1, kind: 'skill-sync', status: 'done' },
      { skillId: SKILL, machineId: M2, kind: 'skill-sync', status: 'done' },
      { skillId: SKILL, machineId: 'm3', kind: 'skill-remove', status: 'queued' },
      { skillId: 'khac', machineId: 'm4', kind: 'skill-sync', status: 'done' },
    ] as never;
    expect(removalTargets(SKILL, states, machines)).toEqual({
      queue: [M1],
      waiting: ['macbook'],
      hosts: ['mac-mini', 'macbook', 'imac'],
    });
  });
});
