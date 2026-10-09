// Agent: danh sách, chi tiết, tạo/sửa, tạm dừng, đánh thức, hướng dẫn (AGENTS.md), skills.
// PATCH là merge adapterConfig (không gửi replaceAdapterConfig), theo server/src/routes/agents.ts:5401.
import type { Agent, AgentInstructionsFileDetail, AgentSkillSnapshot, AgentWakeupResponse } from '@paperclipai/shared';
import { call } from '../endpoints';

export interface WakeupBody {
  source?: 'on_demand';
  triggerDetail?: 'manual';
  reason: 'retry_failed_run' | 'resume_process_lost_run' | string;
  failedRunId?: string;
  [key: string]: unknown;
}

export const agentsApi = {
  list: (companyId: string): Promise<Agent[]> => call('agents.list', { companyId }),
  get: (id: string, companyId?: string): Promise<Agent> => call('agents.get', { id }, { query: { companyId } }),
  create: (companyId: string, body: Record<string, unknown>): Promise<Agent> =>
    call('agents.create', { companyId }, { body }),
  update: (id: string, body: Record<string, unknown>, companyId?: string): Promise<Agent> =>
    call('agents.update', { id }, { body, query: { companyId } }),
  pause: (id: string, companyId?: string): Promise<Agent> =>
    call('agents.pause', { id }, { body: {}, query: { companyId } }),
  resume: (id: string, companyId?: string): Promise<Agent> =>
    call('agents.resume', { id }, { body: {}, query: { companyId } }),
  wakeup: (id: string, body: WakeupBody, companyId?: string): Promise<AgentWakeupResponse> =>
    call(
      'agents.wakeup',
      { id },
      { body: { source: 'on_demand', triggerDetail: 'manual', ...body }, query: { companyId } },
    ),
  instructionsFile: (id: string, path = 'AGENTS.md', companyId?: string): Promise<AgentInstructionsFileDetail> =>
    call('agents.instructionsFile', { id }, { query: { path, companyId } }),
  /** baseHash sai thì server trả 409; UI báo xung đột, không ghi đè. */
  saveInstructionsFile: (
    id: string,
    body: { path: string; content: string; baseHash?: string | null },
    companyId?: string,
  ): Promise<AgentInstructionsFileDetail> =>
    call('agents.saveInstructionsFile', { id }, { body, query: { companyId } }),
  skills: (id: string, companyId?: string): Promise<AgentSkillSnapshot> =>
    call('agents.skills', { id }, { query: { companyId } }),
  syncSkills: (id: string, desiredSkills: unknown[], mode: string, companyId?: string): Promise<AgentSkillSnapshot> =>
    call('agents.syncSkills', { id }, { body: { desiredSkills, mode }, query: { companyId } }),
};

export const __endpoints = [
  'agents.create',
  'agents.get',
  'agents.instructionsFile',
  'agents.list',
  'agents.pause',
  'agents.resume',
  'agents.saveInstructionsFile',
  'agents.skills',
  'agents.syncSkills',
  'agents.update',
  'agents.wakeup',
];
