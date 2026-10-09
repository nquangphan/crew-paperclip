import { describe, expect, it } from "vitest";
import { computeContentKey } from "../docs/content-key.js";

const base = {
  format: 2 as const,
  commit: "a".repeat(40),
  auditState: "verified",
  manifestSha256: null,
  pages: [{ path: "docs/b.md", sha256: "2".repeat(64) }, { path: "docs/a.md", sha256: "1".repeat(64) }],
  dropped: [{ path: "docs/x.md", reason: "secret-scan" }],
};

describe("computeContentKey", () => {
  it("is a 64-hex sha and ignores page order", () => {
    const key = computeContentKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(computeContentKey({ ...base, pages: [...base.pages].reverse() })).toBe(key);
  });
  it("changes when any part changes", () => {
    const key = computeContentKey(base);
    for (const variant of [
      { ...base, commit: "b".repeat(40) },
      { ...base, auditState: "invalid" },
      { ...base, format: 1 as const },
      { ...base, manifestSha256: "3".repeat(64) },
      { ...base, pages: [{ path: "docs/a.md", sha256: "9".repeat(64) }, base.pages[0]!] },
      { ...base, dropped: [] },
    ]) expect(computeContentKey(variant)).not.toBe(key);
  });
});
