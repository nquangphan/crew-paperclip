// Đường dẫn trong company cho link của feature project (feature không import từ app).
import type { ResumeTarget } from '@/features/readiness';

export const companyHref = (prefix: string, to: string): string =>
  `/${encodeURIComponent(prefix)}/${to.replace(/^\//, '')}`;

export const projectRef = (project: { id: string; urlKey?: string | null }): string => project.urlKey || project.id;

/** Lối "Làm tiếp" vào wizard. Agent không có setup run thì wizard chạy chế độ sửa (`fix` + `step`). */
export function resumeHref(prefix: string, target: ResumeTarget): string | null {
  if ('none' in target) return null;
  if (target.wizard === 'add-project') {
    return companyHref(prefix, `projects/new?resume=${encodeURIComponent(target.setupRunId)}`);
  }
  return companyHref(
    prefix,
    `agents/new?fix=${encodeURIComponent(target.agentId)}&step=${encodeURIComponent(target.step)}`,
  );
}
