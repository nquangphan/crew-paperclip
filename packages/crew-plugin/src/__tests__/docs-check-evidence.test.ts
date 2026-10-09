import { describe, expect, it } from "vitest";
import { parseCrewDocsCheck } from "../shared/markers.js";

// Cùng bộ ca với parseDocsCheckEvidence của server (server/src/__tests__/crew-issue-gate.test.ts).
const HEAD = "f0555c61a0336db2b076728981c57274726e52da";
const BASE = "546c7465b7699ab2e947dba92667cb016575647b";
const LINE = `crew-docs-check commit=${HEAD} range=${BASE}..${HEAD}`;
// Body thật của comment integrator trên TPS-76 (prod, 09/10/2026 18:04:59): khối ``` dính liền sau `exit=0`.
const TPS76_GLUED =
  "crew-docs-check commit=f0555c61a0336db2b076728981c57274726e52da range=546c7465b7699ab2e947dba92667cb016575647b..f0555c61a0336db2b076728981c57274726e52da exit=0```crew-docs check --range: ok (1 commits)```";

describe("parseCrewDocsCheck khớp gate server", () => {
  it("đọc dòng đầu đúng định dạng", () => {
    expect(parseCrewDocsCheck(`${LINE} exit=0\n\n\`\`\`\nok\n\`\`\``)).toEqual({
      commit: HEAD,
      range: `${BASE}..${HEAD}`,
      exit: 0,
    });
  });

  it("đọc được bằng chứng thật có khối code dính liền sau exit=N", () => {
    expect(parseCrewDocsCheck(TPS76_GLUED)).toEqual({ commit: HEAD, range: `${BASE}..${HEAD}`, exit: 0 });
    expect(parseCrewDocsCheck(`${LINE} exit=0 \`crew-docs check\`: ok`)?.exit).toBe(0);
    expect(parseCrewDocsCheck(`${LINE} exit=3\t(không có flows.yaml)`)?.exit).toBe(3);
  });

  it("giữ mã thoát khác 0", () => {
    expect(parseCrewDocsCheck(`${LINE} exit=1\`\`\`lỗi R3\`\`\``)?.exit).toBe(1);
    expect(parseCrewDocsCheck(TPS76_GLUED.replace("exit=0", "exit=2"))?.exit).toBe(2);
  });

  it("từ chối commit khác đầu range, chữ hoa, dòng không phải dòng đầu", () => {
    expect(parseCrewDocsCheck(`crew-docs-check commit=${BASE} range=${BASE}..${HEAD} exit=0`)).toBeNull();
    expect(parseCrewDocsCheck(`crew-docs-check commit=${HEAD.toUpperCase()} range=${BASE}..${HEAD} exit=0`)).toBeNull();
    expect(parseCrewDocsCheck(`ghi chú\n${LINE} exit=0`)).toBeNull();
  });

  it("từ chối exit sai dạng hay câu chữ thường", () => {
    for (const bad of ["exit=01", "exit=10", "exit=4", "exit=0x", "exit=0.", "exit="]) {
      expect(parseCrewDocsCheck(`${LINE} ${bad}`), bad).toBeNull();
    }
    expect(parseCrewDocsCheck(`Đã chạy ${LINE} exit=0`)).toBeNull();
    expect(parseCrewDocsCheck("Integrator: approve — docs check ok; docs exit 0")).toBeNull();
    expect(parseCrewDocsCheck(`docs: exit=0 \`\`\`${LINE} exit=0\`\`\``)).toBeNull();
  });
});
