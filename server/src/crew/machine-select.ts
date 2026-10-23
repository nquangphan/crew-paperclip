/**
 * Chọn máy cho một cây yêu cầu. Hàm thuần: dữ liệu ứng viên do `loadMachineCandidates` (`machine-pin.ts`) đọc từ
 * bản tin máy, dòng ghép máy, `project_machines` và lease run đang chạy.
 */

/** Bản tin máy cũ hơn mức này coi như máy mất liên lạc. */
export const MACHINE_REPORT_MAX_AGE_MS = 5 * 60_000;
export const MIN_MEM_FREE_PCT = 10;
/** Ngưỡng tải khi environment mẫu của máy không có `crewLoadGate`. */
export const DEFAULT_MAX_LOAD1 = 8;

export type ProjectMachineStatus = "ready" | "provisioning" | "failed";

export interface MachineCandidate {
  machineId: string;
  hostname: string;
  /** `project_machines.status` của project trên máy này; `null` khi máy chưa dựng project. */
  projectStatus: ProjectMachineStatus | null;
  receivedAt: string | null;
  /** `report.jobsAgent.lastPollAt`: app 2P Crew còn nhận việc máy. */
  jobsPollAt: string | null;
  load1: number | null;
  cpuCount: number | null;
  memFreePct: number | null;
  /** Run `running` của cả instance trên host của máy (lease `active`). */
  running: number;
  maxLoad1: number;
}

export type MachineChoice =
  | { kind: "ready" | "provision" | "overloaded"; candidate: MachineCandidate }
  | { kind: "none" };

const fresh = (at: string | null, now: Date): boolean =>
  at !== null && now.getTime() - Date.parse(at) <= MACHINE_REPORT_MAX_AGE_MS;

export const isOnline = (candidate: MachineCandidate, now: Date): boolean => fresh(candidate.receivedAt, now);

function withinThresholds(c: MachineCandidate): boolean {
  return c.load1 !== null && c.load1 <= c.maxLoad1 && c.memFreePct !== null && c.memFreePct >= MIN_MEM_FREE_PCT;
}

const perCpu = (c: MachineCandidate): number =>
  c.load1 === null ? Number.POSITIVE_INFINITY : c.load1 / Math.max(1, c.cpuCount ?? 1);

function byScore(a: MachineCandidate, b: MachineCandidate): number {
  return a.running - b.running || perCpu(a) - perCpu(b) || a.hostname.localeCompare(b.hostname);
}

const best = (list: MachineCandidate[]): MachineCandidate => [...list].sort(byScore)[0]!;

/**
 * 1. Máy `ready`, online, đạt ngưỡng: ít run nhất, rồi `load1/cpu`, rồi tên máy.
 * 2. Mọi máy `ready` bị loại và project `provisionable`: máy chưa dựng (hoặc đang dựng) online, đạt ngưỡng, app đang
 *    nhận việc → dựng nó. `provisionable` là true khi project có dòng repo (đã biết origin) và có ít nhất một
 *    checkout vai trò để dựng; sai thì máy chưa dựng không bao giờ là ứng viên "provision".
 * 3. Không máy nào đạt: máy `ready` online điểm thấp nhất; cổng tải giữ run như hôm nay.
 * 4. Không có máy `ready` online: không chọn (giữ hành vi stock).
 */
export function chooseMachine(candidates: readonly MachineCandidate[], now: Date, provisionable: boolean): MachineChoice {
  const online = candidates.filter((c) => isOnline(c, now));
  const ready = online.filter((c) => c.projectStatus === "ready");
  const readyOk = ready.filter(withinThresholds);
  if (readyOk.length > 0) return { kind: "ready", candidate: best(readyOk) };
  if (provisionable) {
    const buildable = online.filter(
      (c) =>
        (c.projectStatus === null || c.projectStatus === "provisioning") && fresh(c.jobsPollAt, now) && withinThresholds(c),
    );
    if (buildable.length > 0) return { kind: "provision", candidate: best(buildable) };
  }
  if (ready.length > 0) return { kind: "overloaded", candidate: best(ready) };
  return { kind: "none" };
}

/** Các số lúc chọn, lưu ở `issue_machine_pins.reason` và hiện trên trang issue. */
export function choiceReason(choice: Exclude<MachineChoice, { kind: "none" }>, now: Date): Record<string, unknown> {
  const c = choice.candidate;
  return {
    rule: choice.kind,
    running: c.running,
    load1: c.load1,
    cpuCount: c.cpuCount,
    memFreePct: c.memFreePct,
    reportAgeSec: c.receivedAt === null ? null : Math.round((now.getTime() - Date.parse(c.receivedAt)) / 1000),
  };
}
