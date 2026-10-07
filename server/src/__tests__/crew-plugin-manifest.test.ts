import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest from "../../../packages/crew-plugin/src/manifest.ts";

describe("manifest plugin Crew", () => {
  it("hợp lệ theo pluginManifestV1Schema của host", () => {
    const result = pluginManifestV1Schema.safeParse(manifest);
    expect(result.success, JSON.stringify(result.error?.issues ?? [])).toBe(true);
    expect(manifest.id).toBe("crew.core");
    expect(manifest.entrypoints.worker).toBe("./dist/worker.js");
  });
});

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/crew-plugin");

describe("bundle plugin Crew", () => {
  it("dist tự đủ: không còn import @paperclipai/* và manifest giống bản nguồn", async () => {
    execFileSync(process.execPath, ["build.mjs"], { cwd: pluginDir, stdio: "pipe" });
    for (const file of ["dist/worker.js", "dist/manifest.js"]) {
      const text = readFileSync(path.join(pluginDir, file), "utf8");
      expect(text, file).not.toMatch(/from\s*["']@paperclipai\//);
      expect(text, file).not.toMatch(/import\(\s*["']@paperclipai\//);
    }
    const built = (await import(path.join(pluginDir, "dist/manifest.js"))).default;
    expect(built).toEqual(manifest);
  }, 60_000);
});
