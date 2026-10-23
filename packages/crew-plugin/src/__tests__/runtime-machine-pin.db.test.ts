import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinnedMachineOfIssue, resolveAgentMachine } from "../runtimes/machine.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const agentId = "40000000-0000-4000-8000-000000000001";
const env = "80000000-0000-4000-8000-000000000001";
const [root, child, loose] = ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003"];
const [mini, book] = ["50000000-0000-4000-8000-0000000000a1", "50000000-0000-4000-8000-0000000000b2"];
const path = "/Users/o/crew-agents/kidy-school/executor-1";

let host: PluginHost;

beforeAll(async () => {
  host = await startPluginHost("crew-runtime-machine-pin-");
  const { sql, ns } = host;
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE')`;
  await sql`INSERT INTO environments (id,name,driver,config) VALUES (${env},'kidy-school-executor-1','ssh',${sql.json({ remoteWorkspacePath: path })})`;
  await sql`INSERT INTO agents (id,company_id,name,adapter_type,default_environment_id) VALUES (${agentId},${companyId},'Executor','claude_local',${env})`;
  await sql`INSERT INTO issues (id,company_id,identifier,title,status) VALUES (${root},${companyId},'CRE-1','Gốc','todo'), (${loose},${companyId},'CRE-3','Lẻ','todo')`;
  await sql`INSERT INTO issues (id,company_id,identifier,title,status,parent_id) VALUES (${child},${companyId},'CRE-2','Con','todo',${root})`;
  await sql.unsafe(`INSERT INTO ${ns}.issue_machine_pins (company_id,root_issue_id,machine_id,source) VALUES ($1,$2,$3,'owner')`, [companyId, root, mini]);
  // Hai Mac cùng có bản tin; agent không có refs wizard nên luật đường dẫn cũ không xác định được máy (null).
  for (const [machine, at] of [[mini, "2026-10-24T01:00:00Z"], [book, "2026-10-24T01:05:00Z"]] as const) {
    await sql.unsafe(`INSERT INTO ${ns}.machine_latest (company_id,machine_id,hostname,received_at,sent_at,report)
      VALUES ($1,$2,'mac',$3,$3,$4::text::jsonb)`, [companyId, machine, at, JSON.stringify({ checkouts: [{ path }] })]);
  }
}, 180_000);
afterAll(async () => {
  await host?.cleanup();
});

describe("máy của agent theo ghim của cây", () => {
  it("issue con của cây đã ghim: máy ghim", async () => {
    expect(await pinnedMachineOfIssue(host.ctx, companyId, child)).toBe(mini);
    expect(await resolveAgentMachine(host.ctx, { companyId, agentId, issueId: child })).toBe(mini);
  });

  it("cây chưa ghim hay không có issue: giữ luật đường dẫn cũ (hai máy, không có refs wizard → không xác định)", async () => {
    expect(await pinnedMachineOfIssue(host.ctx, companyId, loose)).toBeNull();
    expect(await resolveAgentMachine(host.ctx, { companyId, agentId, issueId: loose })).toBeNull();
    expect(await resolveAgentMachine(host.ctx, { companyId, agentId })).toBeNull();
  });

  it("issue của company khác không bao giờ được đọc", async () => {
    expect(await pinnedMachineOfIssue(host.ctx, "10000000-0000-4000-8000-0000000000ff", child)).toBeNull();
  });
});
