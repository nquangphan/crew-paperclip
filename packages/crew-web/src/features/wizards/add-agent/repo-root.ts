// Repo gốc của project trên máy, hỏi từ một checkout agent đang có (`~/crew-agents/<khóa>/<ô>`), cho form tạo agent
// của project không có lần thêm project (project thêm từ app Mac). Dùng việc `inspect-folder` của app Mac hiện tại:
// checkout là worktree phụ nên app báo `folder_not_git` kèm câu "là worktree phụ của repo <gốc>"; gốc đọc từ câu đó.
// Việc này chỉ đọc trên máy (không ghi gì), nên xếp ngoài setup run được.
import type { MachineJob } from '@/api';
import type { AddProjectApi } from '../add-project/run-step';
import { JobFailedError, waitJob } from '../add-project/wait-job';
import { isUnderCheckouts, rootFromInspectError } from '../machine-host';

/** Hỏi máy tối đa chừng này; quá thì form cho nhập folder (việc vẫn nằm trong hàng đợi, lần mở form sau dùng lại). */
export const REPO_ROOT_TIMEOUT_MS = 45_000;

/** Repo gốc mà việc `inspect-folder` đã xong cho ra, hoặc null (việc chưa xong, lỗi khác, gốc là checkout). */
export function rootOfInspectJob(job: Pick<MachineJob, 'kind' | 'status' | 'result' | 'errorCode' | 'errorText'>) {
  if (job.kind !== 'inspect-folder') return null;
  if (job.status === 'done' && job.result?.kind === 'inspect-folder') {
    return isUnderCheckouts(job.result.root) ? null : job.result.root;
  }
  if (job.status === 'failed' && job.errorCode === 'folder_not_git') return rootFromInspectError(job.errorText);
  return null;
}

const folderOf = (job: MachineJob) => (job.payload as { folder?: unknown }).folder;

/**
 * Repo gốc sau checkout `checkout` trên máy `machineId`: dùng lại việc kiểm checkout đó đã có (đang chờ thì chờ tiếp),
 * không có thì xếp việc mới rồi chờ tối đa `timeoutMs`. Không ra gốc thì null; quá hạn thì ném JobTimeoutError.
 */
export async function resolveRepoRoot(
  api: { jobs: AddProjectApi['jobs'] },
  target: { companyId: string; machineId: string; checkout: string },
  opts: { timeoutMs?: number; signal?: AbortSignal; pollMs?: number } = {},
): Promise<string | null> {
  const { companyId, machineId, checkout } = target;
  const recent = (await api.jobs.list(companyId, { machineId, limit: 100 })).filter(
    (job) => job.kind === 'inspect-folder' && folderOf(job) === checkout,
  );
  for (const job of recent) {
    const root = rootOfInspectJob(job);
    if (root) return root;
  }
  const pending =
    recent.find((job) => job.status === 'queued' || job.status === 'claimed') ??
    (await api.jobs.create({
      companyId,
      machineId,
      kind: 'inspect-folder',
      payload: { kind: 'inspect-folder', folder: checkout },
    }));
  try {
    const done = await waitJob(api, pending, {
      timeoutMs: opts.timeoutMs ?? REPO_ROOT_TIMEOUT_MS,
      signal: opts.signal,
      intervalMs: opts.pollMs,
    });
    return rootOfInspectJob(done);
  } catch (error) {
    if (error instanceof JobFailedError) {
      return rootOfInspectJob({
        kind: 'inspect-folder',
        status: 'failed',
        result: error.result,
        errorCode: error.errorCode,
        errorText: error.errorText,
      });
    }
    throw error;
  }
}
