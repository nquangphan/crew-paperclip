// Từ yêu cầu Lập kế hoạch đã xong sang yêu cầu Code "Làm theo kế hoạch này". Thuần: đọc path plan và link PR từ mục
// tổng kết Trợ Lý ghi trong mô tả (`- File kế hoạch: \`<path>\``, `- Pull request: <url>`) rồi dựng giá trị điền sẵn cho
// hộp Yêu cầu mới. Thiếu phần nào thì bỏ phần đó, nút vẫn dùng được.
import { PLAN_LABEL_NAME, type RequestKind } from './kinds';

/** Giá trị điền sẵn cho hộp Yêu cầu mới. */
export interface NewRequestInitial {
  title: string;
  description: string;
  kind: RequestKind;
  projectId: string;
}

export interface PlanSource {
  path: string | null;
  prUrl: string | null;
}

/** Phần yêu cầu kế hoạch mà nút cần. */
export interface PlanIssue {
  identifier?: string | null;
  id?: string;
  title: string;
  description?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  status: string;
  labels?: readonly { id?: string; name: string }[] | null;
}

const PATH_LINE = /^[ \t]*[-*][ \t]*File kế hoạch:[ \t]*`([^`\n]+)`/m;
const PR_LINE = /^[ \t]*[-*][ \t]*Pull request:[ \t]*(.*)$/m;
const HTTP_URL = /https?:\/\/[^\s)>\]]+/;

export function parsePlanSource(description: string | null | undefined): PlanSource {
  const text = description ?? '';
  const path = PATH_LINE.exec(text)?.[1]?.trim() || null;
  const prUrl = HTTP_URL.exec(PR_LINE.exec(text)?.[1] ?? '')?.[0] ?? null;
  return { path, prUrl };
}

export function followPlanInitial(issue: PlanIssue): NewRequestInitial {
  const { path, prUrl } = parsePlanSource(issue.description);
  const code = issue.identifier ?? issue.id ?? '';
  const lines = [
    path ? `crew-from-plan ${path}` : null,
    prUrl ? `Kế hoạch: ${code} · PR: ${prUrl}` : `Kế hoạch: ${code}`,
    prUrl ? 'Merge PR kế hoạch trước khi bắt đầu làm.' : null,
  ].filter((l): l is string => l !== null);
  return {
    projectId: issue.projectId ?? '',
    kind: 'code',
    title: `Làm theo kế hoạch: ${issue.title}`,
    description: lines.join('\n'),
  };
}

/** Yêu cầu gốc có nhãn `plan` và đã xong. Quyền ghi do nơi gọi kiểm. */
export function canFollowPlan(issue: Pick<PlanIssue, 'parentId' | 'status' | 'labels'>): boolean {
  return !issue.parentId && issue.status === 'done' && (issue.labels ?? []).some((l) => l.name === PLAN_LABEL_NAME);
}
