// Dựng cây yêu cầu từ danh sách phẳng: con nằm dưới cha (parentId), cha vắng mặt thì con thành gốc.

export interface TreeIssue {
  id: string;
  parentId?: string | null;
  updatedAt: string | Date;
}

export interface TreeNode<T extends TreeIssue> {
  issue: T;
  depth: number;
  children: TreeNode<T>[];
}

const time = (value: string | Date): number => new Date(value).getTime() || 0;

/** Mặc định: mới cập nhật trước. */
export const byUpdatedDesc = <T extends TreeIssue>(a: T, b: T): number => time(b.updatedAt) - time(a.updatedAt);

export function buildIssueTree<T extends TreeIssue>(
  issues: readonly T[],
  compare: (a: T, b: T) => number = byUpdatedDesc,
): TreeNode<T>[] {
  const ids = new Set(issues.map((i) => i.id));
  const childrenOf = new Map<string, T[]>();
  const rootIssues: T[] = [];
  for (const issue of issues) {
    if (issue.parentId && ids.has(issue.parentId) && issue.parentId !== issue.id) {
      const list = childrenOf.get(issue.parentId) ?? [];
      list.push(issue);
      childrenOf.set(issue.parentId, list);
    } else {
      rootIssues.push(issue);
    }
  }

  const seen = new Set<string>();
  const build = (issue: T, depth: number): TreeNode<T> => {
    seen.add(issue.id);
    const kids = (childrenOf.get(issue.id) ?? []).filter((c) => !seen.has(c.id)).sort(compare);
    return { issue, depth, children: kids.map((c) => build(c, depth + 1)) };
  };

  const roots = [...rootIssues].sort(compare).map((issue) => build(issue, 0));
  // Vòng cha-con (dữ liệu hỏng) không có gốc: đưa phần còn lại lên làm gốc để không mất dòng.
  for (const issue of [...issues].sort(compare)) {
    if (!seen.has(issue.id)) roots.push(build(issue, 0));
  }
  return roots;
}

/** Làm phẳng cây theo thứ tự hiển thị; nhánh `isOpen` trả false thì bỏ con. */
export function flattenTree<T extends TreeIssue>(
  nodes: readonly TreeNode<T>[],
  isOpen: (node: TreeNode<T>) => boolean,
): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  const walk = (list: readonly TreeNode<T>[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0 && isOpen(node)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
