import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const issueA = "20000000-0000-4000-8000-000000000001";
const issueB = "20000000-0000-4000-8000-000000000002";
const projectId = "30000000-0000-4000-8000-000000000001";

describe("migration duyệt QC trên database đã có các migration trước", () => {
  it("chụp phòng người gửi, nhận kind reopen, một yêu cầu mở lại và một vòng QC mở cho mỗi issue", async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "crew-qc-verification-0019-"));
    let host: PluginHost | undefined;
    try {
      await mkdir(join(root, "migrations"));
      const files = (await readdir(join(packageRoot, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
      const qc = files.find((file) => file.startsWith("0019_"));
      expect(qc).toBe("0019_qc_verification.sql");
      for (const file of files.filter((name) => name < "0019_")) await copyFile(join(packageRoot, "migrations", file), join(root, "migrations", file));
      host = await startPluginHost("crew-qc-verification-0019-", root);
      const { sql, ns } = host;
      await sql.unsafe(`INSERT INTO ${ns}.crew_contributors (company_id,user_id,granted_by_user_id,department)
        VALUES ($1,'qc-guest','owner','qc'), ($1,'mk-guest','owner','marketing')`, [companyId]);
      await sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,kind,author_user_id,project_id,title)
        VALUES ($1,'issue','qc-guest',$2,'QC cũ'), ($1,'issue','mk-guest',$2,'MK cũ'), ($1,'issue','gone',$2,'Đã gỡ')`, [companyId, projectId]);

      await copyFile(join(packageRoot, "migrations", qc!), join(root, "migrations", qc!));
      await host.applyMigrations(root);

      // Mục có từ trước lấy phòng hiện tại của người gửi; người không còn dấu thì để trống.
      expect(await sql.unsafe(`SELECT author_user_id, submitted_department FROM ${ns}.crew_contributions ORDER BY author_user_id`)).toEqual([
        { author_user_id: "gone", submitted_department: null },
        { author_user_id: "mk-guest", submitted_department: "marketing" },
        { author_user_id: "qc-guest", submitted_department: "qc" },
      ]);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_contributions SET submitted_department = 'sales'`))
        .rejects.toThrow(/crew_contributions_submitted_department_ck/);

      // Yêu cầu mở lại: cần issue đích và lý do, không có project hay tiêu đề; duyệt xong phải có bình luận.
      await sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,kind,author_user_id,target_issue_id,body,submitted_department)
        VALUES ($1,'reopen','qc-guest',$2,'Còn lỗi','qc')`, [companyId, issueA]);
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,kind,author_user_id,target_issue_id)
        VALUES ($1,'reopen','qc-guest',$2)`, [companyId, issueB])).rejects.toThrow(/crew_contributions_shape_ck/);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_contributions SET status = 'approved' WHERE kind = 'reopen'`))
        .rejects.toThrow(/crew_contributions_result_ck/);
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,kind,author_user_id,target_issue_id,body)
        VALUES ($1,'reopen','qc-guest',$2,'Lần hai')`, [companyId, issueA])).rejects.toThrow(/crew_contributions_reopen_open_uq/);
      await sql.unsafe(`UPDATE ${ns}.crew_contributions SET status = 'rejected' WHERE kind = 'reopen'`);
      await sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,kind,author_user_id,target_issue_id,body)
        VALUES ($1,'reopen','qc-guest',$2,'Lần hai')`, [companyId, issueA]);
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,kind,author_user_id,target_issue_id,body)
        VALUES ($1,'sales','qc-guest',$2,'x')`, [companyId, issueB])).rejects.toThrow(/crew_contributions_kind_check/);

      // Vòng QC: một vòng mở mỗi issue; vòng đã đóng không chặn vòng mới; verified phải có người và giờ duyệt.
      const contribution = (await sql.unsafe(`SELECT id FROM ${ns}.crew_contributions WHERE title = 'QC cũ'`))[0]!.id as string;
      await sql.unsafe(`INSERT INTO ${ns}.crew_qc_rounds (company_id,issue_id,qc_user_id,source_contribution_id)
        VALUES ($1,$2,'qc-guest',$3)`, [companyId, issueA, contribution]);
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_qc_rounds (company_id,issue_id,qc_user_id,source_contribution_id)
        VALUES ($1,$2,'qc-guest',$3)`, [companyId, issueA, contribution])).rejects.toThrow(/crew_qc_rounds_open_uq/);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_qc_rounds SET status = 'verified'`)).rejects.toThrow(/crew_qc_rounds_verified_ck/);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_qc_rounds SET status = 'done'`)).rejects.toThrow(/crew_qc_rounds_status_ck/);
      await sql.unsafe(`UPDATE ${ns}.crew_qc_rounds SET status = 'reopened', ended_at = now()`);
      await sql.unsafe(`INSERT INTO ${ns}.crew_qc_rounds (company_id,issue_id,qc_user_id,source_contribution_id)
        VALUES ($1,$2,'qc-guest',$3)`, [companyId, issueA, contribution]);
      expect(await sql.unsafe(`SELECT status, ended_at IS NULL AS open FROM ${ns}.crew_qc_rounds ORDER BY started_at, ended_at NULLS LAST`))
        .toEqual([{ status: "reopened", open: false }, { status: "awaiting", open: true }]);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
