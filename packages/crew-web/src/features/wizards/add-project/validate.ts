// Kiểm form bước 1 của wizard thêm project. Trả khóa dịch (namespace wizards), nơi hiện lỗi tự dịch.
import { ROLE_SLOTS } from '../add-agent/steps';
import { slotName } from './steps';

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
  /** Mọi project của company (kể cả đã gỡ, tức đã lưu trữ): khóa không được trùng urlKey hay tên. */
  projects: readonly { name: string; urlKey?: string | null; archivedAt?: string | Date | null }[];
  /**
   * Mọi environment của instance (kể cả đã lưu trữ): tên `<khóa>-<ô>` là duy nhất trên cả instance và environment đã
   * lưu trữ vẫn giữ tên, nên khóa trùng sẽ hỏng ở bước tạo environment sau khi đã tạo project và checkout.
   */
  environments?: readonly { name: string; status?: string | null }[];
}

/** Khóa đã dùng: project đang có → keyTaken; project đã gỡ hay environment đã lưu trữ → keyRemoved. */
function keyUsedError(key: string, ctx: ValidateContext): string | undefined {
  const projects = ctx.projects.filter((p) => p.urlKey === key || p.name.trim().toLowerCase() === key);
  if (projects.some((p) => !p.archivedAt)) return 'validate.keyTaken';
  if (projects.length > 0) return 'validate.keyRemoved';
  const names = new Set(ROLE_SLOTS.map((slot) => slotName(key, slot)));
  const envs = (ctx.environments ?? []).filter((env) => names.has(env.name));
  if (envs.some((env) => env.status !== 'archived')) return 'validate.keyEnvTaken';
  if (envs.length > 0) return 'validate.keyRemoved';
  return undefined;
}

/** Đường dẫn tuyệt đối, không `..`, không ký tự điều khiển, tối đa `max` ký tự (cùng luật folder của plugin). */
export function isSafeFolder(folder: string, max = FOLDER_MAX): boolean {
  return (
    folder.startsWith('/') &&
    folder.length <= max &&
    !folder.includes('..') &&
    !folder.includes('\0') &&
    !CONTROL_RE.test(folder)
  );
}

/** Lỗi khóa project (khóa dạng đúng, khóa e2e-* chỉ ở company Crew E2E) hoặc undefined. */
export function projectKeyError(key: string, companyName: string): string | undefined {
  if (!PROJECT_KEY_RE.test(key)) return 'validate.key';
  if (key.startsWith(E2E_KEY_PREFIX) && companyName !== E2E_COMPANY_NAME) return 'validate.e2eKey';
  return undefined;
}

export function validateAddProject(form: AddProjectForm, ctx: ValidateContext): AddProjectFormErrors {
  const errors: AddProjectFormErrors = {};
  if (form.machineId === '') errors.machineId = 'validate.machine';

  if (!isSafeFolder(form.folder)) errors.folder = 'validate.folder';

  const key = form.key;
  const keyError = projectKeyError(key, ctx.companyName) ?? keyUsedError(key, ctx);
  if (keyError) errors.key = keyError;

  const name = form.name.trim();
  if (name === '' || form.name.length > NAME_MAX) errors.name = 'validate.name';
  if (form.executors !== 1 && form.executors !== 2) errors.executors = 'validate.executors';
  return errors;
}
