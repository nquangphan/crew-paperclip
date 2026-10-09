import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { createDb, plugins } from "../../../db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginDatabaseService } from "../../../../server/src/services/plugin-database.js";
import manifest from "../manifest.js";
import { receiveDocsSnapshot } from "../docs/webhook.js";
import { loadDocsCheck, loadDocsPage, loadDocsTree, searchDocs } from "../docs/data.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const otherProject = "20000000-0000-4000-8000-000000000002";
const issueId = "30000000-0000-4000-8000-000000000001";
const childId = "30000000-0000-4000-8000-000000000002";
const hostPluginId = "60000000-0000-4000-8000-000000000001";
const now = Math.floor(Date.now()/1000);
let cleanup: (()=>Promise<void>)|undefined;
afterAll(async()=>{await cleanup?.();});
const page = (path:string,title:string,text:string) => ({path,title,parentPath:path.slice(0,path.lastIndexOf("/")),text,sha256:createHash("sha256").update(text,"utf8").digest("hex")});
const payload = (commit="a".repeat(40)) => ({version:1,companyId,machineId:"50000000-0000-4000-8000-000000000001",projectId,repo:"repo-a",commit,auditState:"verified",checkExit:0,pages:[page("docs/index.md","Index 100%","Hello 100% world"),page("docs/other.md","Other","Second")],links:[{fromPath:"docs/index.md",occurrence:1,originalHref:"other.md",toPath:"docs/other.md",fragment:null,status:"ok"}],dropped:[{path:"docs/secret.md",reason:"secret-scan"}]});
function signed(body:unknown, overrides:{timestamp?:number;signature?:string;headers?:Record<string,string>}={}):PluginWebhookInput {
  const rawBody=JSON.stringify(body); const ts=overrides.timestamp ?? now;
  return {endpointKey:"docs-snapshot",rawBody,requestId:"request-1",headers:overrides.headers ?? {"X-Crew-Timestamp":String(ts),"X-Crew-Signature":overrides.signature ?? `sha256=${createHmac("sha256","test-secret").update(`${ts}.${rawBody}`).digest("hex")}`}};
}
it("stores docs snapshots with history, rejects invalid webhooks, scopes reads and searches literal wildcards",async()=>{
  const database=await startEmbeddedPostgresTestDatabase("crew-docs-");
  const sql=postgres(database.connectionString,{max:2,onnotice:()=>{}});
  cleanup=async()=>{await sql.end();await database.cleanup();};
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE'),(${otherCompany},'Other','OTH')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES (${projectId},${companyId},'Repo A'),(${otherProject},${otherCompany},'Other repo')`;
  await sql`INSERT INTO issues (id,company_id,identifier,title,status) VALUES (${issueId},${companyId},'CRE-1','root','todo')`;
  await sql`INSERT INTO issues (id,company_id,parent_id,identifier,title,status) VALUES (${childId},${companyId},${issueId},'CRE-2','child','todo')`;
  const integrator = "40000000-0000-4000-8000-000000000001";
  const executor = "40000000-0000-4000-8000-000000000002";
  await sql`INSERT INTO agents (id,company_id,name) VALUES (${integrator},${companyId},'Integrator'),(${executor},${companyId},'Executor')`;
  const policy = { stages: [
    { type: "review", participants: [{ type: "agent", agentId: executor }] },
    { type: "review", participants: [{ type: "agent", agentId: integrator }] },
    { type: "approval", participants: [{ type: "user", userId: "50000000-0000-4000-8000-000000000001" }] },
    { type: "review", participants: [{ type: "agent", agentId: integrator }] },
  ] };
  await sql`UPDATE issues SET execution_policy = ${JSON.stringify(policy)}::jsonb WHERE id = ${issueId}`;
  // Real host plugin-database service: same validators and parameter binding as production.
  const hostDb=createDb(database.connectionString);
  await hostDb.insert(plugins).values({id:hostPluginId,pluginKey:manifest.id,packageName:"@crew/paperclip-plugin",version:manifest.version,apiVersion:manifest.apiVersion,categories:manifest.categories,manifestJson:manifest,status:"installed"});
  const pluginDb=pluginDatabaseService(hostDb);
  await pluginDb.applyMigrations(hostPluginId,manifest,fileURLToPath(new URL("../..",import.meta.url)));
  const ns=await pluginDb.getRuntimeNamespace(hostPluginId);
  const ctx={db:{namespace:ns,query:<T>(q:string,params?:unknown[])=>pluginDb.query<T>(hostPluginId,q,params),execute:(q:string,params?:unknown[])=>pluginDb.execute(hostPluginId,q,params)},config:{get:async()=>({companies:[{companyId,webhookSecretRef:{type:"secret_ref",secretId:"40000000-0000-4000-8000-000000000001"}}]})},secrets:{resolve:async()=>"test-secret"}} as unknown as PluginContext;
  await receiveDocsSnapshot(ctx,signed(payload()));
  const firstId=(await loadDocsTree(ctx,projectId,companyId))!.snapshotId;
  expect((await loadDocsTree(ctx,projectId,companyId))?.pages).toHaveLength(2);
  expect((await loadDocsPage(ctx,projectId,"docs/index.md",companyId))?.links[0]?.status).toBe("ok");
  expect((await searchDocs(ctx,projectId,"100%",companyId)).map(x=>x.path)).toEqual(["docs/index.md"]);
  expect(await searchDocs(ctx,projectId,"100_",companyId)).toEqual([]);
  const count=async()=>Number((await sql.unsafe(`SELECT count(*)::int AS n FROM ${ns}.docs_snapshots`))[0]?.n);
  for (const bad of [signed(payload(),{headers:{}}),signed(payload(),{signature:"sha256="+"0".repeat(64)}),signed(payload(),{timestamp:now-301}),signed({...payload(),companyId:otherCompany}),signed({...payload(),projectId:otherProject}),signed({...payload(),pages:[page("docs/secret.md","Bad","secret")],dropped:[{path:"docs/secret.md",reason:"secret-scan"}]}),signed({...payload(),pages:[page("docs/index.md","x","x".repeat(5*1024*1024))]})]) {
    await expect(receiveDocsSnapshot(ctx,bad)).rejects.toThrow(); expect(await count()).toBe(1);
  }
  await receiveDocsSnapshot(ctx,signed({...payload("c".repeat(40)),pages:[page("docs/new.md","New","Fresh")],links:[],dropped:[]}));
  // History is kept: the first snapshot stays readable by id while the current one moves on.
  expect(await count()).toBe(2);
  expect((await loadDocsTree(ctx,projectId,companyId))?.commit).toBe("c".repeat(40));
  expect(await loadDocsPage(ctx,projectId,"docs/index.md",companyId)).toBeNull();
  expect((await loadDocsPage(ctx,projectId,"docs/index.md",companyId,firstId))?.text).toBe("Hello 100% world");
  await expect(loadDocsTree(ctx,projectId,otherCompany)).rejects.toThrow();
  const sha="d".repeat(40); const base="e".repeat(40);
  await sql`INSERT INTO issue_comments (company_id,issue_id,author_agent_id,body,created_at) VALUES (${companyId},${issueId},${integrator},${`crew-docs-check commit=${sha} range=${base}..${sha} exit=1`},now()-interval '1 hour')`;
  await sql`INSERT INTO issue_comments (company_id,issue_id,author_agent_id,body,created_at) VALUES (${companyId},${issueId},${executor},${`crew-docs-check commit=${sha} range=${base}..${sha} exit=0`},now())`;
  expect((await loadDocsCheck(ctx,childId,companyId))?.exit).toBe(1);
  const nextSha = "c".repeat(40);
  await sql`INSERT INTO issue_comments (company_id,issue_id,author_agent_id,body,created_at) VALUES (${companyId},${issueId},${integrator},${`crew-docs-check commit=${nextSha} range=${base}..${nextSha} exit=0`},now()+interval '20 seconds')`;
  await sql`INSERT INTO issue_comments (company_id,issue_id,body,created_at) VALUES (${companyId},${issueId},${`crew-docs-check commit=${sha} range=${base}..${sha} exit=3`},now()+interval '30 seconds')`;
  expect(await loadDocsCheck(ctx,childId,companyId)).toMatchObject({ commit: nextSha, exit: 0, author: integrator });
  await sql`INSERT INTO issue_comments (company_id,issue_id,author_agent_id,body,created_at) VALUES (${companyId},${issueId},${integrator},'crew-docs-check malformed',now()+interval '1 minute')`;
  expect(await loadDocsCheck(ctx,childId,companyId)).toMatchObject({ invalid: true, author: integrator });
  const failing = { ...ctx, db: { ...ctx.db, execute: async (query:string, params:unknown[]=[]) => {
    if (query.includes(".docs_snapshot_pages")) throw new Error("injected page insert failure");
    return ctx.db.execute(query, params);
  } } } as PluginContext;
  await expect(receiveDocsSnapshot(failing,signed(payload("f".repeat(40))))).rejects.toThrow("injected page insert failure");
  const staging=async()=>Number((await sql.unsafe(`SELECT count(*)::int AS n FROM ${ns}.docs_snapshots WHERE completed_at IS NULL`))[0]?.n);
  expect(await count()).toBe(3);
  expect(await staging()).toBe(1);
  expect((await loadDocsTree(ctx,projectId,companyId))?.commit).toBe("c".repeat(40));
  await sql.unsafe(`UPDATE ${ns}.docs_snapshots SET received_at = now() - interval '11 minutes' WHERE id NOT IN (SELECT snapshot_id FROM ${ns}.docs_current)`);
  const nested = ["docs/flows/a.md", "docs/guide/sub/b.md", "docs/index.md"]
    .map(path => page(path, path, "body"));
  await receiveDocsSnapshot(ctx,signed({ ...payload("e".repeat(40)), pages: nested, links: [] }));
  expect(await count()).toBe(3);
  expect(await staging()).toBe(0);
  expect((await loadDocsTree(ctx,projectId,companyId))?.commit).toBe("e".repeat(40));
  expect((await loadDocsTree(ctx,projectId,companyId))?.pages.map(page => [page.path,page.parentPath])).toEqual([
    ["docs/flows/a.md","docs/flows"], ["docs/guide/sub/b.md","docs/guide/sub"], ["docs/index.md","docs"],
  ]);
},90_000);
