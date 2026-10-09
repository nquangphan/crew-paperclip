// Chờ một việc trên máy (I1) xong: hỏi lại hàng đợi 2 giây một lần tới khi việc done, failed hay quá hạn.
import type { JobErrorCode, JobResult, MachineJob, MachineJobStatus } from '@/api';

export const JOB_POLL_MS = 2_000;

/** Phần của `api.jobs` mà waitJob cần. */
export interface WaitJobSource {
  jobs: {
    list(
      companyId: string,
      query?: { machineId?: string; status?: MachineJobStatus; setupRunId?: string; limit?: number },
    ): Promise<MachineJob[]>;
  };
}

export class JobFailedError extends Error {
  readonly errorCode: JobErrorCode | null;
  readonly errorText: string | null;
  readonly result: JobResult | null;
  readonly status: MachineJobStatus;

  constructor(job: MachineJob) {
    super(job.errorText ?? job.errorCode ?? job.status);
    this.name = 'JobFailedError';
    this.errorCode = job.errorCode;
    this.errorText = job.errorText;
    this.result = job.result;
    this.status = job.status;
  }
}

export class JobTimeoutError extends Error {
  readonly jobId: string;
  readonly timeoutMs: number;

  constructor(jobId: string, timeoutMs: number) {
    super(`job ${jobId} timeout ${timeoutMs}ms`);
    this.name = 'JobTimeoutError';
    this.jobId = jobId;
    this.timeoutMs = timeoutMs;
  }
}

const abortError = () => new DOMException('Aborted', 'AbortError');

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface WaitJobOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  intervalMs?: number;
}

/** Trả việc khi `done`; `failed`/`cancelled` ném JobFailedError; quá `timeoutMs` ném JobTimeoutError. */
export async function waitJob(
  source: WaitJobSource,
  job: Pick<MachineJob, 'id' | 'companyId' | 'machineId' | 'setupRunId'>,
  opts: WaitJobOptions,
): Promise<MachineJob> {
  const started = Date.now();
  const query = {
    machineId: job.machineId,
    ...(job.setupRunId ? { setupRunId: job.setupRunId } : {}),
    limit: 100,
  };
  for (;;) {
    if (opts.signal?.aborted) throw abortError();
    const current = (await source.jobs.list(job.companyId, query)).find((j) => j.id === job.id);
    if (current?.status === 'done') return current;
    if (current && (current.status === 'failed' || current.status === 'cancelled')) throw new JobFailedError(current);
    if (Date.now() - started >= opts.timeoutMs) throw new JobTimeoutError(job.id, opts.timeoutMs);
    await sleep(opts.intervalMs ?? JOB_POLL_MS, opts.signal);
  }
}
