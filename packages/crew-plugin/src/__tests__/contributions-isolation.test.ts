import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("..", import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
}

describe("bảng góp ý chỉ thuộc về router Crew của server", () => {
  it("không file nguồn nào của plugin nhắc tới crew_contributions hay crew_contributors", async () => {
    const files = await sourceFiles(srcRoot);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (text.includes("crew_contributions") || text.includes("crew_contributors")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
