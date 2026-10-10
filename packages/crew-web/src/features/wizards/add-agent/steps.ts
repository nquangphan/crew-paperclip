// Bước của wizard tạo agent (S13).
import type { CrewRoleSlot, SetupStepId } from '@/api';
import { CREW_ROLE_SLOTS } from '@/lib/instructions';

/**
 * Thứ tự bước add-agent, cùng SETUP_STEPS['add-agent'] của plugin. Bước cuối `assistant-instructions` luôn chạy (kể cả
 * khi không cần ghi gì) vì chỉ khi nó `done` thì setup run mới thành `done`.
 */
export const ADD_AGENT_STEPS = [
  'agent',
  'pin',
  'environment',
  'workspace',
  'role',
  'assistant-instructions',
] as const satisfies readonly SetupStepId[];
export type AddAgentStepId = (typeof ADD_AGENT_STEPS)[number];

export const isAddAgentStep = (value: string | null): value is AddAgentStepId =>
  (ADD_AGENT_STEPS as readonly string[]).includes(value ?? '');

/** Ô chọn được trong wizard: 5 ô Claude và 3 ô runtime (executor Codex, executor OpenCode, reviewer Codex). */
export const ROLE_SLOTS: readonly CrewRoleSlot[] = CREW_ROLE_SLOTS;

/** Checkout của một ô trên máy: `<home>/crew-agents/<khóa>/<ô>` (cùng `checkoutPath` của app Mac). */
export const slotCheckout = (home: string, key: string, slot: CrewRoleSlot): string =>
  `${home}/crew-agents/${key}/${slot}`;
