import type { Project } from '@paperclipai/shared';
import { call } from '../endpoints';

export const projectsApi = {
  list: (companyId: string): Promise<Project[]> => call('projects.list', { companyId }),
  get: (id: string, companyId?: string): Promise<Project> => call('projects.get', { id }, { query: { companyId } }),
  create: (companyId: string, body: Record<string, unknown>): Promise<Project> =>
    call('projects.create', { companyId }, { body }),
  update: (id: string, body: Record<string, unknown>, companyId?: string): Promise<Project> =>
    call('projects.update', { id }, { body, query: { companyId } }),
  /** Gỡ project = lưu trữ (S8.7); UI Crew không gọi DELETE /projects/:id. */
  archive: (id: string, companyId?: string): Promise<Project> =>
    call('projects.update', { id }, { body: { archivedAt: new Date().toISOString() }, query: { companyId } }),
};

export const __endpoints = ['projects.create', 'projects.get', 'projects.list', 'projects.update'];
