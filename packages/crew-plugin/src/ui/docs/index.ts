import { createElement as h, useState } from "react";
import { MarkdownBlock, Spinner, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { registerIssuePanel, registerPageSection } from "../registry.js";
import { buildDocsTree, type DocsNode } from "./tree.js";

type Project = { projectId: string; repo: string };
type Tree = { repo:string;commit:string;auditState:string;receivedAt:string;machineId:string;dropped:Array<{path:string}>;pages:Array<{path:string;title:string;parentPath:string|null}> };
type Page = {path:string;title:string;text:string;links:Array<{occurrence:number;originalHref:string;toPath:string|null;status:string}>};
const time = (value:string) => new Intl.DateTimeFormat("vi-VN", { timeZone:"Asia/Ho_Chi_Minh",dateStyle:"short",timeStyle:"short" }).format(new Date(value));
const audit: Record<string,string> = { verified:"Đã xác minh", invalid:"Không hợp lệ", unverified:"Chưa xác minh" };
type DocsCheckResult = {commit:string;range:string;exit:number;at:string;author:string|null;invalid?:false}|{invalid:true;at:string;author:string|null};

export function DocsCheckContent({ result: d }: { result: DocsCheckResult }) {
  return h("section", {"aria-label":"Kiểm docs"}, h("h3",null,"Kiểm docs"),
    h("p",null, d.invalid ? "Bằng chứng không hợp lệ" : d.exit === 0 ? "Đạt" : `Lỗi (exit ${d.exit})`),
    d.invalid ? null : h("p",null,`Commit: ${d.commit}`),
    d.invalid ? null : h("p",null,`Range: ${d.range}`),
    h("p",null,`Tác giả: ${d.author ?? "Không rõ"}`), h("p",null,`Lúc: ${time(d.at)}`));
}

export function DocsCheckPanel({issueId,companyId}:{issueId:string;companyId:string}) {
  const result = usePluginData<DocsCheckResult|null>("crew.docsCheck", {issueId,companyId});
  if (result.loading) return h("p", {role:"status"}, h(Spinner,null), " Đang tải kết quả kiểm docs…");
  if (result.error) return h("p", {role:"alert"}, `Không tải được kết quả kiểm docs: ${result.error.message}`);
  const d = result.data; if (!d) return h("p", {role:"status"}, "Chưa có kết quả kiểm docs.");
  return h(DocsCheckContent, { result: d });
}
function DocsPage({projectId,path,onSelect}:{projectId:string;path:string;onSelect:(p:string)=>void}) {
  const result = usePluginData<Page|null>("crew.docs.page", {projectId,path});
  if (result.loading) return h("p",{role:"status"},"Đang tải trang…");
  if (result.error) return h("p",{role:"alert"},result.error.message);
  const p = result.data; if (!p) return h("p",{role:"alert"},"Không tìm thấy trang.");
  return h("article",{"aria-label":"Nội dung tài liệu",onClick:(event:{target:{closest:(selector:string)=>{getAttribute:(name:string)=>string|null}|null};preventDefault:()=>void})=>{
    const anchor=event.target.closest("a"); if (!anchor) return;
    const href=anchor.getAttribute("href");
    const link=p.links.find(item=>item.originalHref===href);
    if (link?.status==="external") return;
    event.preventDefault();
    if (link?.status==="ok" && link.toPath) onSelect(link.toPath);
  }}, h("h3",null,p.title), h(MarkdownBlock,{content:p.text.replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1")}), h("h4",null,"Liên kết"), h("ul",null,...p.links.map(l => h("li",{key:l.occurrence}, l.status === "ok" && l.toPath ? h("button",{type:"button",onClick:()=>onSelect(l.toPath!)},l.originalHref) : l.status === "external" ? h("a",{href:l.originalHref,target:"_blank",rel:"noopener noreferrer nofollow"},l.originalHref) : `${l.originalHref} — ${l.status === "missing" ? "thiếu trang" : "chưa xác minh"}`))));
}
function DocsSearch({projectId,onSelect}:{projectId:string;onSelect:(p:string)=>void}) {
  const [q,setQ] = useState("");
  const result = usePluginData<Array<{path:string;title:string}>>("crew.docs.search",{projectId,q});
  return h("section",{"aria-label":"Tìm tài liệu"},h("label",null,"Tìm kiếm ",h("input",{value:q,onChange:(e:{target:{value:string}})=>setQ(e.target.value)})),result.error ? h("p",{role:"alert"},result.error.message) : null, q && result.data ? h("ul",null,...result.data.map(row=>h("li",{key:row.path},h("button",{type:"button",onClick:()=>onSelect(row.path)},row.title)))) : null);
}
function DocsSpace({projectId}:{projectId:string}) {
  const [path,setPath] = useState<string|null>(null);
  const result = usePluginData<Tree|null>("crew.docs.tree",{projectId});
  if (result.loading) return h("p",{role:"status"},"Đang tải cây tài liệu…");
  if (result.error) return h("p",{role:"alert"},result.error.message);
  const tree = result.data; if (!tree) return h("p",{role:"status"},"Dự án chưa có tài liệu.");
  const selected = path && tree.pages.some(p=>p.path===path) ? path : tree.pages.find(p=>p.path==="docs/index.md")?.path ?? tree.pages[0]?.path;
  const children = (nodes: DocsNode[]): React.ReactNode => h("ul", null, ...nodes.map(node => h("li", { key: node.path },
    node.type === "directory"
      ? h("details", { open: true }, h("summary", null, node.name), children(node.children))
      : h("button", { type: "button", "aria-current": selected === node.path ? "page" : undefined, onClick: () => setPath(node.path) }, node.title))));
  return h("section",{"aria-label":"Tài liệu repo"}, h("p",null,`Repo: ${tree.repo} · Commit: ${tree.commit} · Nhận lúc: ${time(tree.receivedAt)} · ${audit[tree.auditState] ?? tree.auditState}`),tree.dropped.length ? h("details",null,h("summary",null,`${tree.dropped.length} file bị bỏ do secret-scan`),h("ul",null,...tree.dropped.map((d,index)=>h("li",{key:index},d.path)))):null,h(DocsSearch,{projectId,onSelect:setPath}),h("nav",{"aria-label":"Cây tài liệu"},children(buildDocsTree(tree.pages))),selected?h(DocsPage,{projectId,path:selected,onSelect:setPath}):h("p",null,"Chưa có trang tài liệu."));
}
export function DocsSection({companyId}:{companyId:string}) {
  const [projectId,setProjectId] = useState<string|null>(null);
  const result = usePluginData<Project[]>("crew.docs.projects",{companyId});
  if (result.loading) return h("p",{role:"status"},"Đang tải dự án docs…");
  if (result.error) return h("p",{role:"alert"},result.error.message);
  const projects = result.data ?? [];
  const chosen = projectId && projects.some(p=>p.projectId===projectId) ? projectId : projects[0]?.projectId;
  return h("section",{"aria-label":"Docs"},h("h2",null,"Docs"),projects.length?h("label",null,"Dự án ",h("select",{value:chosen,onChange:(e:{target:{value:string}})=>setProjectId(e.target.value)},...projects.map(p=>h("option",{key:p.projectId,value:p.projectId},p.repo)))):h("p",{role:"status"},"Chưa có repo nào đồng bộ docs."),chosen?h(DocsSpace,{key:chosen,projectId:chosen}):null);
}
registerIssuePanel({id:"docs-check",order:20,component:DocsCheckPanel});
registerPageSection({id:"docs",title:"Docs",order:30,component:DocsSection});
