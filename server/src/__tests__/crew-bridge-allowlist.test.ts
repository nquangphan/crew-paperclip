import { describe, expect, it } from "vitest";
import {
  authorizeSandboxCallbackBridgeRequestWithRoutes,
  DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST,
} from "@paperclipai/adapter-utils/sandbox-callback-bridge";

// Vá lõi C17: run SSH của Trợ Lý đọc bảng cài đặt model qua cầu nối callback; chỉ đọc được, không ghi được.
describe("allowlist cầu nối callback: cài đặt model Crew", () => {
  const allowed = (method: string, path: string) =>
    authorizeSandboxCallbackBridgeRequestWithRoutes({ method, path }, DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST) === null;

  it("cho qua GET /api/crew/model-settings", () => {
    expect(allowed("GET", "/api/crew/model-settings")).toBe(true);
    expect(allowed("get", "/api/crew/model-settings")).toBe(true);
  });

  it("chặn PUT, POST và mọi đường dẫn khác dưới /api/crew", () => {
    expect(allowed("PUT", "/api/crew/model-settings")).toBe(false);
    expect(allowed("POST", "/api/crew/model-settings")).toBe(false);
    expect(allowed("POST", "/api/crew/model-settings/upgrade")).toBe(false);
    expect(allowed("GET", "/api/crew/model-settings/upgrade")).toBe(false);
    expect(allowed("GET", "/api/crew/model-settings/")).toBe(false);
    expect(allowed("GET", "/api/crew/companies/x/contributions")).toBe(false);
  });

  it("chỉ đúng bốn dòng Crew trong allowlist", () => {
    const crew = DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST.filter((rule) => rule.path.source.includes("crew"));
    expect(crew).toEqual([
      { method: "GET", path: /^\/api\/crew\/model-settings$/ },
      { method: "GET", path: /^\/api\/plugins\/crew\.core\/api\/issues\/[^/]+\/bug-finding$/ },
      { method: "POST", path: /^\/api\/plugins\/crew\.core\/api\/bug-finding\/request$/ },
      { method: "POST", path: /^\/api\/plugins\/crew\.core\/api\/bug-finding\/skip$/ },
    ]);
  });
});

// Ticket tổng code-bf: reviewer cầu nối và Trợ Lý chạy qua SSH đọc lượt Bug Finding, xếp lượt, bỏ qua sau khi owner đồng ý.
describe("allowlist cầu nối callback: Bug Finding của plugin crew.core", () => {
  const allowed = (method: string, path: string) =>
    authorizeSandboxCallbackBridgeRequestWithRoutes({ method, path }, DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST) === null;
  const base = "/api/plugins/crew.core/api";

  it("cho qua đúng ba route Bug Finding", () => {
    expect(allowed("GET", `${base}/issues/TPS-645/bug-finding`)).toBe(true);
    expect(allowed("GET", `${base}/issues/0b6f9c1e-1111-4111-8111-111111111111/bug-finding`)).toBe(true);
    expect(allowed("POST", `${base}/bug-finding/request`)).toBe(true);
    expect(allowed("POST", `${base}/bug-finding/skip`)).toBe(true);
  });

  it("chặn route kết quả (chỉ board), phương thức khác và route plugin khác", () => {
    expect(allowed("POST", `${base}/bug-finding/results`)).toBe(false);
    expect(allowed("POST", `${base}/issues/TPS-645/bug-finding`)).toBe(false);
    expect(allowed("GET", `${base}/bug-finding/request`)).toBe(false);
    expect(allowed("GET", `${base}/issues/a/b/bug-finding`)).toBe(false);
    expect(allowed("GET", `${base}/machine-jobs/claim`)).toBe(false);
    expect(allowed("GET", "/api/plugins/other/api/issues/x/bug-finding")).toBe(false);
  });
});
