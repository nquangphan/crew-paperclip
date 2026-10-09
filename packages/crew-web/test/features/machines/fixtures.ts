import type { CrewMachine, MachineJob } from '@/api';

export const M1 = '11111111-1111-4111-8111-111111111111';
export const M2 = '22222222-2222-4222-8222-222222222222';
export const SKILL_ID = '33333333-3333-4333-8333-333333333333';

const SUPERPOWERS = ['brainstorming', 'writing-plans', 'test-driven-development'];

/** Máy mẫu: bản tin đủ khóa, có app nhận việc (`jobsAgent`) và danh sách skill Superpowers. */
export function machine(
  over: { machineId?: string; hostname?: string; jobsAgent?: boolean; skills?: string[] | null } = {},
) {
  const { machineId = M1, hostname = 'mac-mini', jobsAgent = true, skills = SUPERPOWERS } = over;
  const now = new Date().toISOString();
  return {
    machineId,
    hostname,
    lastSeenAt: now,
    online: true,
    latest: {
      version: 1,
      companyId: 'c-tps',
      machineId,
      hostname,
      sentAt: now,
      load1: 0.5,
      cpuCount: 8,
      memFreePct: 40,
      tccPending: [],
      claude: { version: '2.1.0', loggedIn: true, plan: 'max' },
      superpowers: {
        pinned: '5.0.7',
        ownerInstalled: '5.0.7',
        pinDir: '/Users/q/.crew/workflows/superpowers/5.0.7',
        ...(skills ? { skills } : {}),
      },
      checks: [],
      ...(jobsAgent ? { jobsAgent: { version: '1.0.0', lastPollAt: now } } : {}),
    },
    load24h: [],
  } as unknown as CrewMachine;
}

export function job(over: Partial<MachineJob> & { id: string }): MachineJob {
  return {
    companyId: 'c-tps',
    machineId: M1,
    kind: 'skill-sync',
    payload: { kind: 'skill-sync', skillId: SKILL_ID, slug: 'viet-test', version: '1' },
    status: 'queued',
    result: null,
    errorCode: null,
    errorText: null,
    attempts: 0,
    setupRunId: null,
    createdAt: new Date().toISOString(),
    claimedAt: null,
    finishedAt: null,
    ...over,
  } as MachineJob;
}

export const DATA = 'POST /api/plugins/crew.core/data';
export const ROUTE = 'POST /api/plugins/crew.core/api';
