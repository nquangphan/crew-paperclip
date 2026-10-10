// Cổng vào lớp dữ liệu: feature chỉ import từ '@/api'.
import { crewDataApi } from './crew/data';
import { forceDoneApi } from './crew/force-done';
import { jobsApi } from './crew/jobs';
import { rolesApi } from './crew/roles';
import { setupApi } from './crew/setup';
import { activityApi } from './paperclip/activity';
import { agentsApi } from './paperclip/agents';
import { attachmentsApi } from './paperclip/attachments';
import { authApi } from './paperclip/auth';
import { cliAuthApi } from './paperclip/cli-auth';
import { commentsApi } from './paperclip/comments';
import { companiesApi } from './paperclip/companies';
import { dashboardApi } from './paperclip/dashboard';
import { documentsApi } from './paperclip/documents';
import { environmentsApi } from './paperclip/environments';
import { healthApi } from './paperclip/health';
import { inboxApi } from './paperclip/inbox';
import { interactionsApi } from './paperclip/interactions';
import { issuesApi } from './paperclip/issues';
import { labelsApi } from './paperclip/labels';
import { profileApi } from './paperclip/profile';
import { projectsApi } from './paperclip/projects';
import { runsApi } from './paperclip/runs';
import { searchApi } from './paperclip/search';
import { sidebarApi } from './paperclip/sidebar';
import { skillSourcesApi, skillsApi } from './paperclip/skills';

export const api = {
  auth: authApi,
  cliAuth: cliAuthApi,
  profile: profileApi,
  health: healthApi,
  companies: companiesApi,
  sidebar: sidebarApi,
  dashboard: dashboardApi,
  activity: activityApi,
  search: searchApi,
  issues: issuesApi,
  labels: labelsApi,
  inbox: inboxApi,
  comments: commentsApi,
  attachments: attachmentsApi,
  documents: documentsApi,
  interactions: interactionsApi,
  runs: runsApi,
  projects: projectsApi,
  agents: agentsApi,
  environments: environmentsApi,
  skills: skillsApi,
  skillSources: skillSourcesApi,
  crew: { ...crewDataApi, ...forceDoneApi },
  roles: rolesApi,
  jobs: jobsApi,
  setup: setupApi,
};

export type Api = typeof api;
export { CREW_DATA_KEYS, type CrewDataKey } from './crew/data';
export type * from './crew/types';
export { ENDPOINTS, type EndpointKey } from './endpoints';
export { ApiError } from './http';
export type { CliAuthChallenge } from './paperclip/cli-auth';
export type { IssueListFilters, IssueUpdate } from './paperclip/issues';
export type { LiveRun } from './paperclip/runs';
export { queryKeys } from './queryKeys';
