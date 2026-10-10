// Kiểm form bước 1 của wizard tạo agent. Trả khóa dịch (namespace wizards), nơi hiện lỗi tự dịch.
import { type CrewRoleSlot, isCrewModel, slotModels } from '@/lib/instructions';
import { isSafeFolder, projectKeyError } from '../add-project/validate';
import { ROLE_SLOTS } from './steps';

const NAME_MAX = 120;
/** Folder lưu trong refs của setup run, mà plugin giới hạn giá trị refs 200 ký tự. */
export const AGENT_FOLDER_MAX = 200;

export interface AddAgentForm {
  projectId: string;
  slot: string;
  name: string;
  model: string;
  machineId: string;
  key: string;
  folder: string;
}

export type AddAgentFormErrors = Partial<Record<keyof AddAgentForm, string>>;

export interface ValidateAgentContext {
  companyName: string;
  /** Agent của company: tên agent mới không được trùng agent chưa dừng hẳn (wizard nhận lại agent theo tên). */
  agents: readonly { name: string; status: string }[];
  /** Chế độ sửa agent có sẵn: không kiểm tên. */
  fix: boolean;
}

export function validateAddAgent(form: AddAgentForm, ctx: ValidateAgentContext): AddAgentFormErrors {
  const errors: AddAgentFormErrors = {};
  if (form.projectId === '') errors.projectId = 'validate.project';
  const slotOk = (ROLE_SLOTS as readonly string[]).includes(form.slot);
  if (!slotOk) errors.slot = 'validate.slot';
  if (!ctx.fix) {
    const name = form.name.trim();
    if (name === '' || form.name.length > NAME_MAX) errors.name = 'validate.agentName';
    else if (ctx.agents.some((a) => a.name === name && a.status !== 'terminated'))
      errors.name = 'validate.agentNameTaken';
  }
  // Model theo runtime của ô (reviewer Codex chỉ model cố định); ô lạ thì kiểm theo model Claude.
  const modelOk = slotOk ? slotModels(form.slot as CrewRoleSlot).includes(form.model) : isCrewModel(form.model);
  if (!modelOk) errors.model = 'validate.model';
  if (form.machineId === '') errors.machineId = 'validate.machine';
  const keyError = projectKeyError(form.key, ctx.companyName);
  if (keyError) errors.key = keyError;
  if (!isSafeFolder(form.folder, AGENT_FOLDER_MAX)) errors.folder = 'validate.agentFolder';
  return errors;
}
