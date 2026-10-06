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
