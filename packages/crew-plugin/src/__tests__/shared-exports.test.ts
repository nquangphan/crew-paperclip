import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../..");
const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));
const SUBPATHS = ["map", "docs-tree", "machine-card", "attachment-rules"] as const;

describe("exports ./shared/*", () => {
  it("package.json trỏ subpath vào src/shared-web", () => {
    expect(pkg.exports["./shared/*"]).toEqual({ types: "./src/shared-web/*.ts", import: "./src/shared-web/*.ts" });
    for (const name of SUBPATHS) expect(existsSync(resolve(pkgRoot, `src/shared-web/${name}.ts`))).toBe(true);
  });

  it("map: layout và projection", async () => {
    const mod = await import("../shared-web/map.js");
    const root = { id: "r", identifier: "A-1", title: "Gốc", status: "todo", parentId: null, assignee: null, stage: null, reviewRounds: 0, maxReviewRounds: 3, kind: "code" as const, bundle: null };
    const projection = mod.projectCrewMap({ root, nodes: [root], edges: [], diagnostics: [] });
    const positions = mod.layoutHierarchy(projection);
    expect(Object.keys(positions)).toContain("r");
    expect(typeof mod.cardWidth).toBe("number");
  });

  it("docs-tree: dựng cây thư mục", async () => {
    const { buildDocsTree } = await import("../shared-web/docs-tree.js");
    expect(buildDocsTree([{ path: "docs/a.md", title: "A" }])).toMatchObject([{ path: "docs", type: "directory", children: [{ path: "docs/a.md", type: "page" }] }]);
  });

  it("machine-card: model thuần, không React", async () => {
    const { machineCardModel, appLine } = await import("../shared-web/machine-card.js");
    expect(appLine(undefined)).toBe("Chạy bằng CLI");
    const model = machineCardModel({
      machineId: "m", hostname: "mini", lastSeenAt: "2026-10-08T14:00:00Z", online: true, load24h: [],
      latest: { version: 1, companyId: "c", machineId: "m", hostname: "mini", sentAt: "2026-10-08T14:00:00Z", load1: null, cpuCount: null,
        memFreePct: null, tccPending: [], checks: [{ id: "x", title: "Lỗi X", status: "error" }],
        claude: { version: null, loggedIn: null, plan: null }, superpowers: { pinned: null, ownerInstalled: null } },
    } as never);
    expect(model.hostname).toBe("mini");
    expect(model.statusLabel).toBe("Trực tuyến");
    expect(model.loadLine).toContain("Không rõ");
    expect(model.claudeLine).not.toContain("chưa đăng nhập");
    expect(model.alerts).toEqual([{ id: "x", text: "Lỗi: Lỗi X" }]);
  });

  it("attachment-rules: cảnh báo file agent không đọc", async () => {
    const { warnForAttachment, ALLOWED_EXTENSIONS } = await import("../shared-web/attachment-rules.js");
    expect(warnForAttachment("a.png")).toBeNull();
    expect(warnForAttachment("notes.md")).toBeNull();
    expect(warnForAttachment("a.zip")).toContain("zip");
    expect(warnForAttachment("macro.xlsm")).toContain("macro");
    expect(warnForAttachment("lạ.xyz")).not.toBeNull();
    expect(ALLOWED_EXTENSIONS).toContain("pdf");
  });
});

/** Gom file nguồn đạt tới từ các entry qua import tương đối; `withTypes` thì đi cả cạnh `import type`/`export type`. */
function collect(entries: string[], withTypes: boolean): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const text = readFileSync(file, "utf8");
    seen.set(file, text);
    for (const match of text.matchAll(/\b(?:import|export)(\s+type)?\s+[^;"']*?from\s*["'](\.[^"']+)["']/g)) {
      if (match[1] && !withTypes) continue;
      const target = resolve(dirname(file), match[2]!.replace(/\.js$/, ".ts"));
      if (existsSync(target)) queue.push(target);
    }
  }
  return seen;
}

const entries = SUBPATHS.map((name) => resolve(pkgRoot, `src/shared-web/${name}.ts`));

describe("graph import của shared-web", () => {
  const runtime = collect(entries, false);
  const withTypes = collect(entries, true);

  it("có file nguồn thật trong graph", () => {
    expect(runtime.size).toBeGreaterThan(SUBPATHS.length);
    expect(withTypes.size).toBeGreaterThanOrEqual(runtime.size);
  });

  it("graph chạy: không react, xyflow, tsx, plugin-sdk hay module worker", () => {
    for (const [file, text] of runtime) {
      expect(file).not.toMatch(/\.tsx$/);
      expect(text, file).not.toMatch(/from\s+["'](?:react(?:-dom)?(?:\/[^"']*)?|@xyflow\/[^"']*|@paperclipai\/plugin-sdk[^"']*)["']/);
      expect(text, file).not.toMatch(/from\s+["'][^"']*(?:shared\/(?:db|webhook)|\/worker|\/registry)\.js["']/);
    }
  });

  it("graph kiểu: không react, xyflow; SDK chỉ ở dạng import type", () => {
    for (const [file, text] of withTypes) {
      expect(file).not.toMatch(/\.tsx$/);
      expect(text, file).not.toMatch(/from\s+["'](?:react(?:-dom)?(?:\/[^"']*)?|@xyflow\/[^"']*)["']/);
      for (const line of text.split("\n")) {
        if (/from\s+["']@paperclipai\/plugin-sdk/.test(line)) expect(line, file).toMatch(/^\s*import type\b/);
      }
    }
  });
});
