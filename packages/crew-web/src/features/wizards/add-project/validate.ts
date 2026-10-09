// Kiểm form bước 1 của wizard thêm project. Trả khóa dịch (namespace wizards), nơi hiện lỗi tự dịch.

/** Cùng luật khóa với plugin (jobs/validate.ts) và app Mac (KEY_RE). */
export const PROJECT_KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
/** Khóa project thử nghiệm: chỉ dùng ở company Crew E2E (wrapper chạy stub theo tiền tố này). */
export const E2E_KEY_PREFIX = 'e2e-';
export const E2E_COMPANY_NAME = 'Crew E2E';
const FOLDER_MAX = 4096;
const NAME_MAX = 120;
// biome-ignore lint/suspicious/noControlCharactersInRegex: chặn ký tự điều khiển trong đường dẫn, như plugin
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export interface AddProjectForm {
  machineId: string;
  folder: string;
  key: string;
  name: string;
  executors: number;
}

export type AddProjectFormErrors = Partial<Record<keyof AddProjectForm, string>>;

export interface ValidateContext {
  companyName: string;
  /** Mọi project của company (kể cả đã lưu trữ): khóa không được trùng urlKey hay tên. */
  projects: readonly { name: string; urlKey?: string | null }[];
}

export function validateAddProject(form: AddProjectForm, ctx: ValidateContext): AddProjectFormErrors {
  const errors: AddProjectFormErrors = {};
  if (form.machineId === '') errors.machineId = 'validate.machine';

  const folder = form.folder;
  if (
    !folder.startsWith('/') ||
    folder.length > FOLDER_MAX ||
    folder.includes('..') ||
    folder.includes('\0') ||
    CONTROL_RE.test(folder)
  ) {
    errors.folder = 'validate.folder';
  }

  const key = form.key;
  if (!PROJECT_KEY_RE.test(key)) errors.key = 'validate.key';
  else if (key.startsWith(E2E_KEY_PREFIX) && ctx.companyName !== E2E_COMPANY_NAME) errors.key = 'validate.e2eKey';
  else if (ctx.projects.some((p) => p.urlKey === key || p.name.trim().toLowerCase() === key)) {
    errors.key = 'validate.keyTaken';
  }

  const name = form.name.trim();
  if (name === '' || form.name.length > NAME_MAX) errors.name = 'validate.name';
  if (form.executors !== 1 && form.executors !== 2) errors.executors = 'validate.executors';
  return errors;
}
