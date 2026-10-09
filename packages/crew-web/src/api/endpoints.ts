// Bảng hằng duy nhất các endpoint UI Crew được gọi. Mỗi dòng ghi mã nút trong BA R3 mục 1 dùng nó.
// Feature không gọi mạng trực tiếp; client trong api/paperclip, api/crew gọi qua call(<khóa>).
// Thêm endpoint mới: thêm dòng ở đây (kèm mã BA) và hàm client tương ứng; test endpoints.test.ts bắt lệch.

import { type HttpMethod, http, type Query } from './http';

interface EndpointDef {
  /** Mã nút BA (S0.1, S6.7…) dùng endpoint này. */
  readonly ids: readonly string[];
  readonly method: HttpMethod;
  readonly path: string;
  /** 401 là kết quả bình thường, không chuyển về trang đăng nhập. */
  readonly public?: boolean;
  /** Không gọi qua call(): link cho trình duyệt tự tải (href) hoặc WebSocket. Chỉ dựng đường bằng endpointPath. */
  readonly noCall?: boolean;
}

const PLUGIN = '/api/plugins/crew.core';

export const ENDPOINTS = {
  // Đăng nhập, phiên, hồ sơ (S0.6, S1, S18)
  'auth.signIn': { ids: ['S1.1'], method: 'POST', path: '/api/auth/sign-in/email', public: true },
  'auth.signOut': { ids: ['S0.6'], method: 'POST', path: '/api/auth/sign-out' },
  'auth.session': { ids: ['S0.6', 'S1.1'], method: 'GET', path: '/api/auth/get-session', public: true },
  'auth.updateProfile': { ids: ['S18.1'], method: 'PATCH', path: '/api/auth/profile' },
  'assets.uploadImage': { ids: ['S18.1'], method: 'POST', path: '/api/companies/:companyId/assets/images' },
  'cliAuth.get': { ids: ['S1.2'], method: 'GET', path: '/api/cli-auth/challenges/:id', public: true },
  'cliAuth.approve': { ids: ['S1.2'], method: 'POST', path: '/api/cli-auth/challenges/:id/approve' },
  'cliAuth.cancel': { ids: ['S1.2'], method: 'POST', path: '/api/cli-auth/challenges/:id/cancel' },
  'health.get': { ids: ['S18.3'], method: 'GET', path: '/api/health' },
  // Cập nhật trực tiếp (S0.5): WebSocket, mở bằng new WebSocket chứ không qua call().
  'live.events': { ids: ['S0.5'], method: 'GET', path: '/api/companies/:companyId/events/ws', noCall: true },

  // Khung (S0)
  'companies.list': { ids: ['S0.2'], method: 'GET', path: '/api/companies' },
  'sidebar.badges': { ids: ['S0.1'], method: 'GET', path: '/api/companies/:companyId/sidebar-badges' },
  'sidebar.preferences': { ids: ['S7.3'], method: 'GET', path: '/api/companies/:companyId/sidebar-preferences/me' },
  'sidebar.savePreferences': {
    ids: ['S7.3'],
    method: 'PUT',
    path: '/api/companies/:companyId/sidebar-preferences/me',
  },
  'dashboard.summary': { ids: ['S2.1'], method: 'GET', path: '/api/companies/:companyId/dashboard' },
  'search.query': { ids: ['S19'], method: 'GET', path: '/api/companies/:companyId/search' },

  // Yêu cầu (S0.4, S2–S6, S8.1)
  'issues.list': {
    ids: ['S0.4', 'S2.1', 'S2.4', 'S3.1', 'S3.2', 'S4.1', 'S4.2', 'S8.1'],
    method: 'GET',
    path: '/api/companies/:companyId/issues',
  },
  'labels.list': { ids: ['S5.2'], method: 'GET', path: '/api/companies/:companyId/labels' },
  'issues.get': { ids: ['S6.13'], method: 'GET', path: '/api/issues/:id' },
  'issues.create': { ids: ['S5.5', 'S5.6'], method: 'POST', path: '/api/companies/:companyId/issues' },
  'issues.update': { ids: ['S6.7', 'S6.8', 'S6.10', 'S6.11', 'S6.12'], method: 'PATCH', path: '/api/issues/:id' },
  'issues.setTitle': { ids: ['S6.12'], method: 'PUT', path: '/api/issues/:id/title' },
  'issues.markRead': { ids: ['S3.3', 'S6.16'], method: 'POST', path: '/api/issues/:id/read' },
  'issues.markUnread': { ids: ['S3.3'], method: 'DELETE', path: '/api/issues/:id/read' },
  'issues.archive': { ids: ['S3.4'], method: 'POST', path: '/api/issues/:id/inbox-archive' },
  'issues.unarchive': { ids: ['S3.4'], method: 'DELETE', path: '/api/issues/:id/inbox-archive' },
  'comments.list': { ids: ['S6.4'], method: 'GET', path: '/api/issues/:id/comments' },
  'comments.add': { ids: ['S6.5'], method: 'POST', path: '/api/issues/:id/comments' },
  'attachments.list': { ids: ['S6.6'], method: 'GET', path: '/api/issues/:id/attachments' },
  'attachments.upload': {
    ids: ['S5.3', 'S6.6'],
    method: 'POST',
    path: '/api/companies/:companyId/issues/:issueId/attachments',
  },
  'attachments.delete': { ids: ['S6.6'], method: 'DELETE', path: '/api/attachments/:attachmentId' },
  'attachments.content': {
    ids: ['S6.5', 'S6.6'],
    method: 'GET',
    path: '/api/attachments/:attachmentId/content',
    noCall: true,
  },
  'documents.list': { ids: ['S6.14'], method: 'GET', path: '/api/issues/:id/documents' },
  'documents.get': { ids: ['S6.14'], method: 'GET', path: '/api/issues/:id/documents/:key' },
  'interactions.list': { ids: ['S6.9'], method: 'GET', path: '/api/issues/:id/interactions' },
  'interactions.respond': {
    ids: ['S6.9'],
    method: 'POST',
    path: '/api/issues/:id/interactions/:interactionId/respond',
  },
  'interactions.accept': {
    ids: ['S6.9'],
    method: 'POST',
    path: '/api/issues/:id/interactions/:interactionId/accept',
  },
  'interactions.reject': {
    ids: ['S6.9'],
    method: 'POST',
    path: '/api/issues/:id/interactions/:interactionId/reject',
  },

  // Run (S2.2, S6.4, S6.15, S11, S12)
  'runs.list': { ids: ['S2.2', 'S11.1', 'S11.6'], method: 'GET', path: '/api/companies/:companyId/heartbeat-runs' },
  'runs.live': { ids: ['S2.2'], method: 'GET', path: '/api/companies/:companyId/live-runs' },
  'runs.get': { ids: ['S12.1'], method: 'GET', path: '/api/heartbeat-runs/:runId' },
  'runs.events': { ids: ['S12.1'], method: 'GET', path: '/api/heartbeat-runs/:runId/events' },
  'runs.log': { ids: ['S12.1'], method: 'GET', path: '/api/heartbeat-runs/:runId/log' },
  'runs.issues': { ids: ['S12.1'], method: 'GET', path: '/api/heartbeat-runs/:runId/issues' },
  'runs.cancel': { ids: ['S6.15', 'S12.2'], method: 'POST', path: '/api/heartbeat-runs/:runId/cancel' },
  'runs.forIssue': { ids: ['S6.15'], method: 'GET', path: '/api/issues/:id/runs' },
  'runs.liveForIssue': { ids: ['S6.4'], method: 'GET', path: '/api/issues/:id/live-runs' },

  // Project (S7, S8, S9)
  'projects.list': { ids: ['S5.1', 'S7.1'], method: 'GET', path: '/api/companies/:companyId/projects' },
  'projects.get': { ids: ['S8.1'], method: 'GET', path: '/api/projects/:id' },
  'projects.create': { ids: ['S9.2'], method: 'POST', path: '/api/companies/:companyId/projects' },
  'projects.update': { ids: ['S8.6'], method: 'PATCH', path: '/api/projects/:id' },

  // Agent (S9.5, S10, S11, S12.3–4, S13)
  'agents.list': { ids: ['S10.1'], method: 'GET', path: '/api/companies/:companyId/agents' },
  'agents.get': { ids: ['S11.1', 'S11.4'], method: 'GET', path: '/api/agents/:id' },
  'agents.create': { ids: ['S9.5', 'S13.1'], method: 'POST', path: '/api/companies/:companyId/agents' },
  'agents.update': { ids: ['S11.5', 'S11.7', 'S13.2', 'S13.3'], method: 'PATCH', path: '/api/agents/:id' },
  'agents.setPermissions': { ids: ['S9.5', 'S13.1'], method: 'PATCH', path: '/api/agents/:id/permissions' },
  'agents.pause': { ids: ['S9.8', 'S10.3'], method: 'POST', path: '/api/agents/:id/pause' },
  'agents.resume': { ids: ['S10.3'], method: 'POST', path: '/api/agents/:id/resume' },
  'agents.wakeup': { ids: ['S12.3', 'S12.4'], method: 'POST', path: '/api/agents/:id/wakeup' },
  'agents.instructionsFile': { ids: ['S11.2'], method: 'GET', path: '/api/agents/:id/instructions-bundle/file' },
  'agents.saveInstructionsFile': {
    ids: ['S8.3', 'S9.5', 'S11.2', 'S13.2', 'S13.6'],
    method: 'PUT',
    path: '/api/agents/:id/instructions-bundle/file',
  },
  'agents.skills': { ids: ['S11.3'], method: 'GET', path: '/api/agents/:id/skills' },
  'agents.syncSkills': { ids: ['S11.3', 'S14.3'], method: 'POST', path: '/api/agents/:id/skills/sync' },

  // Environment (S9.4, S13.3)
  'environments.list': { ids: ['S9.4'], method: 'GET', path: '/api/companies/:companyId/environments' },
  'environments.create': { ids: ['S9.4', 'S13.3'], method: 'POST', path: '/api/companies/:companyId/environments' },

  // Skills (S14)
  'skills.list': { ids: ['S14.1'], method: 'GET', path: '/api/companies/:companyId/skills' },
  'skills.get': { ids: ['S14.1'], method: 'GET', path: '/api/companies/:companyId/skills/:skillId' },
  'skillSources.discover': {
    ids: ['S14.2'],
    method: 'POST',
    path: '/api/companies/:companyId/skill-sources/discover',
  },
  'skillSources.preview': { ids: ['S14.2'], method: 'POST', path: '/api/companies/:companyId/skill-sources/preview' },
  'skillSources.create': { ids: ['S14.2'], method: 'POST', path: '/api/companies/:companyId/skill-sources' },

  // Plugin crew.core: data (POST /data/<key>) và route board (/api/...)
  'crew.data': {
    ids: ['S0.2', 'S2.3', 'S4.3', 'S6.1', 'S6.3', 'S8.4', 'S9', 'S14.4', 'S15.1', 'S15.2', 'S16.1', 'S16.2'],
    method: 'POST',
    path: `${PLUGIN}/data/:key`,
  },
  'roles.get': { ids: ['S8.2'], method: 'GET', path: `${PLUGIN}/api/projects/:projectId/roles` },
  'roles.set': { ids: ['S8.3', 'S9.6', 'S13.5'], method: 'POST', path: `${PLUGIN}/api/projects/:projectId/roles` },
  'jobs.create': { ids: ['S9.3', 'S9.7', 'S13.4', 'S14.4'], method: 'POST', path: `${PLUGIN}/api/machine-jobs` },
  'jobs.list': { ids: ['S15.2'], method: 'GET', path: `${PLUGIN}/api/machine-jobs` },
  'jobs.retry': { ids: ['S15.2'], method: 'POST', path: `${PLUGIN}/api/machine-jobs/:jobId/retry` },
  'setup.create': { ids: ['S9', 'S13'], method: 'POST', path: `${PLUGIN}/api/setup-runs` },
  'setup.get': { ids: ['S9', 'S13'], method: 'GET', path: `${PLUGIN}/api/setup-runs/:id` },
  'setup.begin': { ids: ['S9', 'S13'], method: 'POST', path: `${PLUGIN}/api/setup-runs/:id/steps/:stepId/begin` },
  'setup.finish': { ids: ['S9', 'S13'], method: 'POST', path: `${PLUGIN}/api/setup-runs/:id/steps/:stepId/finish` },
  // BA không có mã riêng cho nút "Bỏ lần dở" nên gắn S9 (wizard Thêm project).
  'setup.abandon': { ids: ['S9'], method: 'POST', path: `${PLUGIN}/api/setup-runs/:id/abandon` },
} as const satisfies Record<string, EndpointDef>;

export type EndpointKey = keyof typeof ENDPOINTS;

/** Tên tham số đường dẫn (`:id`, `:companyId`…) suy từ path. */
type PathParamNames<P extends string> = P extends `${string}:${infer K}/${infer Rest}`
  ? K | PathParamNames<`/${Rest}`>
  : P extends `${string}:${infer K}`
    ? K
    : never;

export type EndpointParams<K extends EndpointKey> = Record<PathParamNames<(typeof ENDPOINTS)[K]['path']>, string>;

export interface CallOptions {
  body?: unknown;
  form?: FormData;
  query?: Query;
  signal?: AbortSignal;
}

export function endpointPath<K extends EndpointKey>(key: K, params: EndpointParams<K>): string {
  const values = params as Record<string, string | undefined>;
  return ENDPOINTS[key].path.replace(/:(\w+)/g, (_m, name: string) => {
    const v = values[name];
    if (v === undefined || v === '') throw new Error(`Thiếu tham số ${name} cho ${key}`);
    return encodeURIComponent(v);
  });
}

/**
 * Gọi một endpoint trong bảng. Không có đường nào khác để feature gọi mạng.
 * Kiểu trả suy từ chỗ nhận (`const x: Issue = await call(...)` hoặc kiểu trả của hàm client).
 */
export function call<K extends EndpointKey, T = unknown>(
  key: K,
  params: EndpointParams<K>,
  opts: CallOptions = {},
): Promise<T> {
  const def: EndpointDef = ENDPOINTS[key];
  if (def.noCall) throw new Error(`${key} không gọi qua call(); dùng endpointPath`);
  return http<T>(def.method, endpointPath(key, params), opts.body, {
    form: opts.form,
    query: opts.query,
    signal: opts.signal,
    skipUnauthorizedRedirect: def.public === true,
  });
}
