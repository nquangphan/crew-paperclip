// Jev (router Crew của server, chỉ owner): cấu hình, key OpenRouter, số liệu cổng chặn lệnh và ca lệch C3.
// Key chỉ đi một chiều lên server; mọi response chỉ có vân tay (12 hex), không bao giờ có key.
import { call } from '../endpoints';

export type JevGateMode = 'shadow' | 'enforce';
export type JevVerdict = 'allow' | 'deny' | 'escalate' | 'error';
export type JevLabel = 'correct' | 'wrong';
export type JevErrorCode = 'auth' | 'timeout' | 'unreachable' | 'bad_response' | 'internal';

export interface JevMachineState {
  machineId: string;
  /** Tên máy từ bảng ghép máy (còn cả khi máy đã gỡ); null khi máy chưa từng ghép. */
  hostname: string | null;
  revoked: boolean;
  appliedVersion: number | null;
  keyOk: boolean;
  lastPullAt: string | null;
  lastEventsAt: string | null;
}

/** Bốn chỗ Jev dùng ngoài cổng chặn lệnh (đợt 2). */
export type JevFeatureId = 'complexity' | 'approval_note' | 'request_type' | 'inbox_attention';
export type JevFeatureMode = 'off' | 'shadow' | 'on';
/** Chế độ từng tính năng; thiếu khóa nghĩa là `shadow`. */
export type JevFeatures = Partial<Record<JevFeatureId, JevFeatureMode>>;

export const JEV_FEATURE_IDS: readonly JevFeatureId[] = [
  'complexity',
  'approval_note',
  'request_type',
  'inbox_attention',
];
export const JEV_FEATURE_MODES: readonly JevFeatureMode[] = ['off', 'shadow', 'on'];

/** Chế độ hiệu lực của một tính năng: thiếu khóa hoặc giá trị lạ thì `shadow` (mặc định của server). */
export function featureMode(features: JevFeatures | null | undefined, id: JevFeatureId): JevFeatureMode {
  const v = features?.[id];
  return v === 'off' || v === 'on' || v === 'shadow' ? v : 'shadow';
}

export interface JevSettingsInput {
  enabled: boolean;
  gateMode: JevGateMode;
  model: string;
  threshold: number;
  timeoutMs: number;
  serverShadow: boolean;
  /** Công tắc chung là `enabled`; đây là chế độ từng tính năng. Thiếu thì server giữ nguyên bản đang lưu. */
  features?: JevFeatures;
}

export interface JevSettings extends JevSettingsInput {
  hasKey: boolean;
  keyFingerprint: string | null;
  version: number;
  updatedAt: string | null;
  machines: JevMachineState[];
}

export interface JevKeyResult {
  hasKey: true;
  keyFingerprint: string;
  /** Chỉ có khi gửi `test: true`. */
  test?: 'ok' | 'error';
  errorCode?: JevErrorCode;
}

export interface JevCategoryStat {
  category: string;
  calls: number;
  deny: number;
  appliedDeny: number;
}

export interface JevShadowCounts {
  done: number;
  mismatch: number;
  escalated: number;
  error: number;
  pending: number;
}

export interface JevStats {
  days: number;
  gate: {
    calls: number;
    allow: number;
    deny: number;
    escalate: number;
    error: number;
    appliedDeny: number;
    skipped: number;
    droppedLines: number;
    p50Ms: number | null;
    p95Ms: number | null;
    byCategory: JevCategoryStat[];
    byDay: { day: string; calls: number; allow: number; deny: number; escalate: number; error: number }[];
  };
  shadow: { liveness: JevShadowCounts; runtime: JevShadowCounts };
}

export interface JevGateEvent {
  id: string;
  eventId: string;
  machineId: string;
  hostname: string | null;
  occurredAt: string;
  runId: string | null;
  agentId: string | null;
  mode: string;
  category: string | null;
  verdict: JevVerdict;
  /** Quyết định Mac đã áp: 'deny' là lệnh bị chặn thật, 'allow' là cho chạy (kể cả ca Jev deny ở chế độ chỉ ghi log). */
  applied: 'allow' | 'deny';
  blocking: boolean;
  confidence: number | null;
  reason: string | null;
  errorCode: string | null;
  latencyMs: number | null;
  model: string | null;
  command: string | null;
  cwd: string | null;
  ownerLabel: JevLabel | null;
  labeledByUserId: string | null;
  labeledAt: string | null;
  receivedAt: string;
}

export interface JevShadowItem {
  id: string;
  kind: 'liveness' | 'runtime';
  runId: string | null;
  regexLabel: string | null;
  jevLabel: string | null;
  confidence: number | null;
  escalated: boolean;
  status: string;
  errorCode: string | null;
  latencyMs: number | null;
  inputExcerpt: string | null;
  mismatch: boolean;
  createdAt: string;
  evaluatedAt: string | null;
}

export interface JevPage<T> {
  items: T[];
  nextBefore: string | null;
}

export interface JevIssueSummary {
  enabled: boolean;
  calls: number;
  allow: number;
  deny: number;
  appliedDeny: number;
  escalate: number;
  error: number;
  runs: number;
  lastAt: string | null;
  /** Tối đa 50 ca deny/escalate/lỗi của các run thuộc issue (lệnh đã che). */
  items: JevGateEvent[];
  shadow: { mismatch: number; items: JevShadowItem[] };
  /** Có khi complexity `on` và Jev (hoặc luật ảnh/vision) cho rằng nên là large. */
  complexityFlag?: JevComplexityFlag | null;
}

/** Cờ "Jev cho rằng việc này nên là large"; chỉ có khi tính năng complexity bật `on`. */
export interface JevComplexityFlag {
  /** `jev`: Jev cho rằng nên là large. `vision`: luật xác định (việc có ảnh mà model đã chọn không đọc được ảnh). */
  kind: 'jev' | 'vision';
  jevSaysLarge: boolean;
  /** Mức Trợ Lý đã khai (trivial/small/medium/large). */
  declared: string | null;
  reason: string | null;
}

/** Số lệnh Jev theo từng issue của một cây yêu cầu (bản đồ Roadmap); chỉ issue có dữ liệu mới có khóa. */
export interface JevRequestMap {
  enabled: boolean;
  byIssue: Record<string, { calls: number; deny: number; appliedDeny: number; escalate: number; error: number }>;
  shadowMismatch: Record<string, number>;
  /** Cờ complexity theo issue; chỉ issue bị cờ mới có khóa, và chỉ khi tính năng `on`. */
  complexityFlags?: Record<string, JevComplexityFlag>;
}

export type JudgeAction = 'approve' | 'request_changes';
export type ApprovalNoteLabel = JudgeAction | 'unclear';
export type RequestTypeLabel = 'code' | 'bug' | 'research' | 'docs';

/** Kết quả hợp lệ của phép chấm lời nhắn duyệt. */
export interface ApprovalNoteVerdict {
  mode: JevFeatureMode;
  /** Null ở chế độ shadow (server trả ngay, không chờ Jev). */
  label: ApprovalNoteLabel | null;
  confidence: number | null;
  mismatch: boolean;
  judgmentId: string | null;
}

export interface RequestTypeVerdict {
  mode: JevFeatureMode;
  /** Null ở chế độ shadow. */
  label: RequestTypeLabel | null;
  confidence: number | null;
  judgmentId: string | null;
}

/** Một dòng thống kê theo tính năng × chế độ. */
export interface JudgmentStatRow {
  feature: JevFeatureId;
  mode: JevFeatureMode;
  total: number;
  mismatch: number;
  escalated: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

/** Một dòng log phán đoán (đã che). */
export interface JudgmentRow {
  id: string;
  feature: JevFeatureId;
  issueId: string | null;
  mode: JevFeatureMode;
  inputExcerpt: string | null;
  jevLabel: string | null;
  baseline: string | null;
  confidence: number | null;
  mismatch: boolean;
  escalated: boolean;
  errorCode: string | null;
  latencyMs: number | null;
  shown: boolean;
  ownerOutcome: string | null;
  createdAt: string;
}

/** Lý do một issue cần Đại Ca để ý trong hộp duyệt. */
export type AttentionKind = 'owner_decision' | 'risky_paths' | 'jev_product_decision';
export interface AttentionFlag {
  issueId: string;
  reasons: { kind: AttentionKind; text: string }[];
}

export const jevApi = {
  requestMap: (companyId: string, requestId: string): Promise<JevRequestMap> =>
    call('jev.requestMap', { companyId, requestId }),
  issueSummary: (companyId: string, issueId: string): Promise<JevIssueSummary> =>
    call('jev.issueSummary', { companyId, issueId }),
  settings: (companyId: string): Promise<JevSettings> => call('jev.settings', { companyId }),
  setSettings: (companyId: string, body: JevSettingsInput): Promise<JevSettings> =>
    call('jev.setSettings', { companyId }, { body }),
  /** `test: true` gọi thử Jev bằng key vừa lưu; kết quả thử nằm ở `test`, key vẫn được lưu dù thử lỗi. */
  setKey: (companyId: string, apiKey: string, test: boolean): Promise<JevKeyResult> =>
    call('jev.setKey', { companyId }, { body: { apiKey, ...(test ? { test: true } : {}) } }),
  deleteKey: (companyId: string): Promise<{ hasKey: false }> => call('jev.deleteKey', { companyId }),
  stats: (companyId: string, days: number): Promise<JevStats> => call('jev.stats', { companyId }, { query: { days } }),
  events: (
    companyId: string,
    verdict: 'deny' | 'escalate' | 'error',
    before: string | null,
  ): Promise<JevPage<JevGateEvent>> => call('jev.events', { companyId }, { query: { verdict, before } }),
  label: (companyId: string, id: string, label: JevLabel | null): Promise<JevGateEvent> =>
    call('jev.label', { companyId, id }, { body: { label } }),
  shadow: (companyId: string, kind: 'liveness' | 'runtime', before: string | null): Promise<JevPage<JevShadowItem>> =>
    call('jev.shadow', { companyId }, { query: { kind, mismatch: true, before } }),
  // Bốn tính năng đợt 2. Response trả `unknown`: feature đọc qua bộ chuyển trong features/jev/judge-adapter.ts, nên sai
  // dạng chỉ làm tính năng im đi chứ không làm hỏng thao tác của owner.
  judgeApprovalNote: (
    companyId: string,
    body: { issueId: string; action: JudgeAction; note: string },
    signal?: AbortSignal,
  ): Promise<unknown> => call('jev.judgeApprovalNote', { companyId }, { body, signal }),
  judgeRequestType: (
    companyId: string,
    body: { title: string; description: string; current?: RequestTypeLabel },
    signal?: AbortSignal,
  ): Promise<unknown> => call('jev.judgeRequestType', { companyId }, { body, signal }),
  judgmentOutcome: (companyId: string, id: string, outcome: string): Promise<unknown> =>
    call('jev.judgmentOutcome', { companyId, id }, { body: { outcome } }),
  judgmentStats: (companyId: string, days: number): Promise<unknown> =>
    call('jev.judgmentStats', { companyId }, { query: { days } }),
  judgments: (companyId: string, query: { feature?: JevFeatureId; mismatch?: boolean }): Promise<unknown> =>
    call('jev.judgments', { companyId }, { query }),
  inboxAttention: (companyId: string, issueIds: readonly string[]): Promise<unknown> =>
    call('jev.inboxAttention', { companyId }, { query: { issueIds: issueIds.join(',') } }),
};

export const __endpoints = [
  'jev.requestMap',
  'jev.issueSummary',
  'jev.deleteKey',
  'jev.events',
  'jev.label',
  'jev.setKey',
  'jev.setSettings',
  'jev.settings',
  'jev.shadow',
  'jev.stats',
  'jev.judgeApprovalNote',
  'jev.judgeRequestType',
  'jev.judgmentOutcome',
  'jev.judgmentStats',
  'jev.judgments',
  'jev.inboxAttention',
];
