import { and, asc, eq, sql } from "drizzle-orm";
import { activityLog, type Db, type heartbeatRuns, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";
import { issueService } from "../services/issues.js";
import {
  agentEnvironmentOnMachine, findRootIssueId, insertAutoPin, loadMachineCandidates, machineHostname, machineTablesReady,
  type PairedMachine, pairedMachine, readPin,
} from "./machine-pin.js";
import {
  listProjectMachines, PROVISION_TIMEOUT_MS, PROVISION_UNAVAILABLE, projectLayout, projectProvisionable, readProjectMachine,
  reconcileProjectMachine, startProvisioning,
} from "./machine-provision.js";
import { choiceReason, chooseMachine } from "./machine-select.js";
import { rowsOf } from "./project-roles.js";

type Run = typeof heartbeatRuns.$inferSelect;

export type MachineGateOutcome =
  | { action: "pass"; environmentId: string | null }
  | { action: "hold" }
  | { action: "fail"; issueId: string; reason: string };

export const MACHINE_PINNED_ACTION = "crew.machine.pinned";
export const MACHINE_WAITING_ACTION = "crew.machine.waiting";
export const MACHINE_FAILED_ACTION = "crew.machine.failed";

const PASS: MachineGateOutcome = { action: "pass", environmentId: null };
const HOLD: MachineGateOutcome = { action: "hold" };

/**
 * Cây có ghim hay không, theo những gì cổng đã đọc hoặc ghi trước khi lỗi: `false` khi chưa đọc được ghim nào, `null`
 * khi đang ghi ghim (có thể đã ghi), `true` khi cây đã ghim.
 */
interface PinState { pinned: boolean | null }

function readIssueId(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const value = (contextSnapshot as Record<string, unknown>).issueId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Ghi activity một lần mỗi run (dấu bền), rồi comment hệ thống; comment lỗi chỉ ghi log. */
async function noteOnce(
  db: Db, run: Run, issueId: string, action: string, body: string, details: Record<string, unknown>,
): Promise<void> {
  const [seen] = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(and(eq(activityLog.runId, run.id), eq(activityLog.action, action)))
    .limit(1);
  if (seen) return;
  await logActivity(db, {
    companyId: run.companyId, actorType: "system", actorId: "crew", action, entityType: "heartbeat_run", entityId: run.id,
    agentId: run.agentId, runId: run.id, issueId, details,
  });
  try {
    await issueService(db).addComment(issueId, body, {}, { authorType: "system" });
  } catch (err) {
    logger.warn({ err, runId: run.id, action }, "crew-machine-gate: comment failed");
  }
}

/** Lúc run bắt đầu chờ máy ghim (activity chờ đầu tiên), hoặc `null` khi chưa chờ lần nào. */
async function waitingSince(db: Db, runId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: activityLog.createdAt })
    .from(activityLog)
    .where(and(eq(activityLog.runId, runId), eq(activityLog.action, MACHINE_WAITING_ACTION)))
    .orderBy(asc(activityLog.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/** Environment mặc định của agent là SSH `active`: run của agent chạy trên một máy Mac, không chạy trên server. */
async function agentRunsOnMac(db: Db, companyId: string, agentId: string): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`SELECT 1 AS ok FROM agents a JOIN environments e ON e.id = a.default_environment_id
    WHERE a.id = ${agentId} AND a.company_id = ${companyId} AND e.driver = 'ssh' AND e.status = 'active' LIMIT 1`));
  return rows.length > 0;
}

async function fail(db: Db, run: Run, issueId: string, machine: PairedMachine, error: string): Promise<MachineGateOutcome> {
  await noteOnce(db, run, issueId, MACHINE_FAILED_ACTION,
    `Không dựng được project trên máy ${machine.hostname}: ${error}. Crew hủy run \`${run.id}\` và chuyển issue sang ` +
      "`blocked`. Sửa lỗi rồi bấm Thêm máy ở trang project → Máy, sau đó chuyển issue về `todo`.",
    { machineId: machine.machineId, error });
  return { action: "fail", issueId, reason: `không dựng được project trên máy ${machine.hostname}: ${error}` };
}

async function wait(db: Db, run: Run, issueId: string, machineId: string, body: string): Promise<MachineGateOutcome> {
  await noteOnce(db, run, issueId, MACHINE_WAITING_ACTION, body, { machineId });
  return HOLD;
}

async function decide(db: Db, run: Run, now: Date, state: PinState): Promise<MachineGateOutcome> {
  const issueId = readIssueId(run.contextSnapshot);
  if (!issueId || !(await machineTablesReady(db))) return PASS;
  const rootIssueId = await findRootIssueId(db, run.companyId, issueId);
  if (!rootIssueId) return PASS;
  const [root] = await db
    .select({ projectId: issues.projectId })
    .from(issues)
    .where(and(eq(issues.id, rootIssueId), eq(issues.companyId, run.companyId)))
    .limit(1);
  const projectId = root?.projectId ?? null;
  if (!projectId) return PASS;

  let pin = await readPin(db, run.companyId, rootIssueId);
  state.pinned = pin !== null;
  if (!pin) {
    if ((await listProjectMachines(db, run.companyId, projectId)).length === 0) return PASS;
    const candidates = await loadMachineCandidates(db, run.companyId, projectId);
    const choice = chooseMachine(candidates, now, await projectProvisionable(db, run.companyId, projectId));
    if (choice.kind === "none") return PASS;
    const reason = choiceReason(choice, now);
    state.pinned = null;
    const written = await insertAutoPin(db, { companyId: run.companyId, rootIssueId, machineId: choice.candidate.machineId, reason });
    state.pinned = true;
    pin = written.pin;
    if (written.inserted) {
      await logActivity(db, {
        companyId: run.companyId, actorType: "system", actorId: "crew", action: MACHINE_PINNED_ACTION, entityType: "issue",
        entityId: rootIssueId, agentId: run.agentId, runId: run.id, issueId: rootIssueId,
        details: { machineId: pin.machineId, hostname: choice.candidate.hostname, reason },
      });
    }
  }

  // Từ đây cây đã ghim: không bao giờ `pass` với `null`, vì environment mặc định có thể nằm trên máy khác.
  const machine = await pairedMachine(db, run.companyId, pin.machineId);
  if (!machine) {
    const hostname = (await machineHostname(db, run.companyId, pin.machineId)) ?? pin.machineId;
    return wait(db, run, issueId, pin.machineId,
      `Run \`${run.id}\` đang chờ máy ${hostname}: cây yêu cầu đã ghim vào máy này nhưng máy không còn ghép với Crew. ` +
        "Ghép lại máy trong app 2P Crew → Máy để run tự chạy.");
  }
  const ready = await agentEnvironmentOnMachine(db, run.companyId, run.agentId, machine);
  if (ready) return { action: "pass", environmentId: ready };
  const layout = await projectLayout(db, run.companyId, projectId);
  if (!layout?.agents.some((agent) => agent.agentId === run.agentId)) {
    if (!(await agentRunsOnMac(db, run.companyId, run.agentId))) return PASS;
    return wait(db, run, issueId, machine.machineId,
      `Run \`${run.id}\` đang chờ: agent không có environment trên máy ${machine.hostname} (máy ghim của cây yêu cầu) ` +
        "và không phải agent vai trò của project nên Crew không tự dựng được. Tạo environment cho agent trên máy này để run tự chạy.");
  }

  let row = await reconcileProjectMachine(db, { companyId: run.companyId, projectId, machineId: machine.machineId });
  const built = await agentEnvironmentOnMachine(db, run.companyId, run.agentId, machine);
  if (built) return { action: "pass", environmentId: built };
  if (row?.status === "failed") return fail(db, run, issueId, machine, row.error ?? "dựng project thất bại");
  if (!row || row.status === "ready") {
    const started = await startProvisioning(db, { companyId: run.companyId, projectId, machineId: machine.machineId, createdBy: "crew:auto" });
    if (!started.ok) return fail(db, run, issueId, machine, PROVISION_UNAVAILABLE[started.reason]);
    row = await readProjectMachine(db, run.companyId, projectId, machine.machineId);
  }
  const since = await waitingSince(db, run.id);
  if (since && now.getTime() - since.getTime() > PROVISION_TIMEOUT_MS) {
    return fail(db, run, issueId, machine, "máy chưa dựng xong project sau 60 phút (app 2P Crew trên máy có đang mở không?)");
  }
  return wait(db, run, issueId, machine.machineId,
    `Run \`${run.id}\` đang chờ dựng project trên máy ${machine.hostname}. Run sẽ tự chạy khi máy dựng xong ` +
      "(xem trang project → Máy).");
}

/**
 * Bước đầu của cổng claim. Không có issue, bảng chưa có hay project chưa có máy nào trong `project_machines`: `pass`
 * với `null` (hành vi stock). Cây chưa ghim thì chọn máy rồi ghim `auto` (máy chưa dựng project chỉ được chọn khi project
 * dựng được). Cây đã ghim: agent có environment trên máy ghim thì `pass` kèm id đó; máy ghim không còn ghép, hay agent
 * không phải vai trò của project mà chạy trên Mac khác, thì `hold`; agent vai trò thiếu environment thì đối chiếu việc
 * dựng, xếp lại việc khi cần và `hold` với comment một lần mỗi run; dựng hỏng, không dựng được, hay run chờ máy dựng quá
 * `PROVISION_TIMEOUT_MS` thì `fail` (việc dựng vẫn nằm trong hàng đợi). Lỗi bất ngờ khi cây đã ghim (hoặc vừa ghi ghim)
 * thì `hold`, để run không bao giờ chạy trên máy khác máy ghim; cây chưa ghim thì `pass` như stock.
 */
export async function evaluateMachineGate(db: Db, run: Run, now: Date = new Date()): Promise<MachineGateOutcome> {
  const state: PinState = { pinned: false };
  try {
    return await decide(db, run, now, state);
  } catch (err) {
    const hold = state.pinned !== false;
    logger.warn(
      { err, runId: run.id },
      hold ? "crew-machine-gate: failed on a pinned tree; run stays queued" : "crew-machine-gate: failed before pinning; stock environment",
    );
    return hold ? HOLD : PASS;
  }
}
