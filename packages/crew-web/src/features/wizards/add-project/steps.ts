// Bước và ô vai trò của wizard thêm project.
import type { CrewRoleSlot, SetupStepId } from '@/api';

/** Thứ tự bước add-project, cùng SETUP_STEPS['add-project'] của plugin; bước cuối `check` làm run thành done. */
export const ADD_PROJECT_STEPS = [
  'inspect',
  'project',
  'checkouts',
  'environments',
  'agents',
  'roles',
  'check',
] as const satisfies readonly SetupStepId[];
export type AddProjectStepId = (typeof ADD_PROJECT_STEPS)[number];

/** Ô vai trò theo số executor, đúng thứ tự tạo (Trợ Lý trước, rồi executor, reviewer, integrator). */
export function projectSlots(executors: number): CrewRoleSlot[] {
  return ['assistant', 'executor', ...(executors === 2 ? (['executor-2'] as const) : []), 'reviewer', 'integrator'];
}

/** Tên environment và agent của một ô: `<khóa>-<ô>` (như app Mac). */
export const slotName = (key: string, slot: CrewRoleSlot): string => `${key}-${slot}`;
/** Nhánh checkout của một ô: `crew/<khóa>/<ô>` (I1). */
export const slotBranch = (key: string, slot: CrewRoleSlot): string => `crew/${key}/${slot}`;
