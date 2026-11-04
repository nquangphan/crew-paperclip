// Bước và ô vai trò của wizard thêm project.
import type { CrewRoleSlot, SetupStepId } from '@/api';
import { EXECUTOR_SLOTS } from '@/lib/instructions';

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
  return ['assistant', ...EXECUTOR_SLOTS.slice(0, executors), 'reviewer', 'integrator'];
}

/**
 * Checkout và environment của agent UIUX (vai `designer`): `~/crew-agents/<khóa>/designer`, `<khóa>-designer`. Agent UIUX
 * không nằm trong dòng vai trò; server nhận nó là của project nhờ checkout dưới khóa project và skill `ui-ux-pro-max`.
 */
export const DESIGNER = 'designer';
export type ProjectCheckout = CrewRoleSlot | typeof DESIGNER;
/** Tên agent UIUX của project. */
export const designerName = (key: string): string => `UIUX ${key}`;

/** Tên environment và agent của một ô: `<khóa>-<ô>` (như app Mac). */
export const slotName = (key: string, slot: ProjectCheckout): string => `${key}-${slot}`;
/** Nhánh checkout của một ô: `crew/<khóa>/<ô>` (I1). */
export const slotBranch = (key: string, slot: ProjectCheckout): string => `crew/${key}/${slot}`;
