import { describe, expect, it } from "vitest";
import type { MachineJobKind } from "../jobs/types.js";
import { validateJobPayload, validateJobResult } from "../jobs/validate.js";

const fullRoles = [
  { role: "assistant", branch: "crew/demo/assistant" }, { role: "executor", branch: "crew/demo/executor" },
  { role: "reviewer", branch: "crew/demo/reviewer" }, { role: "integrator", branch: "crew/demo/integrator" },
];

const removeCheckouts = {
  projectId: "30000000-0000-4000-8000-000000000001", projectKey: "demo", roles: ["executor-2"], removeStatusRepo: false,
};

describe("validateJobPayload", () => {
  it.each([
    ["inspect-folder", { folder: "relative/path" }, "folder phải là đường tuyệt đối"],
    ["inspect-folder", { folder: "/Users/a/../b" }, "folder không được chứa .."],
    ["inspect-folder", { folder: "/Users/a\u0007" }, "folder có ký tự điều khiển"],
    ["inspect-folder", { folder: "/Users/a\u0000b" }, "folder có ký tự điều khiển"],
    ["inspect-folder", { folder: `/${"a".repeat(4096)}` }, "folder quá dài"],
    ["inspect-folder", {}, "folder phải là đường tuyệt đối"],
    ["inspect-folder", null, "payload phải là object"],
    ["inspect-folder", [], "payload phải là object"],
    ["prepare-checkouts", { projectKey: "Bad_Key", folder: "/x", roles: [] }, "projectKey không hợp lệ"],
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: [{ role: "executor", branch: "-x" }] }, "branch không hợp lệ"],
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: [{ role: "boss", branch: "crew/demo/boss" }] }, "role không hợp lệ"],
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: [{ role: "executor", branch: "a b" }] }, "branch không hợp lệ"],
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: [{ role: "executor", branch: "x", extra: 1 }] }, "trường extra không được hỗ trợ"],
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: fullRoles.slice(0, 3) }, "roles phải có 4 hoặc 5 vai trò"],
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: [...fullRoles.slice(0, 3), fullRoles[0]] }, "role assistant bị trùng"],
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: [...fullRoles.slice(1), { role: "executor-2", branch: "x" }] }, "roles thiếu assistant"],
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: "all" }, "roles phải là mảng"],
    ["agent-workspace", { projectKey: "demo", folder: "/x", role: "executor", branch: "-x" }, "branch không hợp lệ"],
    ["agent-workspace", { projectKey: "demo", folder: "/x", role: "owner", branch: "x" }, "role không hợp lệ"],
    ["skill-sync", { skillId: "x", slug: "Ok", version: "1" }, "skillId phải là uuid"],
    ["skill-sync", { skillId: "30000000-0000-4000-8000-000000000001", slug: "Ok", version: "1" }, "slug không hợp lệ"],
    ["skill-sync", { skillId: "30000000-0000-4000-8000-000000000001", slug: "ok", version: "" }, "version không hợp lệ"],
    ["check", { projectKey: "demo", extra: 1 }, "trường extra không được hỗ trợ"],
    ["check", { projectKey: "d" }, "projectKey không hợp lệ"],
    ["check", { projectKey: "demo", kind: "inspect-folder" }, "kind trong payload không khớp"],
    ["reboot", { projectKey: "demo" }, "kind không hợp lệ"],
    ["remove-checkouts", { ...removeCheckouts, projectId: "x" }, "projectId phải là uuid"],
    ["remove-checkouts", { ...removeCheckouts, projectKey: "../x" }, "projectKey không hợp lệ"],
    ["remove-checkouts", { ...removeCheckouts, roles: [] }, "roles phải có 1 đến 5 vai trò"],
    ["remove-checkouts", { ...removeCheckouts, roles: "executor" }, "roles phải là mảng"],
    ["remove-checkouts", { ...removeCheckouts, roles: ["executor", "executor"] }, "role executor bị trùng"],
    ["remove-checkouts", { ...removeCheckouts, roles: ["boss"] }, "role không hợp lệ"],
    ["remove-checkouts", { ...removeCheckouts, roles: [{ role: "executor" }] }, "role không hợp lệ"],
    ["remove-checkouts", { ...removeCheckouts, roles: ["assistant", "executor", "executor-2", "reviewer", "integrator", "executor"] }, "roles phải có 1 đến 5 vai trò"],
    ["remove-checkouts", { ...removeCheckouts, removeStatusRepo: "yes" }, "removeStatusRepo phải là boolean"],
    ["remove-checkouts", { projectId: removeCheckouts.projectId, projectKey: "demo", roles: ["executor"] }, "removeStatusRepo phải là boolean"],
    ["remove-checkouts", { ...removeCheckouts, folder: "/x" }, "trường folder không được hỗ trợ"],
    ["skill-remove", { skillId: "x", slug: "demo" }, "skillId phải là uuid"],
    ["skill-remove", { skillId: removeCheckouts.projectId, slug: ".." }, "slug không hợp lệ"],
    ["skill-remove", { skillId: removeCheckouts.projectId, slug: "a/b" }, "slug không hợp lệ"],
    ["skill-remove", { skillId: removeCheckouts.projectId, slug: "demo", version: "1" }, "trường version không được hỗ trợ"],
  ])("%s từ chối %j", (kind, payload, error) => {
    expect(validateJobPayload(kind as MachineJobKind, payload)).toBe(error);
  });

  it("nhận payload hợp lệ và gắn kind", () => {
    expect(validateJobPayload("prepare-checkouts", { projectKey: "demo", folder: "/Users/a/repo", roles: fullRoles }))
      .toEqual({ kind: "prepare-checkouts", projectKey: "demo", folder: "/Users/a/repo", roles: fullRoles });
    const five = [...fullRoles, { role: "executor-2", branch: "crew/demo/executor-2" }];
    expect(validateJobPayload("prepare-checkouts", { projectKey: "demo", folder: "/Users/a/repo", roles: five }))
      .toMatchObject({ kind: "prepare-checkouts", roles: five });
    expect(validateJobPayload("inspect-folder", { folder: "/Users/a/my repo..bak" })).toBe("folder không được chứa ..");
    expect(validateJobPayload("inspect-folder", { kind: "inspect-folder", folder: "/Users/a/repo" }))
      .toEqual({ kind: "inspect-folder", folder: "/Users/a/repo" });
    expect(validateJobPayload("agent-workspace", { projectKey: "demo", folder: "/Users/a/repo", role: "executor-2", branch: "crew/demo/executor-2" }))
      .toEqual({ kind: "agent-workspace", projectKey: "demo", folder: "/Users/a/repo", role: "executor-2", branch: "crew/demo/executor-2" });
    expect(validateJobPayload("skill-sync", { skillId: "30000000-0000-4000-8000-00000000000A", slug: "superpowers", version: "2.1.0" }))
      .toEqual({ kind: "skill-sync", skillId: "30000000-0000-4000-8000-00000000000a", slug: "superpowers", version: "2.1.0" });
    expect(validateJobPayload("check", { projectKey: "e2e-demo" })).toEqual({ kind: "check", projectKey: "e2e-demo" });
    const allRoles = ["assistant", "executor", "executor-2", "reviewer", "integrator"];
    expect(validateJobPayload("remove-checkouts", {
      ...removeCheckouts, projectId: "30000000-0000-4000-8000-00000000000A", roles: allRoles, removeStatusRepo: true,
    })).toEqual({
      kind: "remove-checkouts", projectId: "30000000-0000-4000-8000-00000000000a", projectKey: "demo", roles: allRoles, removeStatusRepo: true,
    });
    expect(validateJobPayload("remove-checkouts", { kind: "remove-checkouts", ...removeCheckouts }))
      .toEqual({ kind: "remove-checkouts", ...removeCheckouts });
    expect(validateJobPayload("skill-remove", { skillId: "30000000-0000-4000-8000-00000000000A", slug: "my-skill" }))
      .toEqual({ kind: "skill-remove", skillId: "30000000-0000-4000-8000-00000000000a", slug: "my-skill" });
  });
});

describe("validateJobResult", () => {
  const inspect = { kind: "inspect-folder", root: "/Users/a/repo", branch: "main", remote: null, docsBundle: null, clean: true };
  it.each([
    ["inspect-folder", { ...inspect, root: 1 }],
    ["inspect-folder", { ...inspect, branch: undefined }],
    ["inspect-folder", { ...inspect, clean: "yes" }],
    ["inspect-folder", { ...inspect, remote: 3 }],
    ["prepare-checkouts", { kind: "prepare-checkouts", checkouts: "x" }],
    ["prepare-checkouts", { kind: "prepare-checkouts", checkouts: [{ role: "boss", path: "/p", head: "abc" }] }],
    ["prepare-checkouts", { kind: "prepare-checkouts", checkouts: [{ role: "executor", path: "/p" }] }],
    ["agent-workspace", { kind: "agent-workspace", role: "executor", path: 1, head: "abc" }],
    ["skill-sync", { kind: "skill-sync", sha256: "abc", files: -1 }],
    ["skill-sync", { kind: "skill-sync", sha256: 1, files: 2 }],
    ["check", { kind: "check", items: "x" }],
    ["check", { kind: "check", items: [{ id: "git", status: "fail", title: "Git" }] }],
    ["check", { kind: "check", items: [{ id: "git", status: "ok" }] }],
    ["check", { kind: "check", items: [null] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [{ role: "boss", path: "/p" }], kept: [], absent: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [{ role: "executor" }], kept: [], absent: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: [{ role: "executor", path: "/p", reason: "locked" }], absent: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: [{ role: "executor", path: "/p", reason: "dirty", detail: 3 }], absent: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: [], absent: ["boss"] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: "x", absent: [] }],
    ["skill-remove", { kind: "skill-remove", removed: "yes" }],
    ["skill-remove", { kind: "skill-remove" }],
  ])("%s từ chối %j", (kind, result) => {
    expect(validateJobResult(kind as MachineJobKind, result as Record<string, unknown>)).toBe("result không hợp lệ");
  });

  it("nhận result đúng dạng, chỉ giữ trường đã biết và che user:pass trong remote", () => {
    expect(validateJobResult("inspect-folder", { ...inspect, remote: "https://bob:secret@github.com/a/b.git", extra: 1 }))
      .toEqual({ ...inspect, remote: "https://[ĐÃ CHE]@github.com/a/b.git" });
    const checkouts = [{ role: "executor-2", path: "/Users/a/crew-agents/demo/executor-2", head: "abc123" }];
    expect(validateJobResult("prepare-checkouts", { kind: "prepare-checkouts", checkouts })).toEqual({ kind: "prepare-checkouts", checkouts });
    expect(validateJobResult("agent-workspace", { kind: "agent-workspace", ...checkouts[0] })).toEqual({ kind: "agent-workspace", ...checkouts[0] });
    expect(validateJobResult("skill-sync", { kind: "skill-sync", sha256: "ab", files: 0 })).toEqual({ kind: "skill-sync", sha256: "ab", files: 0 });
    const items = [{ id: "git", status: "warn", title: "Git" }];
    expect(validateJobResult("check", { kind: "check", items })).toEqual({ kind: "check", items });
    expect(validateJobResult("skill-remove", { kind: "skill-remove", removed: false, extra: 1 })).toEqual({ kind: "skill-remove", removed: false });
  });

  it("remove-checkouts giữ trường đã biết, làm sạch và cắt detail 300 ký tự", () => {
    const path = "/Users/a/crew-agents/demo/executor-2";
    expect(validateJobResult("remove-checkouts", {
      kind: "remove-checkouts",
      removed: [{ role: "executor-2", path, extra: 1 }],
      kept: [
        { role: "executor", path: "/Users/a/crew-agents/demo/executor", reason: "dirty", detail: `M a.ts \x1b[31m${"AKIA"}IOSFODNN7EXAMPLE` },
        { role: "reviewer", path: "/Users/a/crew-agents/demo/reviewer", reason: "git_failed", detail: "x".repeat(400) },
        { role: "integrator", path: "/Users/a/crew-agents/demo/integrator", reason: "busy" },
      ],
      absent: ["assistant"],
    })).toEqual({
      kind: "remove-checkouts",
      removed: [{ role: "executor-2", path }],
      kept: [
        { role: "executor", path: "/Users/a/crew-agents/demo/executor", reason: "dirty", detail: "M a.ts [ĐÃ CHE]" },
        { role: "reviewer", path: "/Users/a/crew-agents/demo/reviewer", reason: "git_failed", detail: "x".repeat(300) },
        { role: "integrator", path: "/Users/a/crew-agents/demo/integrator", reason: "busy" },
      ],
      absent: ["assistant"],
    });
    for (const reason of ["dirty", "busy", "not_worktree", "git_failed"]) {
      expect(validateJobResult("remove-checkouts", { kind: "remove-checkouts", removed: [], kept: [{ role: "executor", path, reason }], absent: [] }))
        .toMatchObject({ kept: [{ reason }] });
    }
  });
});
