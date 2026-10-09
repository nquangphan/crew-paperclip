// Lối "Làm tiếp" từ trạng thái sẵn sàng (S8.5, S11.8) vào đúng wizard và đúng bước.
import type { ResumeTarget } from '@/features/readiness';

/** Dạng tối thiểu của setup run mà lối "Làm tiếp" đọc (nhận cả SetupRun của `@/api`). */
export interface ResumableRun {
  id: string;
  kind: string;
  status: string;
  updatedAt?: string;
  steps: Partial<Record<string, { refs?: Record<string, string> } | undefined>>;
}

export const companyHref = (prefix: string, to: string): string =>
  `/${encodeURIComponent(prefix)}/${to.replace(/^\//, '')}`;

/** Setup run tạo agent chưa xong, mới nhất, có `refs.agent` là agent này; không có thì null. */
export function findAgentRun<R extends ResumableRun>(runs: readonly R[], agentId: string): R | null {
  const hits = runs.filter(
    (run) =>
      run.kind === 'add-agent' &&
      run.status !== 'done' &&
      Object.values(run.steps).some((step) => step?.refs?.agent === agentId),
  );
  hits.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return hits[0] ?? null;
}

/**
 * Link "Làm tiếp". Agent có setup run tạo agent đang dở → chạy tiếp run đó; không có (agent do app tạo, hay run đã
 * xong) → wizard tạo agent ở chế độ sửa từ bước `step`. `runs` là `crew.setupRuns` của company (không truyền thì chỉ dựng
 * link chế độ sửa; trang wizard tự chuyển sang run dở nếu có).
 */
export function resumeHref(prefix: string, target: ResumeTarget, runs: readonly ResumableRun[] = []): string | null {
  if ('none' in target) return null;
  if (target.wizard === 'add-project') {
    return companyHref(prefix, `projects/new?resume=${encodeURIComponent(target.setupRunId)}`);
  }
  const run = findAgentRun(runs, target.agentId);
  if (run) return companyHref(prefix, `agents/new?resume=${encodeURIComponent(run.id)}`);
  return companyHref(
    prefix,
    `agents/new?fix=${encodeURIComponent(target.agentId)}&step=${encodeURIComponent(target.step)}`,
  );
}
