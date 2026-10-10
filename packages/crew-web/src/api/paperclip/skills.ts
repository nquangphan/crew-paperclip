// Skill company và nguồn skill (S14). Nguồn: server/src/routes/company-skills.ts (skill-sources :316-396, skills :452-1480).
// Sửa/xóa skill chỉ board; skill không phải local_path chỉ đọc (updateFile trả 422 kèm editableReason).
import type {
  CompanySkill,
  CompanySkillDetail,
  CompanySkillFileDeleteRequest,
  CompanySkillFileDeleteResult,
  CompanySkillFileDetail,
  CompanySkillFileUpdateRequest,
  CompanySkillForkPrecheckResult,
  CompanySkillForkResult,
  CompanySkillListItem,
  CompanySkillUpdateRequest,
  CompanySkillUpdateStatus,
  SkillSource,
  SkillSourceCreateRequest,
  SkillSourceDiscovery,
  SkillSourceDiscoveryRequest,
  SkillSourceFilePreview,
  SkillSourcePreviewRequest,
  SkillSourceSelectionRequest,
} from '@paperclipai/shared';
import { call } from '../endpoints';

export const skillsApi = {
  list: (companyId: string): Promise<CompanySkillListItem[]> => call('skills.list', { companyId }),
  get: (companyId: string, skillId: string): Promise<CompanySkillDetail> => call('skills.get', { companyId, skillId }),
  /** Sửa thông tin skill (S14.5). Tên skill đổi bằng `name:` trong SKILL.md qua writeFile, không qua route này. */
  update: (companyId: string, skillId: string, body: CompanySkillUpdateRequest): Promise<CompanySkill> =>
    call('skills.update', { companyId, skillId }, { body }),
  /** Đọc một file; route không có danh sách, danh sách file nằm ở `get().fileInventory`. */
  readFile: (companyId: string, skillId: string, path = 'SKILL.md'): Promise<CompanySkillFileDetail> =>
    call('skills.readFile', { companyId, skillId }, { query: { path } }),
  writeFile: (
    companyId: string,
    skillId: string,
    body: CompanySkillFileUpdateRequest,
  ): Promise<CompanySkillFileDetail> => call('skills.writeFile', { companyId, skillId }, { body }),
  deleteFile: (
    companyId: string,
    skillId: string,
    body: CompanySkillFileDeleteRequest,
  ): Promise<CompanySkillFileDeleteResult> => call('skills.deleteFile', { companyId, skillId }, { body }),
  updateStatus: (companyId: string, skillId: string): Promise<CompanySkillUpdateStatus> =>
    call('skills.updateStatus', { companyId, skillId }),
  /** 409 khi đường dẫn không còn được chọn hoặc đã mất khỏi repo. */
  installUpdate: (companyId: string, skillId: string, body: { force?: boolean } = {}): Promise<CompanySkill> =>
    call('skills.installUpdate', { companyId, skillId }, { body }),
  forkPrecheck: (companyId: string, skillId: string): Promise<CompanySkillForkPrecheckResult> =>
    call('skills.forkPrecheck', { companyId, skillId }),
  /** Tạo bản sửa được (local_path); `reassignAgentIds` chuyển agent đang dùng sang key mới. */
  fork: (
    companyId: string,
    skillId: string,
    body: { name?: string | null; slug?: string | null; reassignAgentIds?: string[] } = {},
  ): Promise<CompanySkillForkResult> => call('skills.fork', { companyId, skillId }, { body }),
  /** Xóa hẳn skill (S14.7). */
  remove: (companyId: string, skillId: string): Promise<CompanySkill> => call('skills.remove', { companyId, skillId }),
  discover: (companyId: string, body: SkillSourceDiscoveryRequest): Promise<SkillSourceDiscovery> =>
    call('skillSources.discover', { companyId }, { body }),
  preview: (companyId: string, body: SkillSourcePreviewRequest): Promise<SkillSourceFilePreview> =>
    call('skillSources.preview', { companyId }, { body }),
  createSource: (companyId: string, body: SkillSourceCreateRequest): Promise<SkillSource> =>
    call('skillSources.create', { companyId }, { body }),
};

export const skillSourcesApi = {
  get: (companyId: string, sourceId: string): Promise<SkillSource> => call('skillSources.get', { companyId, sourceId }),
  /** Đổi các mục được chọn của nguồn; `revision` lấy từ `get`, lệch thì server trả 409. */
  select: (companyId: string, sourceId: string, body: SkillSourceSelectionRequest): Promise<unknown> =>
    call('skillSources.select', { companyId, sourceId }, { body }),
};

export const __endpoints = [
  'skillSources.create',
  'skillSources.discover',
  'skillSources.get',
  'skillSources.preview',
  'skillSources.select',
  'skills.deleteFile',
  'skills.fork',
  'skills.forkPrecheck',
  'skills.get',
  'skills.installUpdate',
  'skills.list',
  'skills.readFile',
  'skills.remove',
  'skills.update',
  'skills.updateStatus',
  'skills.writeFile',
];
