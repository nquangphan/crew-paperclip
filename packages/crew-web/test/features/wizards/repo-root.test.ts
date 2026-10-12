import { describe, expect, it } from 'vitest';
import type { MachineJob } from '@/api';
import { resolveRepoRoot } from '@/features/wizards/add-agent/repo-root';
import { JobTimeoutError } from '@/features/wizards/add-project/wait-job';
import { COMPANY, fakeApi } from './fake-api';

const CHECKOUT = '/Users/owner/crew-agents/kidy-school-2-0-docs/executor-1';
const ROOT = '/Users/owner/Documents/projects/kidy_school_2.0_docs';
/** Câu lỗi app Mac hiện tại trả khi kiểm một worktree phụ (`projects/folder.ts` của app). */
const LINKED = `${CHECKOUT} là worktree phụ của repo ${ROOT}: chọn thư mục repo chính (worktree chính)`;
const target = { companyId: COMPANY, machineId: 'm1', checkout: CHECKOUT };

const linkedOutcome = () => ({ status: 'failed' as const, errorCode: 'folder_not_git' as const, errorText: LINKED });

describe('resolveRepoRoot', () => {
  it('checkout là worktree phụ: xếp inspect-folder ngoài setup run, đọc repo gốc từ lỗi của app', async () => {
    const f = fakeApi({ jobOutcome: linkedOutcome });
    expect(await resolveRepoRoot(f.api, target, { pollMs: 1 })).toBe(ROOT);
    expect(f.calls.find((c) => c.fn === 'jobs.create')?.args[0]).toEqual({
      companyId: COMPANY,
      machineId: 'm1',
      kind: 'inspect-folder',
      payload: { kind: 'inspect-folder', folder: CHECKOUT },
    });
  });

  it('đã có việc kiểm checkout này ra gốc: dùng lại, không xếp việc mới', async () => {
    const f = fakeApi();
    f.state.jobs.push({
      id: 'j-old',
      companyId: COMPANY,
      machineId: 'm1',
      kind: 'inspect-folder',
      payload: { kind: 'inspect-folder', folder: CHECKOUT },
      status: 'failed',
      result: null,
      errorCode: 'folder_not_git',
      errorText: LINKED,
      attempts: 1,
      setupRunId: null,
      createdAt: '2026-10-12T00:00:00Z',
      claimedAt: null,
      finishedAt: null,
    } satisfies MachineJob);
    expect(await resolveRepoRoot(f.api, target, { pollMs: 1 })).toBe(ROOT);
    expect(f.names()).not.toContain('jobs.create');
  });

  it('checkout là repo thường (app trả gốc chính là checkout): không nhận làm repo gốc', async () => {
    const f = fakeApi();
    expect(await resolveRepoRoot(f.api, target, { pollMs: 1 })).toBeNull();
  });

  it('lỗi khác của app thì null', async () => {
    const f = fakeApi({
      jobOutcome: () => ({
        status: 'failed',
        errorCode: 'folder_missing',
        errorText: `Không tìm thấy folder ${CHECKOUT}`,
      }),
    });
    expect(await resolveRepoRoot(f.api, target, { pollMs: 1 })).toBeNull();
  });

  it('app trên máy chưa nhận việc trong thời hạn: JobTimeoutError', async () => {
    const f = fakeApi({ jobOutcome: () => ({ status: 'queued' }) });
    await expect(resolveRepoRoot(f.api, target, { pollMs: 1, timeoutMs: 5 })).rejects.toBeInstanceOf(JobTimeoutError);
  });
});
