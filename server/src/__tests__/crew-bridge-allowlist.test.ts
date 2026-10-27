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

  it("chỉ đúng một dòng Crew trong allowlist", () => {
    const crew = DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST.filter((rule) => rule.path.source.includes("crew"));
    expect(crew).toEqual([{ method: "GET", path: /^\/api\/crew\/model-settings$/ }]);
  });
});
