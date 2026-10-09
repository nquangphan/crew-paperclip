import { createElement as h, useState } from "react";
import { MarkdownBlock, Spinner, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { registerIssuePanel, registerPageSection } from "../registry.js";
import { buildDocsTree, type DocsNode } from "./tree.js";
import type { DocsCheckResult, DocsPage as Page, DocsProject as Project, DocsTree as Tree } from "./types.js";
import type { DocsHistoryItem } from "../../docs/history.js";
import type { DocsStatus } from "../../docs/status.js";
import { DocsGraphView } from "../graph/docs-graph.js";
import { DOCS_STATE_LABEL } from "../graph/model.js";

const time = (value:string) => new Intl.DateTimeFormat("vi-VN", { timeZone:"Asia/Ho_Chi_Minh",dateStyle:"short",timeStyle:"short" }).format(new Date(value));
const audit: Record<string,string> = { verified:"Đã xác minh", invalid:"Không hợp lệ", unverified:"Chưa xác minh" };

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
function DocsPage({projectId,path,snapshotId,onSelect}:{projectId:string;path:string;snapshotId?:string;onSelect:(p:string)=>void}) {
  const result = usePluginData<Page|null>("crew.docs.page", {projectId,path,snapshotId});
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
export function historyLabel(item:DocsHistoryItem):string {
  const change = item.changed ? ` · +${item.changed.added} ~${item.changed.modified} −${item.changed.removed}` : "";
  return `${item.commit.slice(0,12)} · ${time(item.receivedAt)}${change}${item.current ? " (hiện hành)" : ""}`;
}
function DocsStatusBadge({projectId}:{projectId:string}) {
  const result = usePluginData<DocsStatus>("crew.docs.status",{projectId});
  if (result.loading) return h("p",{role:"status"},"Đang tải trạng thái docs…");
  if (result.error) return h("p",{role:"alert"},`Không tải được trạng thái docs: ${result.error.message}`);
  if (!result.data) return null;
  return h("p",{role:"status"},h("strong",null,DOCS_STATE_LABEL[result.data.state]),` — ${result.data.reason}`);
}
function DocsSpace({projectId}:{projectId:string}) {
  const [path,setPath] = useState<string|null>(null);
  const [snapshotId,setSnapshotId] = useState<string|undefined>(undefined);
  const [view,setView] = useState<"pages"|"graph">("pages");
  const history = usePluginData<DocsHistoryItem[]>("crew.docs.history",{projectId});
  const result = usePluginData<Tree|null>("crew.docs.tree",{projectId,snapshotId});
  if (result.loading) return h("p",{role:"status"},"Đang tải cây tài liệu…");
  if (result.error) return h("p",{role:"alert"},result.error.message);
  const tree = result.data; if (!tree) return h("section",{"aria-label":"Tài liệu repo"},h(DocsStatusBadge,{projectId}),h("p",{role:"status"},"Dự án chưa có tài liệu."));
  const selected = path && tree.pages.some(p=>p.path===path) ? path : tree.pages.find(p=>p.path==="docs/index.md")?.path ?? tree.pages[0]?.path;
  const children = (nodes: DocsNode[]): React.ReactNode => h("ul", null, ...nodes.map(node => h("li", { key: node.path },
    node.type === "directory"
      ? h("details", { open: true }, h("summary", null, node.name), children(node.children))
      : h("button", { type: "button", "aria-current": selected === node.path ? "page" : undefined, onClick: () => setPath(node.path) }, node.title))));
  const tabButton = (id:"pages"|"graph",label:string) => h("button",{type:"button",role:"tab","aria-selected":view===id,onClick:()=>setView(id)},label);
  const picker = history.data && history.data.length ? h("label",null,"Ảnh chụp ",h("select",{value:snapshotId ?? history.data.find(i=>i.current)?.snapshotId ?? "",onChange:(e:{target:{value:string}})=>{ const item=history.data!.find(i=>i.snapshotId===e.target.value); setSnapshotId(item?.current ? undefined : e.target.value); }},...history.data.map(item=>h("option",{key:item.snapshotId,value:item.snapshotId},historyLabel(item))))) : null;
  const graphView = h(DocsGraphView,{projectId,snapshotId,onOpenPage:(p:string)=>{ setPath(p); setView("pages"); }});
  return h("section",{"aria-label":"Tài liệu repo"}, h(DocsStatusBadge,{projectId}), picker, h("div",{role:"tablist","aria-label":"Chế độ xem docs"},tabButton("pages","Trang"),tabButton("graph","Đồ thị")), view==="graph" ? graphView : h("div",null, h("p",null,`Repo: ${tree.repo} · Commit: ${tree.commit} · Nhận lúc: ${time(tree.receivedAt)} · ${audit[tree.auditState] ?? tree.auditState}`),tree.dropped.length ? h("details",null,h("summary",null,`${tree.dropped.length} file bị bỏ do secret-scan`),h("ul",null,...tree.dropped.map((d,index)=>h("li",{key:index},d.path)))):null,h(DocsSearch,{projectId,onSelect:setPath}),h("nav",{"aria-label":"Cây tài liệu"},children(buildDocsTree(tree.pages))),selected?h(DocsPage,{projectId,path:selected,snapshotId,onSelect:setPath}):h("p",null,"Chưa có trang tài liệu.")));
}
export function DocsSection({companyId}:{companyId:string}) {
  const [projectId,setProjectId] = useState<string|null>(null);
  const result = usePluginData<Project[]>("crew.docs.projects",{companyId});
  if (result.loading) return h("p",{role:"status"},"Đang tải dự án docs…");
  if (result.error) return h("p",{role:"alert"},result.error.message);
  const projects = result.data ?? [];
  const chosen = projectId && projects.some(p=>p.projectId===projectId) ? projectId : projects[0]?.projectId;
  return h("div",null,projects.length?h("label",null,"Dự án ",h("select",{value:chosen,onChange:(e:{target:{value:string}})=>setProjectId(e.target.value)},...projects.map(p=>h("option",{key:p.projectId,value:p.projectId},p.repo)))):h("p",{role:"status"},"Chưa có repo nào đồng bộ docs."),chosen?h(DocsSpace,{key:chosen,projectId:chosen}):null);
}
registerIssuePanel({id:"docs-check",order:20,component:DocsCheckPanel});
registerPageSection({id:"docs",title:"Docs",order:30,component:DocsSection});
