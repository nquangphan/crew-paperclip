/** A React function component; the plugin declares React types itself (`src/shared/react.d.ts`). */
export type CrewComponent<P> = (props: P) => unknown;

/** A panel shown under the map in the Crew tab of an issue. */
export interface IssuePanel {
  id: string;
  order: number;
  component: CrewComponent<{ issueId: string; companyId: string }>;
}

/** A section of the Crew page (requests, machines, docs). */
export interface PageSection {
  id: string;
  title: string;
  order: number;
  component: CrewComponent<{ companyId: string }>;
}

const issuePanels: IssuePanel[] = [];
const pageSections: PageSection[] = [];

function upsert<T extends { id: string; order: number }>(list: T[], item: T): void {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list.splice(index, 1, item);
  else list.push(item);
  list.sort((a, b) => a.order - b.order);
}

export function registerIssuePanel(panel: IssuePanel): void {
  upsert(issuePanels, panel);
}

export function registerPageSection(section: PageSection): void {
  upsert(pageSections, section);
}

export function getIssuePanels(): readonly IssuePanel[] {
  return issuePanels;
}

export function getPageSections(): readonly PageSection[] {
  return pageSections;
}
