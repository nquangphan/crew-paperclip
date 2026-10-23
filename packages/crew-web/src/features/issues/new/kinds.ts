// Loại yêu cầu. Loại không đổi policy ở web: Nghiên cứu, Viết tài liệu và Lập kế hoạch chỉ khác ở nhãn Paperclip gắn
// lúc tạo. Server gắn template reviewer + owner cho nhãn `research`; nhãn `docs` và `plan` (như Code/Bug) nhận đủ
// pipeline gốc:
// reviewer, integrator merge + docs, owner duyệt, integrator push.

export type RequestKind = 'code' | 'bug' | 'research' | 'docs' | 'plan';

export const REQUEST_KINDS: readonly RequestKind[] = ['code', 'bug', 'research', 'docs', 'plan'];

/** Loại được nhận ra bằng một nhãn Paperclip của company. */
export type LabelledKind = 'research' | 'docs' | 'plan';

/** Tên nhãn Paperclip mà server nhận ra là yêu cầu nghiên cứu (server/src/crew/issue-policy.ts CREW_RESEARCH_LABEL). */
export const RESEARCH_LABEL_NAME = 'research';
/** Tên nhãn Paperclip của yêu cầu viết tài liệu; Trợ Lý đọc nhãn này để tách con `crew-kind docs`. */
export const DOCS_LABEL_NAME = 'docs';
/** Tên nhãn Paperclip của yêu cầu lập kế hoạch; Trợ Lý đọc nhãn này để tách con `crew-kind plan`. */
export const PLAN_LABEL_NAME = 'plan';

export const KIND_LABEL_NAMES: Readonly<Record<LabelledKind, string>> = {
  research: RESEARCH_LABEL_NAME,
  docs: DOCS_LABEL_NAME,
  plan: PLAN_LABEL_NAME,
};

const LABELLED_KINDS = Object.keys(KIND_LABEL_NAMES) as LabelledKind[];

export interface LabelLike {
  id: string;
  name: string;
}

/** Id nhãn của từng loại có nhãn; company chưa có nhãn đó thì null. */
export type KindLabelIds = Readonly<Record<LabelledKind, string | null>>;

export function findKindLabelIds(labels: readonly LabelLike[]): KindLabelIds {
  const idOf = (name: string) => labels.find((l) => l.name === name)?.id ?? null;
  return { research: idOf(RESEARCH_LABEL_NAME), docs: idOf(DOCS_LABEL_NAME), plan: idOf(PLAN_LABEL_NAME) };
}

export function isLabelledKind(kind: RequestKind): kind is LabelledKind {
  return (LABELLED_KINDS as readonly string[]).includes(kind);
}

/** Loại chọn được: loại có nhãn chỉ hiện khi company đã có nhãn đó. */
export function availableKinds(labelIds: KindLabelIds): RequestKind[] {
  return REQUEST_KINDS.filter((k) => !isLabelledKind(k) || labelIds[k] !== null);
}

/** Loại có nhãn mà company còn thiếu nhãn, theo thứ tự hiển thị. */
export function missingKindLabels(labelIds: KindLabelIds): LabelledKind[] {
  return LABELLED_KINDS.filter((k) => labelIds[k] === null);
}

/** Loại của issue theo nhãn đã gắn (theo thứ tự research, docs, plan khi có nhiều nhãn); không có nhãn loại thì null. */
export function labelledKindOf(labels: readonly { name: string }[] | null | undefined): LabelledKind | null {
  const names = new Set((labels ?? []).map((l) => l.name));
  return LABELLED_KINDS.find((k) => names.has(KIND_LABEL_NAMES[k])) ?? null;
}

export function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === 'string' && (REQUEST_KINDS as readonly string[]).includes(value);
}

/** Chưa đọc được nhãn (đang tải hoặc lỗi): coi như chưa có nhãn nào. */
export const NO_KIND_LABELS: KindLabelIds = { research: null, docs: null, plan: null };
