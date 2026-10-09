// Tính năng của Paperclip gốc không có trong UI Crew (BA mục 2). Chữ hiển thị ở locale `guide`, key `missing.<id>`.
//   KD = Crew không dùng; HK = bị luật hook chặn hoặc làm hỏng luồng hook bảo vệ;
//   CL = chưa có luồng làm đủ bước; RS = để release sau.

export const MISSING_GROUPS = ['nav', 'issue', 'agent', 'project', 'company'] as const;
export const MISSING_REASONS = ['KD', 'HK', 'CL', 'RS'] as const;

export type MissingGroup = (typeof MISSING_GROUPS)[number];
export type MissingReason = (typeof MISSING_REASONS)[number];

export interface MissingFeature {
  id: string;
  group: MissingGroup;
  reason: MissingReason;
}

/** Số dòng của BA mục 2, đếm từ ba-report.md ngày 10/10 (13 + 12 + 14 + 5 + 9). */
export const BA_MISSING_ROWS = 53;

const rows = (group: MissingGroup, list: readonly (readonly [string, MissingReason])[]): MissingFeature[] =>
  list.map(([id, reason]) => ({ id, group, reason }));

export const MISSING_FEATURES: readonly MissingFeature[] = [
  ...rows('nav', [
    ['routines', 'KD'],
    ['artifacts', 'KD'],
    ['connectors', 'KD'],
    ['auditCosts', 'KD'],
    ['orgChart', 'KD'],
    ['goals', 'KD'],
    ['timeline', 'KD'],
    ['chats', 'KD'],
    ['decisionsCards', 'KD'],
    ['workspaces', 'KD'],
    ['onboarding', 'KD'],
    ['designLabs', 'KD'],
    ['publicProfile', 'KD'],
  ]),
  ...rows('issue', [
    ['freeAssignee', 'HK'],
    ['pickReviewers', 'HK'],
    ['freeStatus', 'HK'],
    ['editRelations', 'HK'],
    ['planMode', 'KD'],
    ['commentModel', 'HK'],
    ['addSubIssue', 'CL'],
    ['queuedComment', 'KD'],
    ['feedbackVote', 'KD'],
    ['issueDocsLock', 'KD'],
    ['monitorRecovery', 'KD'],
    ['deleteIssue', 'KD'],
  ]),
  ...rows('agent', [
    ['plainAgent', 'CL'],
    ['runNow', 'KD'],
    ['assignFromAgent', 'HK'],
    ['editRuntime', 'HK'],
    ['editInstructions', 'HK'],
    ['agentSecrets', 'KD'],
    ['agentTools', 'KD'],
    ['agentPermissions', 'HK'],
    ['agentApiKeys', 'KD'],
    ['duplicateReset', 'HK'],
    ['terminateAgent', 'CL'],
    ['approvals', 'KD'],
    ['followAgent', 'KD'],
    ['builtInAgents', 'KD'],
  ]),
  ...rows('project', [
    ['plainProject', 'CL'],
    ['repositories', 'KD'],
    ['archiveProject', 'CL'],
    ['budgetTab', 'KD'],
    ['workspacesTab', 'KD'],
  ]),
  ...rows('company', [
    ['createOrganization', 'CL'],
    ['members', 'RS'],
    ['secrets', 'CL'],
    ['environments', 'CL'],
    ['instancePlugins', 'KD'],
    ['exportImport', 'KD'],
    ['instanceGeneral', 'KD'],
    ['skillStudio', 'RS'],
    ['signUp', 'KD'],
  ]),
];
