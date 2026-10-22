// Bộ chuyển response của các route Jev đợt 2 sang kiểu của web. Mọi hàm nhận `unknown` và trả `null`/rỗng khi sai dạng,
// để lỗi hay response lạ chỉ làm tính năng im đi (hành vi cũ), không làm hỏng thao tác của owner.
import {
  type ApprovalNoteLabel,
  type ApprovalNoteVerdict,
  type AttentionFlag,
  type AttentionKind,
  JEV_FEATURE_IDS,
  JEV_FEATURE_MODES,
  type JevComplexityFlag,
  type JevFeatureId,
  type JudgmentRow,
  type JudgmentStatRow,
  type RequestTypeLabel,
  type RequestTypeVerdict,
} from '@/api';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v: unknown): number => num(v) ?? 0;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
const idOf = (v: unknown): string | null => (typeof v === 'number' ? String(v) : str(v));

const NOTE_LABELS = ['approve', 'request_changes', 'unclear'] as const satisfies readonly ApprovalNoteLabel[];
const TYPE_LABELS = ['code', 'bug', 'research', 'docs'] as const satisfies readonly RequestTypeLabel[];
const ATTENTION_KINDS = [
  'owner_decision',
  'risky_paths',
  'jev_product_decision',
] as const satisfies readonly AttentionKind[];

/** `{ok:true, mode, label, confidence, mismatch, judgmentId}` hợp lệ; `{ok:false}` hay sai dạng là `null`. */
export function parseApprovalNote(raw: unknown): ApprovalNoteVerdict | null {
  if (!isRec(raw) || raw.ok !== true) return null;
  const mode = oneOf(JEV_FEATURE_MODES, raw.mode);
  // Chế độ shadow trả `label: null` (server không chờ Jev); nhãn có mà lạ thì bỏ cả kết quả.
  const label = raw.label == null ? null : oneOf(NOTE_LABELS, raw.label);
  if (!mode || (raw.label != null && !label) || typeof raw.mismatch !== 'boolean') return null;
  return { mode, label, confidence: num(raw.confidence), mismatch: raw.mismatch, judgmentId: idOf(raw.judgmentId) };
}

export function parseRequestType(raw: unknown): RequestTypeVerdict | null {
  if (!isRec(raw) || raw.ok !== true) return null;
  const mode = oneOf(JEV_FEATURE_MODES, raw.mode);
  const label = raw.label == null ? null : oneOf(TYPE_LABELS, raw.label);
  if (!mode || (raw.label != null && !label)) return null;
  return { mode, label, confidence: num(raw.confidence), judgmentId: idOf(raw.judgmentId) };
}

function rowsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRec(raw)) {
    for (const key of ['rows', 'items', 'stats', 'judgments']) {
      if (Array.isArray(raw[key])) return raw[key] as unknown[];
    }
  }
  return [];
}

/** Thống kê theo tính năng × chế độ; dòng sai dạng bị bỏ. */
export function parseJudgmentStats(raw: unknown): JudgmentStatRow[] {
  const out: JudgmentStatRow[] = [];
  for (const r of rowsOf(raw)) {
    if (!isRec(r)) continue;
    const feature = oneOf(JEV_FEATURE_IDS, r.feature);
    const mode = oneOf(JEV_FEATURE_MODES, r.mode);
    if (!feature || !mode) continue;
    out.push({
      feature,
      mode,
      total: count(r.total ?? r.calls),
      mismatch: count(r.mismatch),
      escalated: count(r.escalated ?? r.escalate),
      errors: count(r.errors ?? r.error),
      p50Ms: num(r.p50Ms ?? r.p50),
      p95Ms: num(r.p95Ms ?? r.p95),
    });
  }
  return out;
}

/** Gộp các dòng của một tính năng qua mọi chế độ (shadow + on), để hiện một hàng số cho tính năng. */
export function sumFeatureStats(rows: readonly JudgmentStatRow[], feature: JevFeatureId): JudgmentStatRow | null {
  const mine = rows.filter((r) => r.feature === feature);
  if (mine.length === 0) return null;
  const pick = (f: (r: JudgmentStatRow) => number | null) => {
    const vals = mine.map(f).filter((v): v is number => v !== null);
    return vals.length ? Math.max(...vals) : null;
  };
  return {
    feature,
    mode: mine[0].mode,
    total: mine.reduce((a, r) => a + r.total, 0),
    mismatch: mine.reduce((a, r) => a + r.mismatch, 0),
    escalated: mine.reduce((a, r) => a + r.escalated, 0),
    errors: mine.reduce((a, r) => a + r.errors, 0),
    // Phân vị không cộng được; lấy mức cao nhất trong các chế độ để không báo thấp hơn thực tế.
    p50Ms: pick((r) => r.p50Ms),
    p95Ms: pick((r) => r.p95Ms),
  };
}

export function parseJudgments(raw: unknown): JudgmentRow[] {
  const out: JudgmentRow[] = [];
  for (const r of rowsOf(raw)) {
    if (!isRec(r)) continue;
    const id = idOf(r.id);
    const feature = oneOf(JEV_FEATURE_IDS, r.feature);
    const mode = oneOf(JEV_FEATURE_MODES, r.mode);
    const createdAt = str(r.createdAt);
    if (!id || !feature || !mode || !createdAt) continue;
    out.push({
      id,
      feature,
      mode,
      createdAt,
      issueId: str(r.issueId),
      inputExcerpt: str(r.inputExcerpt),
      jevLabel: str(r.jevLabel),
      baseline: str(r.baseline),
      confidence: num(r.confidence),
      mismatch: r.mismatch === true,
      escalated: r.escalated === true,
      errorCode: str(r.errorCode),
      latencyMs: num(r.latencyMs),
      shown: r.shown === true,
      ownerOutcome: str(r.ownerOutcome),
    });
  }
  return out;
}

/**
 * Cờ complexity của một issue. Server chỉ gửi cờ khi cần hiện: `kind: 'jev'` (Jev cho rằng nên là large) hay
 * `kind: 'vision'` (luật xác định). Thiếu cờ (null), sai dạng hoặc `kind` lạ thì không có cờ.
 */
export function parseComplexityFlag(raw: unknown): JevComplexityFlag | null {
  if (!isRec(raw)) return null;
  const kind = oneOf(['jev', 'vision'] as const, raw.kind ?? (raw.jevSaysLarge === true ? 'jev' : null));
  if (!kind) return null;
  return { kind, jevSaysLarge: raw.jevSaysLarge === true, declared: str(raw.declared), reason: str(raw.reason) };
}

/** Cờ complexity theo issue từ response bản đồ (khóa issue id, chữ thường như các bản đồ Jev khác). */
export function complexityFlagFor(map: unknown, issueId: string): JevComplexityFlag | null {
  if (!isRec(map) || !isRec(map.complexityFlags)) return null;
  return parseComplexityFlag(map.complexityFlags[issueId.toLowerCase()] ?? map.complexityFlags[issueId]);
}

/** Cờ cần để ý theo issue: nhận `{items: [...]}` của server (hoặc mảng trần, hay `flags`); issue không có lý do hợp lệ nào thì bỏ. */
export function parseAttention(raw: unknown): Map<string, AttentionFlag['reasons']> {
  const out = new Map<string, AttentionFlag['reasons']>();
  const list = Array.isArray(raw)
    ? raw
    : isRec(raw)
      ? (['flags', 'items'].map((k) => raw[k]).find(Array.isArray) ?? [])
      : [];
  for (const f of list as unknown[]) {
    if (!isRec(f)) continue;
    const issueId = str(f.issueId);
    if (!issueId || !Array.isArray(f.reasons)) continue;
    const reasons: AttentionFlag['reasons'] = [];
    for (const r of f.reasons) {
      if (!isRec(r)) continue;
      const kind = oneOf(ATTENTION_KINDS, r.kind);
      const text = str(r.text);
      if (kind && text) reasons.push({ kind, text });
    }
    if (reasons.length > 0) out.set(issueId.toLowerCase(), reasons);
  }
  return out;
}
