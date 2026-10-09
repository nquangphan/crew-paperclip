import { describe, expect, it } from "vitest";
import { parseFlowsManifest } from "../docs/manifest.js";

const ok = `version: 1
source:
  include: ["apps/**"]
flows:
  mac-setup:
    title: Cài Mac
    doc: docs/flows/mac-setup.md
    entrypoints: [apps/crew-mac/src/cli.ts]
    files: [apps/crew-mac/src/status/docs.ts]
    tests: [apps/crew-mac/test/status-docs.test.ts]
shared:
  apps/crew-mac/src/paths.ts: [mac-setup]
`;

describe("parseFlowsManifest", () => {
  it("parses a valid manifest with defaults", () => {
    const result = parseFlowsManifest(ok);
    expect(result.state).toBe("ok");
    if (result.state !== "ok") return;
    expect(result.flows).toEqual([{ id: "mac-setup", title: "Cài Mac", doc: "docs/flows/mac-setup.md",
      entrypoints: ["apps/crew-mac/src/cli.ts"], files: ["apps/crew-mac/src/status/docs.ts"],
      tests: ["apps/crew-mac/test/status-docs.test.ts"] }]);
    expect(result.shared).toEqual([{ path: "apps/crew-mac/src/paths.ts", flows: ["mac-setup"] }]);
  });
  it("defaults missing arrays to empty", () => {
    const result = parseFlowsManifest('version: 1\nsource: {include: ["a/**"]}\nflows: {x: {title: X, doc: docs/x.md}}\n');
    expect(result.state === "ok" && result.flows[0]).toMatchObject({ entrypoints: [], files: [], tests: [] });
  });
  it.each([
    ["not yaml", "flows: [\n"],
    ["duplicate key", "version: 1\nversion: 1\n"],
    ["wrong version", 'version: 2\nsource: {include: ["a"]}\nflows: {}\n'],
    ["no source", "version: 1\nflows: {}\n"],
    ["bad flow id", 'version: 1\nsource: {include: ["a"]}\nflows: {Bad_Id: {title: X, doc: d.md}}\n'],
    ["files not strings", 'version: 1\nsource: {include: ["a"]}\nflows: {x: {title: X, doc: d.md, files: [1]}}\n'],
    ["shared to unknown flow", 'version: 1\nsource: {include: ["a"]}\nflows: {}\nshared: {a.ts: [nope]}\n'],
    ["not an object", "- a\n- b\n"],
  ])("rejects %s with at most 20 short errors", (_name, text) => {
    const result = parseFlowsManifest(text);
    expect(result.state).toBe("invalid");
    if (result.state === "invalid") {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.length).toBeLessThanOrEqual(20);
      for (const error of result.errors) expect(error.length).toBeLessThanOrEqual(200);
    }
  });
  it("caps the error list at 20", () => {
    const flows = Array.from({ length: 30 }, (_, i) => `Bad${i}: {title: X, doc: d.md}`).join(", ");
    const result = parseFlowsManifest(`version: 1\nsource: {include: ["a"]}\nflows: {${flows}}\n`);
    expect(result.state === "invalid" && result.errors.length).toBe(20);
  });
});
