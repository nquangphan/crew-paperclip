import { describe, expect, it } from "vitest";
import { JOB_ERROR_CODES, MACHINE_JOB_KINDS, type MachineJobKind } from "../jobs/types.js";
import { validateJobPayload, validateJobResult } from "../jobs/validate.js";

const fullRoles = [
  { role: "assistant", branch: "crew/demo/assistant" }, { role: "executor", branch: "crew/demo/executor" },
  { role: "reviewer", branch: "crew/demo/reviewer" }, { role: "integrator", branch: "crew/demo/integrator" },
];

const allSlots = ["assistant", "executor", "executor-2", "executor-3", "executor-4", "executor-5", "reviewer", "integrator", "executor-codex", "executor-opencode", "reviewer-codex"];

const removeCheckouts = {
  projectId: "30000000-0000-4000-8000-000000000001", projectKey: "demo", roles: ["executor-2"], removeStatusRepo: false,
};

const ensureProject = {
  projectKey: "kidy-school",
  projectId: "30000000-0000-4000-8000-000000000001",
  originUrl: "git@github.com:nquangphan/kidy_school.git",
  branch: "main",
  roles: [{ role: "assistant", branch: "agent/kidy-school-assistant" }, { role: "executor-1", branch: "agent/kidy-school-executor-1" }],
  companions: [{ name: "kidy_school_2.0_docs", originUrl: "https://github.com/nquangphan/kidy_school_2.0_docs.git" }],
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
    ["prepare-checkouts", { projectKey: "demo", folder: "/x", roles: fullRoles.slice(0, 3) }, "roles phải có 4 đến 8 vai trò"],
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
    ["remove-checkouts", { ...removeCheckouts, roles: [] }, "roles phải có 1 đến 12 vai trò"],
    ["remove-checkouts", { ...removeCheckouts, roles: "executor" }, "roles phải là mảng"],
    ["remove-checkouts", { ...removeCheckouts, roles: ["executor", "executor"] }, "role executor bị trùng"],
    ["remove-checkouts", { ...removeCheckouts, roles: ["Boss"] }, "role không hợp lệ"],
    ["remove-checkouts", { ...removeCheckouts, roles: ["repo"] }, "role không hợp lệ"],
    ["remove-checkouts", { ...removeCheckouts, roles: [{ role: "executor" }] }, "role không hợp lệ"],
    ["remove-checkouts", { ...removeCheckouts, roles: [...allSlots, "designer", "executor"] }, "roles phải có 1 đến 12 vai trò"],
    ["remove-checkouts", { ...removeCheckouts, roles: ["executor-codex", "executor-codex"] }, "role executor-codex bị trùng"],
    ["agent-workspace", { projectKey: "demo", folder: "/x", role: "reviewer-claude", branch: "x" }, "role không hợp lệ"],
    ["runtimes-setup", { force: true }, "trường force không được hỗ trợ"],
    ["runtimes-setup", { kind: "check" }, "kind trong payload không khớp"],
    ["runtimes-setup", null, "payload phải là object"],
    ["remove-checkouts", { ...removeCheckouts, removeStatusRepo: "yes" }, "removeStatusRepo phải là boolean"],
    ["remove-checkouts", { projectId: removeCheckouts.projectId, projectKey: "demo", roles: ["executor"] }, "removeStatusRepo phải là boolean"],
    ["remove-checkouts", { ...removeCheckouts, folder: "/x" }, "trường folder không được hỗ trợ"],
    ["skill-remove", { skillId: "x", slug: "demo" }, "skillId phải là uuid"],
    ["skill-remove", { skillId: removeCheckouts.projectId, slug: ".." }, "slug không hợp lệ"],
    ["skill-remove", { skillId: removeCheckouts.projectId, slug: "a/b" }, "slug không hợp lệ"],
    ["skill-remove", { skillId: removeCheckouts.projectId, slug: "demo", version: "1" }, "trường version không được hỗ trợ"],
    ["ensure-project", { ...ensureProject, projectId: "x" }, "projectId phải là uuid"],
    ["ensure-project", { ...ensureProject, projectKey: "Kidy" }, "projectKey không hợp lệ"],
    ["ensure-project", { ...ensureProject, originUrl: "ftp://github.com/a/b" }, "originUrl không hợp lệ"],
    ["ensure-project", { ...ensureProject, originUrl: "git@github.com:a/b c" }, "originUrl không hợp lệ"],
    ["ensure-project", { ...ensureProject, originUrl: `https://github.com/${"a".repeat(500)}` }, "originUrl không hợp lệ"],
    ["ensure-project", { ...ensureProject, branch: "-main" }, "branch không hợp lệ"],
    ["ensure-project", { ...ensureProject, roles: [] }, "roles phải có 1 đến 12 vai trò"],
    ["ensure-project", { ...ensureProject, roles: [{ role: "repo", branch: "x" }] }, "role không hợp lệ"],
    ["ensure-project", { ...ensureProject, roles: [{ role: "Executor", branch: "x" }] }, "role không hợp lệ"],
    ["ensure-project", { ...ensureProject, roles: [{ role: "assistant", branch: "x" }, { role: "assistant", branch: "y" }] }, "role assistant bị trùng"],
    ["ensure-project", { ...ensureProject, companions: [{ name: "../x", originUrl: "git@github.com:a/b.git" }] }, "tên repo đi kèm không hợp lệ"],
    ["ensure-project", { ...ensureProject, companions: [{ name: "assistant", originUrl: "git@github.com:a/b.git" }] }, "tên repo đi kèm assistant bị trùng"],
    ["ensure-project", { ...ensureProject, companions: "docs" }, "companions phải là mảng"],
    ["ensure-project", { ...ensureProject, folder: "/x" }, "trường folder không được hỗ trợ"],
  ])("%s từ chối %j", (kind, payload, error) => {
    expect(validateJobPayload(kind as MachineJobKind, payload)).toBe(error);
  });

  it("ensure-project hợp lệ: gắn kind, projectId chữ thường, chỉ giữ trường đã biết", () => {
    expect(validateJobPayload("ensure-project", { ...ensureProject, projectId: ensureProject.projectId.toUpperCase() }))
      .toEqual({ kind: "ensure-project", ...ensureProject });
    expect(validateJobPayload("ensure-project", { ...ensureProject, companions: [] }))
      .toEqual({ kind: "ensure-project", ...ensureProject, companions: [] });
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
    for (const role of ["executor-codex", "executor-opencode", "reviewer-codex"]) {
      expect(validateJobPayload("agent-workspace", { projectKey: "demo", folder: "/Users/a/repo", role, branch: `crew/demo/${role}` }))
        .toEqual({ kind: "agent-workspace", projectKey: "demo", folder: "/Users/a/repo", role, branch: `crew/demo/${role}` });
    }
    expect(validateJobPayload("agent-workspace", { projectKey: "demo", folder: "/Users/a/repo", role: "designer", branch: "crew/demo/designer" }))
      .toEqual({ kind: "agent-workspace", projectKey: "demo", folder: "/Users/a/repo", role: "designer", branch: "crew/demo/designer" });
    expect(validateJobPayload("prepare-checkouts", { projectKey: "demo", folder: "/x", roles: [...fullRoles, { role: "designer", branch: "x" }] }))
      .toBe("role không hợp lệ");
    expect(validateJobPayload("remove-checkouts", { ...removeCheckouts, roles: allSlots })).toEqual({ kind: "remove-checkouts", ...removeCheckouts, roles: allSlots });
    const withDesigner = [...allSlots, "designer"];
    expect(validateJobPayload("remove-checkouts", { ...removeCheckouts, roles: withDesigner })).toEqual({ kind: "remove-checkouts", ...removeCheckouts, roles: withDesigner });
    const fiveExecutors = [...fullRoles, ...["executor-2", "executor-3", "executor-4", "executor-5"].map((role) => ({ role, branch: `crew/demo/${role}` }))];
    expect(validateJobPayload("prepare-checkouts", { projectKey: "demo", folder: "/x", roles: fiveExecutors }))
      .toEqual({ kind: "prepare-checkouts", projectKey: "demo", folder: "/x", roles: fiveExecutors });
    expect(validateJobPayload("prepare-checkouts", { projectKey: "demo", folder: "/x", roles: [...fiveExecutors, { role: "executor-codex", branch: "x" }] }))
      .toBe("roles phải có 4 đến 8 vai trò");
    expect(validateJobPayload("runtimes-setup", {})).toEqual({ kind: "runtimes-setup" });
    expect(validateJobPayload("runtimes-setup", { kind: "runtimes-setup" })).toEqual({ kind: "runtimes-setup" });
    expect(validateJobPayload("skill-remove", { skillId: "30000000-0000-4000-8000-00000000000A", slug: "my-skill" }))
      .toEqual({ kind: "skill-remove", skillId: "30000000-0000-4000-8000-00000000000a", slug: "my-skill" });
  });
});

describe("validateJobResult", () => {
  const runtimesSetup = {
    kind: "runtimes-setup", wrappers: { codex: true, opencode: false },
    codex: { version: "0.130.0", loggedIn: true }, opencode: { version: null, keyPresent: null },
  };
  it("ensure-project: result đúng dạng thì giữ trường đã biết, sai dạng thì từ chối", () => {
    const result = {
      kind: "ensure-project", repoPath: "/Volumes/CORSAIR/Projects/kidy_school", cloned: false,
      checkouts: [{ role: "executor-1", path: "/Users/a/crew-agents/kidy-school/executor-1", head: "abc" }],
      companions: [{ name: "kidy_school_2.0_docs", path: "/Users/a/crew-agents/kidy-school/kidy_school_2.0_docs" }],
    };
    expect(validateJobResult("ensure-project", { ...result, extra: 1 })).toEqual(result);
    expect(validateJobResult("ensure-project", { ...result, cloned: "no" })).toBe("result không hợp lệ");
    expect(validateJobResult("ensure-project", { ...result, checkouts: [{ role: "Bad", path: "/x", head: "a" }] })).toBe("result không hợp lệ");
    expect(validateJobResult("ensure-project", { ...result, companions: [{ name: "x" }] })).toBe("result không hợp lệ");
  });

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
    ["remove-checkouts", { kind: "remove-checkouts", removed: [{ role: "Boss", path: "/p" }], kept: [], absent: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [{ role: "executor" }], kept: [], absent: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: [{ role: "executor", path: "/p", reason: "locked" }], absent: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: [{ role: "executor", path: "/p", reason: "dirty", detail: 3 }], absent: [] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: [], absent: ["Boss"] }],
    ["remove-checkouts", { kind: "remove-checkouts", removed: [], kept: "x", absent: [] }],
    ["skill-remove", { kind: "skill-remove", removed: "yes" }],
    ["skill-remove", { kind: "skill-remove" }],
    ["runtimes-setup", { ...runtimesSetup, wrappers: { codex: true } }],
    ["runtimes-setup", { ...runtimesSetup, wrappers: "yes" }],
    ["runtimes-setup", { ...runtimesSetup, codex: { version: 1, loggedIn: true } }],
    ["runtimes-setup", { ...runtimesSetup, codex: { version: null } }],
    ["runtimes-setup", { ...runtimesSetup, opencode: { version: null, keyPresent: "yes" } }],
    ["runtimes-setup", { ...runtimesSetup, opencode: null }],
    ["runtimes-setup", { ...runtimesSetup, codex: { version: "x".repeat(201), loggedIn: true } }],
    ["agent-workspace", { kind: "agent-workspace", role: "executor-claude", path: "/p", head: "abc" }],
  ])("%s từ chối %j", (kind, result) => {
    expect(validateJobResult(kind as MachineJobKind, result as Record<string, unknown>)).toBe("result không hợp lệ");
  });

  it("nhận result đúng dạng, chỉ giữ trường đã biết và che user:pass trong remote", () => {
    expect(validateJobResult("inspect-folder", { ...inspect, remote: "https://bob:secret@github.com/a/b.git", extra: 1 }))
      .toEqual({ ...inspect, remote: "https://[ĐÃ CHE]@github.com/a/b.git" });
    const checkouts = [{ role: "executor-2", path: "/Users/a/crew-agents/demo/executor-2", head: "abc123" }];
    expect(validateJobResult("prepare-checkouts", { kind: "prepare-checkouts", checkouts })).toEqual({ kind: "prepare-checkouts", checkouts });
    expect(validateJobResult("agent-workspace", { kind: "agent-workspace", ...checkouts[0] })).toEqual({ kind: "agent-workspace", ...checkouts[0] });
    const designer = { role: "designer", path: "/Users/a/crew-agents/demo/designer", head: "abc" };
    expect(validateJobResult("agent-workspace", { kind: "agent-workspace", ...designer })).toEqual({ kind: "agent-workspace", ...designer });
    expect(validateJobResult("prepare-checkouts", { kind: "prepare-checkouts", checkouts: [designer] })).toBe("result không hợp lệ");
    expect(validateJobResult("skill-sync", { kind: "skill-sync", sha256: "ab", files: 0 })).toEqual({ kind: "skill-sync", sha256: "ab", files: 0 });
    const items = [{ id: "git", status: "warn", title: "Git" }];
    expect(validateJobResult("check", { kind: "check", items })).toEqual({ kind: "check", items });
    expect(validateJobResult("skill-remove", { kind: "skill-remove", removed: false, extra: 1 })).toEqual({ kind: "skill-remove", removed: false });
  });

  it("runtimes-setup chỉ giữ trường của hợp đồng, bỏ mọi trường lạ (không mang key, token, path auth)", () => {
    expect(validateJobResult("runtimes-setup", {
      ...runtimesSetup, authPath: "/Users/a/.codex/auth.json",
      wrappers: { ...runtimesSetup.wrappers, path: "/x" },
      codex: { ...runtimesSetup.codex, token: "sk-secret" },
      opencode: { version: "1.18.35", keyPresent: false, key: "sk-secret" },
    })).toEqual({ ...runtimesSetup, opencode: { version: "1.18.35", keyPresent: false } });
    const json = JSON.stringify(validateJobResult("runtimes-setup", { ...runtimesSetup, codex: { ...runtimesSetup.codex, token: "sk-secret" } }));
    expect(json).not.toContain("sk-secret");
  });

  it("remove-checkouts nhận tên thư mục checkout của app (executor-1) bên cạnh tám ô", () => {
    expect(validateJobPayload("remove-checkouts", { ...removeCheckouts, roles: ["executor-1", "assistant"] }))
      .toEqual({ kind: "remove-checkouts", ...removeCheckouts, roles: ["executor-1", "assistant"] });
    const result = {
      kind: "remove-checkouts", removed: [{ role: "executor-1", path: "/Users/a/crew-agents/demo/executor-1" }], kept: [], absent: ["integrator"],
    };
    expect(validateJobResult("remove-checkouts", result)).toEqual(result);
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

const bugFindingReview = {
  requestId: "70000000-0000-4000-8000-000000000001",
  issueId: "30000000-0000-4000-8000-000000000002",
  identifier: "TPS-643",
  run: 1,
  projectId: "30000000-0000-4000-8000-000000000001",
  projectKey: "my-crew",
  repoPath: "/Users/a/crew-agents/my-crew/repo",
  provider: "github",
  prNumber: 87,
  prUrl: "https://github.com/nquangphan/my-crew/pull/87",
  headSha: "a".repeat(40),
  baseBranch: "main",
};

describe("bug-finding-review", () => {
  it("payload hợp lệ: gắn kind, id chữ thường, reviewerInputText không bắt buộc", () => {
    expect(validateJobPayload("bug-finding-review", bugFindingReview)).toEqual({ kind: "bug-finding-review", ...bugFindingReview });
    const upper = { ...bugFindingReview, requestId: bugFindingReview.requestId.toUpperCase(), issueId: bugFindingReview.issueId.toUpperCase() };
    expect(validateJobPayload("bug-finding-review", { ...upper, reviewerInputText: "F-04: owner chọn không sửa" }))
      .toEqual({ kind: "bug-finding-review", ...bugFindingReview, reviewerInputText: "F-04: owner chọn không sửa" });
    expect(validateJobPayload("bug-finding-review", { ...bugFindingReview, run: 3, reviewerInputText: "x".repeat(20_000) }))
      .toMatchObject({ run: 3 });
  });

  it.each([
    [{ requestId: "x" }, "requestId phải là uuid"],
    [{ issueId: "x" }, "issueId phải là uuid"],
    [{ identifier: "tps 643" }, "identifier không hợp lệ"],
    [{ run: 0 }, "run phải là số nguyên 1 đến 3"],
    [{ run: 4 }, "run phải là số nguyên 1 đến 3"],
    [{ run: 1.5 }, "run phải là số nguyên 1 đến 3"],
    [{ projectId: "x" }, "projectId phải là uuid"],
    [{ projectKey: "My_Crew" }, "projectKey không hợp lệ"],
    [{ repoPath: "crew-agents/my-crew/repo" }, "repoPath phải là đường tuyệt đối"],
    [{ repoPath: "/Users/a/../b" }, "repoPath không được chứa .."],
    [{ provider: "gitlab" }, "provider chỉ nhận github"],
    [{ prNumber: 0 }, "prNumber phải là số nguyên dương"],
    [{ prNumber: "87" }, "prNumber phải là số nguyên dương"],
    [{ prUrl: "https://gitlab.com/a/b/-/merge_requests/87" }, "prUrl không hợp lệ"],
    [{ prUrl: "https://github.com/nquangphan/my-crew/pull/88" }, "prUrl không khớp prNumber"],
    [{ headSha: "A".repeat(40) }, "headSha phải là 40 ký tự hex"],
    [{ headSha: "a".repeat(39) }, "headSha phải là 40 ký tự hex"],
    [{ baseBranch: "-main" }, "baseBranch không hợp lệ"],
    [{ reviewerInputText: "x".repeat(20_001) }, "reviewerInputText quá 20000 ký tự"],
    [{ reviewerInputText: 5 }, "reviewerInputText phải là chuỗi"],
    [{ extra: 1 }, "trường extra không được hỗ trợ"],
  ])("từ chối %j", (patch, error) => {
    expect(validateJobPayload("bug-finding-review", { ...bugFindingReview, ...patch })).toBe(error);
  });

  it("thiếu trường bắt buộc thì từ chối", () => {
    const { headSha: _, ...missing } = bugFindingReview;
    expect(validateJobPayload("bug-finding-review", missing)).toBe("headSha phải là 40 ký tự hex");
  });

  it("kết quả chỉ nhận accepted: true", () => {
    expect(validateJobResult("bug-finding-review", { kind: "bug-finding-review", accepted: true, extra: 1 }))
      .toEqual({ kind: "bug-finding-review", accepted: true });
    expect(validateJobResult("bug-finding-review", { kind: "bug-finding-review", accepted: false })).toBe("result không hợp lệ");
    expect(validateJobResult("bug-finding-review", { kind: "bug-finding-review" })).toBe("result không hợp lệ");
  });

  it("mã lỗi riêng của Bug Finding nằm trong hợp đồng", () => {
    expect(JOB_ERROR_CODES).toEqual(expect.arrayContaining(["project_missing", "bug_finding_missing", "standalone_running"]));
    expect(MACHINE_JOB_KINDS).toContain("bug-finding-review");
  });
});
