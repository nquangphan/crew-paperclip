// Loại yêu cầu. Loại không đổi policy ở web: Nghiên cứu chỉ khác ở nhãn `research` (server gắn template reviewer + owner).

export type RequestKind = 'code' | 'bug' | 'research';

export const REQUEST_KINDS: readonly RequestKind[] = ['code', 'bug', 'research'];

/** Tên nhãn Paperclip mà server nhận ra là yêu cầu nghiên cứu (server/src/crew/issue-policy.ts CREW_RESEARCH_LABEL). */
export const RESEARCH_LABEL_NAME = 'research';

export interface LabelLike {
  id: string;
  name: string;
}

export function findResearchLabelId(labels: readonly LabelLike[]): string | null {
  return labels.find((l) => l.name === RESEARCH_LABEL_NAME)?.id ?? null;
}

export function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === 'string' && (REQUEST_KINDS as readonly string[]).includes(value);
}
