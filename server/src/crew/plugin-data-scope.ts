import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import { companyMemberships, type Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { hasCompanyAccess } from "../routes/authz.js";
import { loadCrewCompanyConfig } from "./issue-policy.js";
import { CREW_PLUGIN_KEY } from "./project-roles.js";

/**
 * Phạm vi company cho `POST /plugins/:pluginId/data/:key` khi viewer của company Crew đọc data plugin `crew.core`.
 *
 * Route data là POST nên `assertPluginBridgeScope` stock chặn viewer (`Viewer access is read-only`), làm UI Crew không
 * dùng được với viewer. Viewer được qua khi đủ mọi điều kiện:
 * - plugin là `crew.core` và data key nằm trong {@link CREW_VIEWER_DATA_KEYS};
 * - actor là board có `userId` (không phải `local_implicit`) và company nằm trong danh sách company của phiên;
 * - phiên ghi nhận membership `viewer` ở company đó (role khác thì stock đã cho qua, không cần tra thêm);
 * - company có trong cấu hình Crew và cấu hình đọc được (hỏng thì đóng);
 * - DB xác nhận membership `active`, `principal_type='user'`, `membership_role='viewer'`.
 *
 * Trả `companyId` khi được qua; trường hợp khác trả `undefined` để route chạy kiểm tra stock. Lỗi đọc DB cũng trả
 * `undefined` (đóng khi lỗi: viewer nhận 403 stock). Không dùng cho route ghi hay `bridge/*`, `actions/*`.
 */
/**
 * Data key `crew.core` mà UI Crew đọc ở những trang viewer vào được (tổng quan, project, issue, docs). Key mới của
 * plugin không tự mở cho viewer: phải thêm vào đây. Các key chỉ dùng ở trang Máy, Skill, wizard hay báo cáo chi phí
 * (`crew.machineJobs`, `crew.skillSync`, `crew.storage`, `crew.usage.*`, `crew.docs.graph`/`history`/`status`) giữ
 * kiểm tra stock.
 */
export const CREW_VIEWER_DATA_KEYS: ReadonlySet<string> = new Set([
  "crew.companies",
  "crew.roots",
  "crew.map",
  "crew.docsCheck",
  "crew.runtimeDecisions",
  "crew.machines",
  "crew.setupRuns",
  "crew.docs.projects",
  "crew.docs.tree",
  "crew.docs.page",
  "crew.docs.search",
]);

export async function crewViewerPluginDataScope(
  db: Db,
  req: Request,
  pluginKey: string,
  dataKey: string,
  companyId: unknown,
): Promise<string | undefined> {
  if (pluginKey !== CREW_PLUGIN_KEY || !CREW_VIEWER_DATA_KEYS.has(dataKey)) return undefined;
  const actor = req.actor;
  if (actor.type !== "board" || actor.source === "local_implicit") return undefined;
  const userId = actor.userId?.trim();
  if (!userId) return undefined;
  if (typeof companyId !== "string" || companyId.trim().length === 0 || companyId !== companyId.trim()) return undefined;
  if (!hasCompanyAccess(req, companyId)) return undefined;
  const cached = actor.memberships?.find((item) => item.companyId === companyId);
  if (cached?.membershipRole !== "viewer") return undefined;

  try {
    const config = await loadCrewCompanyConfig(companyId);
    if (config.kind !== "ok") return undefined;
    const rows = await db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
          eq(companyMemberships.membershipRole, "viewer"),
        ),
      )
      .limit(1);
    return rows.length > 0 ? companyId : undefined;
  } catch (error) {
    logger.warn({ err: error, companyId }, "Crew: không đọc được membership viewer, giữ kiểm tra stock cho data plugin");
    return undefined;
  }
}
