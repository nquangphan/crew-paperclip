import { type Request, Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, issues, projects } from "@paperclipai/db";
import { badRequest, forbidden, HttpError, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { hasCompanyAccess } from "../routes/authz.js";
import { isUuid, requireOwner, resolveContributionActor } from "./contributions.js";
import {
  findRootIssueId, loadMachineCandidates, machineHostname, machineTablesReady, pairedMachine, pairedMachines, readPin,
  setOwnerPin, treeStarted,
} from "./machine-pin.js";
import {
  listProjectMachines, PROVISION_UNAVAILABLE, projectLayout, type ProvisionStart, readProjectMachine, readProjectRepo,
  reconcileProjectMachine, startProvisioning, writeProjectRepo,
} from "./machine-provision.js";
import { machineReleaseBlockers, provisionOtherMachines, releaseProjectMachines } from "./machine-release.js";
import { isOnline } from "./machine-select.js";
import { rowsOf } from "./project-roles.js";

const BASE = "/crew/companies/:companyId";

export const MACHINE_ERRORS = {
  invalid: "crew_machine_invalid",
  unavailable: "crew_machine_unavailable",
  notRoot: "crew_machine_not_root",
  locked: "crew_machine_locked",
  unknownMachine: "crew_machine_unknown",
  noRepo: "crew_machine_no_repo",
  noRoles: "crew_machine_no_roles",
  busy: "crew_machine_busy",
  forbidden: "crew_machine_forbidden",
} as const;

export const ORIGIN_RE = /^(?:(?:https|ssh|file):\/\/\S+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+)$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;
const COMPANION_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ký tự điều khiển là thứ bị từ chối
const CONTROL_RE = /[\x00-\x1f\x7f]/;
/** Origin không được mang user/token (`https://user:token@…`): không bao giờ lưu credential. */
const origin = z.string().max(500).regex(ORIGIN_RE)
  .refine((value) => !CONTROL_RE.test(value) && !/^https:\/\/[^/]*@/.test(value));

export const projectRepoSchema = z.object({
  originUrl: origin,
  branch: z.string().regex(BRANCH_RE).refine((value) => !value.startsWith("-")),
  companions: z.array(z.object({ name: z.string().regex(COMPANION_NAME_RE).refine((n) => n !== "repo"), originUrl: origin }).strict())
    .max(5)
    .refine((list) => new Set(list.map((item) => item.name)).size === list.length, "tên repo đi kèm bị trùng"),
}).strict();
const machineBodySchema = z.object({ machineId: z.string().uuid() }).strict();

const invalidRepo = (message: string, issues?: unknown) =>
  new HttpError(422, message, { code: MACHINE_ERRORS.invalid, ...(issues ? { issues } : {}) });

const unavailable = () =>
  new HttpError(503, "Crew: chưa có bảng máy của project (plugin crew.core chưa nâng cấp), hãy thử lại sau.", { code: MACHINE_ERRORS.unavailable });

function provisionError(reason: Extract<ProvisionStart, { ok: false }>["reason"]): HttpError {
  if (reason === "not_paired") return new HttpError(422, `${PROVISION_UNAVAILABLE.not_paired}.`, { code: MACHINE_ERRORS.unknownMachine });
  if (reason === "no_repo") return new HttpError(409, `${PROVISION_UNAVAILABLE.no_repo}.`, { code: MACHINE_ERRORS.noRepo });
  return new HttpError(409, `${PROVISION_UNAVAILABLE.no_roles}.`, { code: MACHINE_ERRORS.noRoles });
}

async function loadIssue(db: Db, companyId: string, issueId: string) {
  if (!isUuid(issueId)) throw notFound("Không có yêu cầu này.");
  const [issue] = await db
    .select({ id: issues.id, parentId: issues.parentId, projectId: issues.projectId })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
    .limit(1);
  if (!issue) throw notFound("Không có yêu cầu này.");
  return issue;
}

async function assertProject(db: Db, companyId: string, projectId: string): Promise<void> {
  if (!isUuid(projectId)) throw notFound("Không có project này.");
  const [project] = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId))).limit(1);
  if (!project) throw notFound("Không có project này.");
}

async function issueMachineView(db: Db, companyId: string, issueId: string) {
  const issue = await loadIssue(db, companyId, issueId);
  const rootIssueId = (await findRootIssueId(db, companyId, issue.id)) ?? issue.id;
  const pin = await readPin(db, companyId, rootIssueId);
  return {
    rootIssueId,
    isRoot: rootIssueId === issue.id,
    locked: await treeStarted(db, companyId, rootIssueId),
    pin: pin
      ? {
        machineId: pin.machineId,
        hostname: (await machineHostname(db, companyId, pin.machineId)) ?? pin.machineId,
        source: pin.source,
        reason: pin.reason,
        pinnedAt: pin.pinnedAt,
      }
      : null,
  };
}

/**
 * Router máy của Crew (flow `multi-machine`), gắn trong router góp ý nên không cần vá lõi mới. Cùng luật người gọi:
 * actor board bằng phiên trình duyệt, role đọc từ DB. Đọc: mọi thành viên; ghi: chỉ owner.
 *
 * - `GET  …/machines?projectId=`: máy đã ghép cho form chọn máy (online, số run, tải, trạng thái project).
 * - `GET  …/issues/:issueId/machine`, `PUT` `{ machineId }`: ghim máy của cây yêu cầu; chỉ issue gốc, cây đã có lease
 *   thì khóa; máy chưa dựng project thì xếp `ensure-project` trước khi ghim.
 * - `GET  …/projects/:projectId/machines`: repo và máy của project, đối chiếu việc dựng đang chờ trước khi trả.
 * - `POST …/projects/:projectId/machines` `{ machineId }`: dựng project trên một máy (202).
 * - `PUT  …/projects/:projectId/repo`: origin, nhánh và repo đi kèm; sai luật thì 422 `crew_machine_invalid`.
 * - `GET  …/projects/:projectId/machines/blockers?agentIds=`, `POST …/machines/release`, `POST …/machines/provision`:
 *   dọn máy khác khi gỡ agent/project và dựng sẵn máy khác khi thêm; chỉ owner, bằng phiên hoặc board API key.
 */
export function crewMachineRoutes(db: Db): Router {
  const router = Router();
  const actorOf = (req: Request) =>
    resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
  const ready = async () => {
    if (!(await machineTablesReady(db))) throw unavailable();
  };
  const body = <T>(schema: z.ZodType<T>, value: unknown, message: string): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw badRequest(message, { code: MACHINE_ERRORS.invalid, issues: parsed.error.issues });
    return parsed.data;
  };

  router.get(`${BASE}/machines`, async (req, res) => {
    const actor = await actorOf(req);
    await ready();
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
    await assertProject(db, actor.companyId, projectId);
    const now = new Date();
    const items = (await loadMachineCandidates(db, actor.companyId, projectId)).map((c) => ({
      machineId: c.machineId, hostname: c.hostname, online: isOnline(c, now), status: c.projectStatus,
      running: c.running, load1: c.load1, cpuCount: c.cpuCount, memFreePct: c.memFreePct,
    }));
    res.json({ items });
  });

  router.get(`${BASE}/issues/:issueId/machine`, async (req, res) => {
    const actor = await actorOf(req);
    await ready();
    res.json(await issueMachineView(db, actor.companyId, req.params.issueId));
  });

  router.put(`${BASE}/issues/:issueId/machine`, async (req, res) => {
    const actor = await actorOf(req);
    requireOwner(actor);
    await ready();
    const { machineId } = body(machineBodySchema, req.body, "machineId không hợp lệ.");
    const issue = await loadIssue(db, actor.companyId, req.params.issueId);
    if (issue.parentId) throw new HttpError(422, "Chỉ chọn máy ở yêu cầu gốc.", { code: MACHINE_ERRORS.notRoot });
    if (await treeStarted(db, actor.companyId, issue.id)) {
      throw new HttpError(409, "Cây yêu cầu đã có run nên không đổi máy được nữa.", { code: MACHINE_ERRORS.locked });
    }
    const machine = await pairedMachine(db, actor.companyId, machineId);
    if (!machine) throw provisionError("not_paired");
    if (issue.projectId) {
      const row = await readProjectMachine(db, actor.companyId, issue.projectId, machine.machineId);
      if (row?.status !== "ready" && row?.status !== "provisioning") {
        const started = await startProvisioning(db, { companyId: actor.companyId, projectId: issue.projectId, machineId: machine.machineId, createdBy: actor.userId });
        if (!started.ok) throw provisionError(started.reason);
      }
    }
    await setOwnerPin(db, { companyId: actor.companyId, rootIssueId: issue.id, machineId: machine.machineId });
    logger.info({ companyId: actor.companyId, issueId: issue.id, machineId: machine.machineId }, "crew machine pinned by owner");
    res.json(await issueMachineView(db, actor.companyId, issue.id));
  });

  router.get(`${BASE}/projects/:projectId/machines`, async (req, res) => {
    const actor = await actorOf(req);
    await ready();
    const { projectId } = req.params;
    await assertProject(db, actor.companyId, projectId);
    for (const row of await listProjectMachines(db, actor.companyId, projectId)) {
      if (row.status === "provisioning") await reconcileProjectMachine(db, { companyId: actor.companyId, projectId, machineId: row.machineId });
    }
    const rows = new Map((await listProjectMachines(db, actor.companyId, projectId)).map((row) => [row.machineId, row] as const));
    const now = new Date();
    const online = new Map((await loadMachineCandidates(db, actor.companyId, projectId)).map((c) => [c.machineId, isOnline(c, now)] as const));
    const machines = (await pairedMachines(db, actor.companyId)).map((m) => {
      const row = rows.get(m.machineId);
      return {
        machineId: m.machineId, hostname: m.hostname, online: online.get(m.machineId) ?? false, status: row?.status ?? null,
        error: row?.error ?? null, repoPath: row?.repoPath ?? null, updatedAt: row?.updatedAt ?? null,
      };
    });
    res.json({ repo: await readProjectRepo(db, actor.companyId, projectId), machines });
  });

  router.post(`${BASE}/projects/:projectId/machines`, async (req, res) => {
    const actor = await actorOf(req);
    requireOwner(actor);
    await ready();
    const { projectId } = req.params;
    await assertProject(db, actor.companyId, projectId);
    const { machineId } = body(machineBodySchema, req.body, "machineId không hợp lệ.");
    const started = await startProvisioning(db, { companyId: actor.companyId, projectId, machineId, createdBy: actor.userId });
    if (!started.ok) throw provisionError(started.reason);
    logger.info({ companyId: actor.companyId, projectId, machineId, jobId: started.jobId }, "crew project provisioning queued");
    res.status(202).json({ status: "provisioning" });
  });

  router.put(`${BASE}/projects/:projectId/repo`, async (req, res) => {
    const actor = await actorOf(req);
    requireOwner(actor);
    await ready();
    const { projectId } = req.params;
    await assertProject(db, actor.companyId, projectId);
    const parsed = projectRepoSchema.safeParse(req.body);
    if (!parsed.success) throw invalidRepo("Origin, nhánh hoặc repo đi kèm không hợp lệ.", parsed.error.issues);
    const repo = parsed.data;
    const checkouts = new Set((await projectLayout(db, actor.companyId, projectId))?.agents.map((a) => a.checkoutName) ?? []);
    const clash = repo.companions.find((c) => checkouts.has(c.name));
    if (clash) throw invalidRepo(`Tên repo đi kèm "${clash.name}" trùng thư mục checkout của một vai trò trong project.`);
    res.json(await writeProjectRepo(db, { companyId: actor.companyId, projectId, repo, userId: actor.userId }));
  });

  /**
   * Owner của company, bằng phiên trình duyệt hoặc board API key (app 2P Crew gọi các route dọn/dựng bằng board key của
   * owner). Role đọc từ DB như router góp ý.
   */
  async function ownerBoard(req: Request): Promise<{ companyId: string; userId: string }> {
    const actor = req.actor;
    const companyId = req.params.companyId;
    const denied = () => forbidden("Crew: chỉ owner của company được làm việc này.", { code: MACHINE_ERRORS.forbidden });
    if (actor?.type !== "board" || (actor.source !== "session" && actor.source !== "board_key") || typeof actor.userId !== "string") {
      throw denied();
    }
    if (!isUuid(companyId) || !hasCompanyAccess(req, companyId)) throw notFound("Không có company này.");
    const membership = rowsOf(await db.execute(sql`SELECT membership_role FROM company_memberships
      WHERE company_id = ${companyId} AND principal_type = 'user' AND principal_id = ${actor.userId} AND status = 'active' LIMIT 1`));
    if (membership[0]?.membership_role !== "owner") throw denied();
    return { companyId, userId: actor.userId };
  }
  const releaseSchema = z.object({
    agentIds: z.array(z.string().uuid()).min(1).max(20),
    wholeProject: z.boolean(),
    primaryMachineId: z.string().uuid().nullable(),
  }).strict();
  const provisionSchema = z.object({
    exceptMachineId: z.string().uuid().nullable(),
    includeReady: z.boolean(),
    repo: z.object({ originUrl: origin, branch: z.string().regex(BRANCH_RE).refine((v) => !v.startsWith("-")) }).strict().nullable(),
  }).strict();

  router.get(`${BASE}/projects/:projectId/machines/blockers`, async (req, res) => {
    const owner = await ownerBoard(req);
    await ready();
    await assertProject(db, owner.companyId, req.params.projectId);
    const raw = typeof req.query.agentIds === "string" && req.query.agentIds !== "" ? req.query.agentIds.split(",") : null;
    if (raw && raw.some((id) => !isUuid(id))) throw badRequest("agentIds không hợp lệ.", { code: MACHINE_ERRORS.invalid });
    res.json({ blockers: await machineReleaseBlockers(db, { companyId: owner.companyId, projectId: req.params.projectId, agentIds: raw }) });
  });

  router.post(`${BASE}/projects/:projectId/machines/release`, async (req, res) => {
    const owner = await ownerBoard(req);
    await ready();
    await assertProject(db, owner.companyId, req.params.projectId);
    const input = body(releaseSchema, req.body, "Danh sách agent hay máy chính không hợp lệ.");
    const released = await releaseProjectMachines(db, { ...input, companyId: owner.companyId, projectId: req.params.projectId, createdBy: owner.userId });
    if (!released.ok) {
      res.status(409).json({
        error: "Cây yêu cầu đang chạy trên máy đã ghim: chờ run xong (hoặc hủy run) rồi gỡ lại.",
        code: MACHINE_ERRORS.busy,
        blockers: released.blockers,
      });
      return;
    }
    logger.info({ companyId: owner.companyId, projectId: req.params.projectId, archived: released.result.archivedEnvironmentIds.length,
      jobs: released.result.jobs.length }, "crew machines released");
    res.json(released.result);
  });

  router.post(`${BASE}/projects/:projectId/machines/provision`, async (req, res) => {
    const owner = await ownerBoard(req);
    await ready();
    await assertProject(db, owner.companyId, req.params.projectId);
    const input = body(provisionSchema, req.body, "Máy, repo hay cờ includeReady không hợp lệ.");
    res.json(await provisionOtherMachines(db, { ...input, companyId: owner.companyId, projectId: req.params.projectId, createdBy: owner.userId }));
  });

  return router;
}
