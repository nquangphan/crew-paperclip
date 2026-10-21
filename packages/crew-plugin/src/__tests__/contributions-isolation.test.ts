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

describe("bảng góp ý và quyền xem project chỉ thuộc về router Crew của server", () => {
  it("không file nguồn nào của plugin nhắc tới crew_contributions, crew_contributors, crew_project_access hay crew_qc_rounds", async () => {
    const files = await sourceFiles(srcRoot);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (["crew_contributions", "crew_contributors", "crew_project_access", "crew_qc_rounds"].some((table) => text.includes(table))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
