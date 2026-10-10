import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema } from "../../../shared/src/validators/plugin.js";
import manifest from "../manifest.js";
import plugin from "../worker.js";

describe("worker definition", () => {
  it("khai multiCompanyConfig để host không từ chối cấu hình của company thứ hai", () => {
    expect(plugin.definition.multiCompanyConfig).toBe(true);
  });

  it("manifest vẫn hợp lệ", () => {
    expect(pluginManifestV1Schema.safeParse(manifest).success).toBe(true);
  });
});
