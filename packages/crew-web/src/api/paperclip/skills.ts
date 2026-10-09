// Skill company và nguồn skill (S14). Nguồn: server/src/routes/company-skills.ts:316-452.
import type {
  CompanySkillDetail,
  CompanySkillListItem,
  SkillSource,
  SkillSourceCreateRequest,
  SkillSourceDiscovery,
  SkillSourceDiscoveryRequest,
  SkillSourceFilePreview,
  SkillSourcePreviewRequest,
} from '@paperclipai/shared';
import { call } from '../endpoints';

export const skillsApi = {
  list: (companyId: string): Promise<CompanySkillListItem[]> => call('skills.list', { companyId }),
  get: (companyId: string, skillId: string): Promise<CompanySkillDetail> => call('skills.get', { companyId, skillId }),
  discover: (companyId: string, body: SkillSourceDiscoveryRequest): Promise<SkillSourceDiscovery> =>
    call('skillSources.discover', { companyId }, { body }),
  preview: (companyId: string, body: SkillSourcePreviewRequest): Promise<SkillSourceFilePreview> =>
    call('skillSources.preview', { companyId }, { body }),
  createSource: (companyId: string, body: SkillSourceCreateRequest): Promise<SkillSource> =>
    call('skillSources.create', { companyId }, { body }),
};

export const __endpoints = [
  'skillSources.create',
  'skillSources.discover',
  'skillSources.preview',
  'skills.get',
  'skills.list',
];
