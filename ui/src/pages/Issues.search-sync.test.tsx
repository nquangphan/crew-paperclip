// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Issues } from "./Issues";

type CapturedListProps = {
  initialSearch?: string;
  onSearchChange?: (search: string) => void;
  issueLinkState?: { issueDetailBreadcrumb?: { href: string } };
};

const captured = vi.hoisted(() => ({ props: null as CapturedListProps | null, search: "" }));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", issuePrefix: "PAP" },
    companies: [{ id: "company-1", issuePrefix: "PAP" }],
  }),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", issuePrefix: "PAP" },
    companies: [{ id: "company-1", issuePrefix: "PAP" }],
  }),
}));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: () => {} }) }));
vi.mock("../api/issues", () => ({
  issuesApi: { listCompact: vi.fn(async () => []), update: vi.fn() },
}));
vi.mock("../api/agents", () => ({ agentsApi: { list: vi.fn(async () => []) } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: vi.fn(async () => []) } }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: vi.fn(async () => []) } }));
vi.mock("@/hooks/useSharedPolling", () => ({
  useSharedPollingQuery: () => ({ enabled: false, refetchInterval: false }),
  usePublishSharedQueryData: () => {},
}));
vi.mock("../hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: true }) }));
vi.mock("../components/IssuesList", () => ({
  IssuesList: (props: CapturedListProps) => {
    captured.props = props;
    return null;
  },
}));

function LocationProbe() {
  captured.search = useLocation().search;
  return null;
}

describe("Issues search URL sync", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    captured.props = null;
    captured.search = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderAt(url: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route
                path="/:companyPrefix/issues"
                element={<><Issues /><LocationProbe /></>}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }

  it("clearing an opened keyword drops it from the router location and the back link", () => {
    renderAt("/PAP/issues?q=foo");
    expect(captured.props?.initialSearch).toBe("foo");

    act(() => captured.props?.onSearchChange?.(""));

    expect(captured.search).toBe("");
    expect(captured.props?.initialSearch).toBe("");
    expect(captured.props?.issueLinkState?.issueDetailBreadcrumb?.href).toBe("/PAP/issues");
  });

  it("a repeated clear does not bring the old keyword back", () => {
    renderAt("/PAP/issues?q=foo");

    act(() => captured.props?.onSearchChange?.(""));
    act(() => captured.props?.onSearchChange?.(""));

    expect(captured.props?.initialSearch).toBe("");
  });

  it("typing a keyword updates the router location", () => {
    renderAt("/PAP/issues");

    act(() => captured.props?.onSearchChange?.("bug"));

    expect(captured.search).toBe("?q=bug");
    expect(captured.props?.issueLinkState?.issueDetailBreadcrumb?.href).toBe("/PAP/issues?q=bug");
  });
});
