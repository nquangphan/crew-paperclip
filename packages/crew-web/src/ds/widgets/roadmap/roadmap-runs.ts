// crew: tự dựng
// Hàm thuần cho dòng run trên thẻ bản đồ: rút gọn tên agent, nhãn model ngắn, thời lượng gọn, màu trạng thái, và dựng
// `RoadmapRuns` từ dữ liệu run tóm tắt của server (cùng hình với `IssueMapRuns`/`MapRunTotals` của plugin).
import type { RoadmapRun, RoadmapRuns, RoadmapRunTotals } from './roadmap-types';

/** Số dòng run tối đa trên một thẻ; phần dư gộp thành "+N run". */
export const ROADMAP_RUN_LINES = 3;

const ROLE_SUFFIX = /(?:^|[-_\s])((?:assistant|executor|reviewer|integrator)(?:[-_\s]?\d+)?)$/i;

/** Bỏ tiền tố project của tên agent: `my-money-executor-1` → `executor-1`; tên không theo mẫu vai giữ nguyên. */
export function shortAgentName(name: string): string {
  const match = ROLE_SUFFIX.exec(name.trim());
  return match ? match[1] : name.trim();
}

const FAMILY = /(opus|sonnet|haiku)/;

/**
 * Nhãn model ngắn: `claude-sonnet-5` → `Sonnet 5`, `claude-opus-4-1-20250805` → `Opus 4.1`, `claude-3-5-haiku-20241022`
 * → `Haiku 3.5`. Model ngoài Claude giữ mã (bỏ tiền tố nhà cung cấp `provider/`). null khi không biết model.
 */
export function modelLabel(model: string | null | undefined): string | null {
  const id = model
    ?.trim()
    .toLowerCase()
    .replace(/\[.*?\]/g, '')
    .split('/')
    .pop();
  if (!id) return null;
  const family = FAMILY.exec(id);
  if (!family) return id;
  const name = family[1][0].toUpperCase() + family[1].slice(1);
  const after = /^-(\d{1,2})(?:[-.](\d{1,2}))?(?=$|-)/.exec(id.slice(family.index + family[1].length));
  const before = /(?:^|-)(\d{1,2})(?:[-.](\d{1,2}))?-$/.exec(id.slice(0, family.index));
  const version = after ?? before;
  return version ? `${name} ${version[1]}${version[2] ? `.${version[2]}` : ''}` : name;
}

/** Thời lượng gọn: `45s`, `12m`, `1h05m`. null khi chưa bắt đầu hoặc mốc giờ hỏng. */
export function formatRunDuration(startedAt: string | null, finishedAt: string | null, now: number): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

/** Run còn đang chạy (thời lượng tính tới hiện tại). */
export const isRunActive = (run: Pick<RoadmapRun, 'status' | 'finishedAt'>) =>
  run.status === 'running' && run.finishedAt === null;

export type RunTone = 'running' | 'queued' | 'succeeded' | 'failed' | 'cancelled';

/** Nhóm màu của chấm trạng thái run. Trạng thái lạ xếp vào xám. */
export function runTone(status: string): RunTone {
  switch (status) {
    case 'running':
      return 'running';
    case 'queued':
    case 'scheduled_retry':
      return 'queued';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'timed_out':
    case 'error':
      return 'failed';
    default:
      return 'cancelled';
  }
}

interface IssueRunsLike {
  runs: readonly RoadmapRun[];
  count: number;
  costUsd: number | null;
  subscription: boolean;
}

const NO_RUNS: RoadmapRunTotals = { count: 0, costUsd: null, subscription: false };

/**
 * Run của một thẻ từ dữ liệu server: `own` là run của chính việc, `tree` (chỉ yêu cầu gốc) là tổng cả cây cho chân thẻ.
 * Không có run nào (kể cả trong cây) thì undefined: thẻ không vẽ khối run.
 */
export function roadmapRuns(own: IssueRunsLike | undefined, tree?: RoadmapRunTotals): RoadmapRuns | undefined {
  const total = tree ?? own ?? NO_RUNS;
  if (total.count === 0 && !own?.runs.length) return undefined;
  return {
    runs: own?.runs ?? [],
    count: own?.count ?? 0,
    total: { count: total.count, costUsd: total.costUsd, subscription: total.subscription, tree: !!tree },
  };
}

/** Số dòng run vẽ trên thẻ (không tính dòng chân). */
export const runLines = (runs: RoadmapRuns | undefined): number =>
  runs ? Math.min(ROADMAP_RUN_LINES, runs.runs.length) : 0;
