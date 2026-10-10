// Project đã gắn sao cho sidebar: theo thứ tự đã lưu ở sidebar-preferences (cùng thứ tự với trang Project).
import type { Project } from '@paperclipai/shared';

export function starredProjects<T extends Pick<Project, 'id' | 'archivedAt'>>(
  projects: readonly T[],
  orderedIds: readonly string[],
): T[] {
  const byId = new Map(projects.filter((p) => !p.archivedAt).map((p) => [p.id, p]));
  const out: T[] = [];
  for (const id of new Set(orderedIds)) {
    const project = byId.get(id);
    if (project) out.push(project);
  }
  return out;
}
