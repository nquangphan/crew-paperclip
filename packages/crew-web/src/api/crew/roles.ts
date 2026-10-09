// Vai trò project (route board của plugin, R2-1). Lỗi kiểm tra trả 400 với câu tiếng Việt, hiện nguyên văn.
import { call } from '../endpoints';
import type { ProjectRoles } from './types';

type RolesResponse = { roles: ProjectRoles | null };

export const rolesApi = {
  /** null: project chưa có dòng vai trò (dùng vai trò file CREW_POLICY_CONFIG). */
  get: async (companyId: string, projectId: string): Promise<ProjectRoles | null> => {
    const res: RolesResponse = await call('roles.get', { projectId }, { query: { companyId } });
    return res.roles;
  },
  set: async (companyId: string, projectId: string, roles: ProjectRoles): Promise<ProjectRoles | null> => {
    const res: RolesResponse = await call('roles.set', { projectId }, { body: { companyId, ...roles } });
    return res.roles;
  },
};

export const __endpoints = ['roles.get', 'roles.set'];
