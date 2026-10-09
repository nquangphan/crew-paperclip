// Bản đồ phủ nút: mọi mã BA mục 1 (e2e/ba-ids.json) phải có ca Playwright trong e2e/coverage.json, hoặc lý do bỏ.
// Ca "mọi mã BA có ca" chỉ chặt khi CREW_E2E_COVERAGE_STRICT=1, vì các file spec theo màn hình được viết dần.
// Khi đủ spec, bỏ biến này để ca luôn chặt.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface CoverageEntry {
  spec: string | null;
  tests?: string[];
  tier: 'T1' | 'T2' | 'T3';
  skip?: string;
}

const root = path.resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const ids: string[] = JSON.parse(read('e2e/ba-ids.json')).ids;
const cov: Record<string, CoverageEntry> = JSON.parse(read('e2e/coverage.json'));
const STRICT = process.env.CREW_E2E_COVERAGE_STRICT === '1';

describe('bản đồ phủ nút e2e', () => {
  it('ba-ids.json không trùng mã và đủ nhóm S0–S19, F1–F9', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of ['S0.1', 'S9.err', 'S13.7', 'S17', 'S19', 'F1', 'F9']) expect(ids).toContain(g);
  });

  (STRICT ? it : it.todo)('mọi mã BA có ca hoặc lý do bỏ', () => {
    expect(ids.filter((id) => !cov[id] || (!cov[id].tests?.length && !cov[id].skip))).toEqual([]);
  });

  it('mọi khóa trong coverage là mã BA', () => {
    expect(Object.keys(cov).filter((id) => !ids.includes(id))).toEqual([]);
  });

  it('mọi ca trong coverage có thật trong file spec', () => {
    for (const [id, c] of Object.entries(cov)) {
      expect(['T1', 'T2', 'T3'], id).toContain(c.tier);
      if (!c.tests?.length) continue;
      expect(c.spec && existsSync(path.join(root, c.spec)), `${id}: ${c.spec}`).toBeTruthy();
      const src = read(c.spec as string);
      for (const t of c.tests) expect(src, `${id}: ${t}`).toContain(t);
    }
  });

  it('chỉ F9 được bỏ', () => {
    expect(
      Object.entries(cov)
        .filter(([, c]) => c.skip)
        .map(([id]) => id),
    ).toEqual(['F9']);
  });
});
