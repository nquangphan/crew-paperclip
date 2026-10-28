// Cài đặt model của owner (S18.4): bảng dùng chung toàn instance, route trong router Crew của server (không có
// `:companyId`). `get` cho mọi người đã đăng nhập; `save` và `upgrade` chỉ owner (instance admin, phiên trình duyệt).
// Lỗi của route trả phẳng `{ error, code, ...extra }`; ApiError giữ nguyên body, dùng `modelSettingsErrorOf` để đọc.

import { call } from '../endpoints';
import { ApiError } from '../http';

export type ModelRuntime = 'claude_local' | 'codex_local' | 'opencode_local';
export type ModelComplexity = 'trivial' | 'small' | 'medium' | 'large';
export type ModelEffort = 'low' | 'medium' | 'high';
export type ModelEffortKey = 'effort' | 'modelReasoningEffort' | null;
export type ModelRole =
  | 'assistant'
  | 'executor'
  | 'reviewer'
  | 'integrator'
  | 'bmad'
  | 'designer'
  | 'executor-codex'
  | 'executor-opencode'
  | 'reviewer-codex'
  | 'reviewer-root';

export interface ModelCell {
  model: string;
  effort: ModelEffort | null;
}

export interface RuntimeModelSpec {
  effortKey: ModelEffortKey;
  models: Record<string, { vision: boolean }>;
  /** Ô bảng độ khó: có mặt khi và chỉ khi runtime nằm trong `order[mức]`. */
  byComplexity: Partial<Record<ModelComplexity, ModelCell>>;
}

export interface ModelSettings {
  catalog: Record<ModelRuntime, RuntimeModelSpec>;
  order: Record<ModelComplexity, ModelRuntime[]>;
  roles: Record<ModelRole, ModelCell>;
}

export interface ModelSettingsView {
  /** 0 = chưa ai lưu, `settings` là bảng mặc định. */
  revision: number;
  updatedAt: string | null;
  updatedByUserId: string | null;
  settings: ModelSettings;
  /** Chỉ true với owner (instance admin, phiên trình duyệt): cờ hiện lối vào trang Cài đặt model. */
  canEdit: boolean;
}

export type ModelSettingsSkipReason = 'manual' | 'pending_approval' | 'multi_role';

export interface ModelSettingsAgentChange {
  agentId: string;
  companyId: string;
  name: string;
  /** Vai của agent; null khi nâng hàng loạt gặp agent không giữ vai nào. */
  role: ModelRole | null;
  from: ModelCell;
  to: ModelCell;
}

export interface ModelSettingsAgentSkip {
  agentId: string;
  companyId: string;
  name: string;
  role: ModelRole | null;
  reason: ModelSettingsSkipReason;
}

export interface ModelSettingsSaveResult {
  /** Bản vừa lưu; dryRun thì là bản sẽ lưu (`baseRevision + 1`). */
  revision: number;
  settings: ModelSettings;
  applied: { agents: ModelSettingsAgentChange[]; skipped: ModelSettingsAgentSkip[] };
  dryRun: boolean;
}

export interface ModelUpgradeInput {
  baseRevision: number;
  runtime: ModelRuntime;
  fromModel: string;
  toModel: string;
  /** Cờ ảnh của model mới khi `toModel` là id mới; bỏ trống thì theo `fromModel`. */
  vision?: boolean;
}

export interface ModelUpgradeResult {
  revision: number;
  settings: ModelSettings;
  changes: {
    catalog: 'renamed' | 'merged';
    cells: { level: ModelComplexity }[];
    roles: ModelRole[];
    agents: ModelSettingsAgentChange[];
    skipped: ModelSettingsAgentSkip[];
    issues: { issueId: string; identifier: string; companyId: string }[];
  };
  dryRun: boolean;
}

export interface ModelSettingsIssue {
  /** Đường dẫn trường lỗi từ gốc `settings`, nối bằng dấu chấm (id model giữ nguyên); `""` là cả bảng. */
  path: string;
  message: string;
}

export interface ModelInUse {
  runtime: ModelRuntime;
  model: string;
  agents: number;
  issues: number;
}

/** Lỗi của route cài đặt model, đã tách theo mã. `message` là câu server trả. */
export type ModelSettingsError =
  | { kind: 'invalid'; status: 400 | 422; message: string; issues: ModelSettingsIssue[] }
  | { kind: 'in_use'; message: string; inUse: ModelInUse[] }
  | { kind: 'stale'; message: string; currentRevision: number | null }
  | { kind: 'forbidden'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'other'; message: string; status: number };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function issuesOf(body: Record<string, unknown>): ModelSettingsIssue[] {
  if (!Array.isArray(body.issues)) return [];
  return body.issues.flatMap((i) =>
    isRecord(i) && typeof i.path === 'string' && typeof i.message === 'string'
      ? [{ path: i.path, message: i.message }]
      : [],
  );
}

/** Phân loại lỗi `save`/`upgrade`/`get` theo `code` server trả; lỗi mạng và lỗi lạ thành `other`. */
export function modelSettingsErrorOf(err: unknown): ModelSettingsError {
  if (!(err instanceof ApiError)) {
    return { kind: 'other', status: 0, message: err instanceof Error ? err.message : String(err) };
  }
  const body = isRecord(err.body) ? err.body : {};
  switch (err.code) {
    case 'crew_model_settings_invalid':
      return { kind: 'invalid', status: err.status === 400 ? 400 : 422, message: err.message, issues: issuesOf(body) };
    case 'crew_model_in_use':
      return {
        kind: 'in_use',
        message: err.message,
        inUse: Array.isArray(body.inUse) ? (body.inUse as ModelInUse[]) : [],
      };
    case 'crew_model_settings_stale':
      return {
        kind: 'stale',
        message: err.message,
        currentRevision: typeof body.currentRevision === 'number' ? body.currentRevision : null,
      };
    case 'crew_model_settings_forbidden':
      return { kind: 'forbidden', message: err.message };
    case 'crew_model_settings_unavailable':
      return { kind: 'unavailable', message: err.message };
    default:
      return { kind: 'other', status: err.status, message: err.message };
  }
}

export const modelSettingsApi = {
  get: (): Promise<ModelSettingsView> => call('modelSettings.get', {}),
  /** `dryRun: true` chạy đúng đường áp dụng rồi rollback: kết quả giống lần lưu thật, không ghi gì. */
  save: (
    body: { baseRevision: number; settings: ModelSettings },
    opts: { dryRun?: boolean } = {},
  ): Promise<ModelSettingsSaveResult> =>
    call(
      'modelSettings.save',
      {},
      { body: { ...body, ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }) } },
    ),
  upgrade: (input: ModelUpgradeInput, opts: { dryRun?: boolean } = {}): Promise<ModelUpgradeResult> =>
    call(
      'modelSettings.upgrade',
      {},
      { body: { ...input, ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }) } },
    ),
};

export const __endpoints = ['modelSettings.get', 'modelSettings.save', 'modelSettings.upgrade'];
