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

export interface JevSettingsInput {
  enabled: boolean;
  gateMode: JevGateMode;
  model: string;
  threshold: number;
  timeoutMs: number;
  serverShadow: boolean;
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
}

export const jevApi = {
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
};

export const __endpoints = [
  'jev.issueSummary',
  'jev.deleteKey',
  'jev.events',
  'jev.label',
  'jev.setKey',
  'jev.setSettings',
  'jev.settings',
  'jev.shadow',
  'jev.stats',
];
