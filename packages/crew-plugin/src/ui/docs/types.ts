export type DocsProject = { projectId: string; repo: string };
export type DocsTree = { repo: string; commit: string; auditState: string; receivedAt: string; machineId: string; dropped: Array<{ path: string }>; pages: Array<{ path: string; title: string; parentPath: string | null }> };
export type DocsPage = { path: string; title: string; text: string; links: Array<{ occurrence: number; originalHref: string; toPath: string | null; status: string }> };
export type DocsCheckResult = { commit: string; range: string; exit: number; at: string; author: string | null; invalid?: false } | { invalid: true; at: string; author: string | null };
