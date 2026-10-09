import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { loadSkillSync } from "../skills/sync-data.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const machine1 = "50000000-0000-4000-8000-000000000001";
const machine2 = "50000000-0000-4000-8000-000000000002";
const skillA = "70000000-0000-4000-8000-00000000000a";
const skillB = "70000000-0000-4000-8000-00000000000b";
const sha = (char: string) => char.repeat(64);

let host: PluginHost;
beforeAll(async () => { host = await startPluginHost("crew-skill-sync-"); }, 120_000);
afterAll(async () => { await host?.cleanup(); });
beforeEach(async () => { await host.sql.unsafe(`DELETE FROM ${host.ns}.crew_machine_jobs`); });

async function job(options: {
  company?: string; machine?: string; skill?: string; kind?: string; status: string; minutesAgo: number; sha256?: string;
}) {
  const kind = options.kind ?? "skill-sync";
  const payload = kind === "skill-sync"
    ? { kind, skillId: options.skill ?? skillA, slug: "demo", version: "1" }
    : { kind, folder: "/Users/a/repo" };
  const result = options.sha256 ? { kind, sha256: options.sha256, files: 3 } : null;
  const finished = ["done", "failed", "cancelled"].includes(options.status);
  await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_machine_jobs
      (company_id,machine_id,kind,payload,status,result,created_by_user_id,created_at,finished_at)
    VALUES ($1,$2,$3,$4::text::jsonb,$5,$6::text::jsonb,'u',now() - make_interval(mins => $7),
      CASE WHEN $8::boolean THEN now() - make_interval(mins => $7) + interval '1 minute' END)`,
  [options.company ?? companyId, options.machine ?? machine1, kind, JSON.stringify(payload), options.status,
    result ? JSON.stringify(result) : null, options.minutesAgo, finished]);
}

it("trả việc skill-sync mới nhất theo cặp skill/máy cùng sha256 bản xong gần nhất", async () => {
  await job({ status: "failed", minutesAgo: 30 });
  await job({ status: "done", minutesAgo: 20, sha256: sha("1") });
  await job({ status: "done", minutesAgo: 10, sha256: sha("2") });
  const rows = await loadSkillSync(host.ctx, { companyId });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ skillId: skillA, machineId: machine1, status: "done", sha256: sha("2") });
  expect(new Date(rows[0]!.finishedAt!).toISOString()).toBe(rows[0]!.finishedAt);
});

it("việc mới nhất đang chờ vẫn giữ sha256 của lần xong trước; tách theo máy, skill, company", async () => {
  await job({ status: "done", minutesAgo: 20, sha256: sha("1") });
  await job({ status: "queued", minutesAgo: 5 });
  await job({ machine: machine2, status: "failed", minutesAgo: 5 });
  await job({ skill: skillB, status: "done", minutesAgo: 5, sha256: sha("3") });
  await job({ company: otherCompany, status: "done", minutesAgo: 1, sha256: sha("9") });
  await job({ kind: "inspect-folder", status: "done", minutesAgo: 1 });
  const rows = await loadSkillSync(host.ctx, { companyId });
  expect(rows.map(({ skillId, machineId, status, sha256, finishedAt }) => ({ skillId, machineId, status, sha256, finished: finishedAt !== null })))
    .toEqual([
      { skillId: skillA, machineId: machine1, status: "queued", sha256: sha("1"), finished: false },
      { skillId: skillA, machineId: machine2, status: "failed", sha256: null, finished: true },
      { skillId: skillB, machineId: machine1, status: "done", sha256: sha("3"), finished: true },
    ]);
  await expect(loadSkillSync(host.ctx, { companyId: "x" })).rejects.toThrow();
});

it("trả jobId và lỗi đã làm sạch của lần sync mới nhất; null khi lần mới nhất không lỗi", async () => {
  await job({ status: "failed", minutesAgo: 30 });
  await host.sql.unsafe(`UPDATE ${host.ns}.crew_machine_jobs SET error_code='skill_fetch_failed',
    error_text=$1 WHERE status='failed'`, [`boom \x1b[31m AKIAABCDEFGHIJKLMNOP`]);
  const failed = await loadSkillSync(host.ctx, { companyId });
  expect(failed[0]).toMatchObject({ status: "failed", errorCode: "skill_fetch_failed" });
  expect(failed[0]!.errorText).toBe("boom  [ĐÃ CHE]");
  const [{ id: failedId }] = await host.sql.unsafe(`SELECT id FROM ${host.ns}.crew_machine_jobs WHERE status='failed'`);
  expect(failed[0]!.jobId).toBe(String(failedId));
  await job({ status: "done", minutesAgo: 5, sha256: sha("1") });
  const [{ id: doneId }] = await host.sql.unsafe(`SELECT id FROM ${host.ns}.crew_machine_jobs WHERE status='done'`);
  const rows = await loadSkillSync(host.ctx, { companyId });
  expect(rows[0]).toMatchObject({ jobId: String(doneId), status: "done", errorCode: null, errorText: null });
});
