export type DocsNode = {
  path: string;
  name: string;
  type: "directory" | "page";
  title?: string;
  children: DocsNode[];
};

export function buildDocsTree(pages: Array<{ path: string; title: string }>): DocsNode[] {
  const roots: DocsNode[] = [];
  const directories = new Map<string, DocsNode>();
  for (const page of pages) {
    const parts = page.path.split("/");
    let siblings = roots;
    for (let index = 0; index < parts.length - 1; index++) {
      const path = parts.slice(0, index + 1).join("/");
      let directory = directories.get(path);
      if (!directory) {
        directory = { path, name: parts[index]!, type: "directory", children: [] };
        directories.set(path, directory);
        siblings.push(directory);
      }
      siblings = directory.children;
    }
    siblings.push({ path: page.path, name: parts.at(-1)!, title: page.title, type: "page", children: [] });
  }
  const sort = (nodes: DocsNode[]): DocsNode[] => nodes.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name, "vi") : a.type === "directory" ? -1 : 1)
    .map(node => ({ ...node, children: sort(node.children) }));
  return sort(roots);
}
