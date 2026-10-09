import { describe, expect, it } from "vitest";
import { sanitizeJobError } from "../jobs/sanitize.js";

// Token-shaped strings are assembled at runtime so the source file itself never carries one.
const awsKey = `AKIA${"IOSFODNN7EXAMPLE"}`;
const githubToken = `ghp_${"a1B2".repeat(9)}`;

describe("sanitizeJobError", () => {
  it("bỏ mã điều khiển, che khóa AWS và cắt còn 300 ký tự", () => {
    const out = sanitizeJobError(`fatal: x\x1b[31m ${awsKey} ${"y".repeat(400)}`);
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("[31m");
    expect(out).not.toContain(awsKey);
    expect(out).toContain("[ĐÃ CHE]");
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.startsWith("fatal: x [ĐÃ CHE] y")).toBe(true);
  });

  it("che token GitHub và giữ xuống dòng", () => {
    const out = sanitizeJobError(`remote: bad credentials ${githubToken}\nhint: retry`);
    expect(out).toBe("remote: bad credentials [ĐÃ CHE]\nhint: retry");
  });

  it("che nhiều chuỗi trong cùng một dòng và bỏ ký tự điều khiển khác", () => {
    const out = sanitizeJobError(`a\u0000b\u0007c ${awsKey} ${awsKey}\x7f`);
    expect(out).toBe("abc [ĐÃ CHE] [ĐÃ CHE]");
  });

  it("không cắt đôi ký tự ngoài BMP", () => {
    const out = sanitizeJobError("😀".repeat(400));
    expect(Array.from(out)).toHaveLength(300);
    expect(out).toBe("😀".repeat(300));
  });
});
