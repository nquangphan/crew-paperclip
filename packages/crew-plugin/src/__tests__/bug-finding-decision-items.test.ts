import { describe, expect, it } from "vitest";
import { applyDecisionItems, parseDecisionItems } from "../bug-finding/api.js";
import type { BugFindingFinding } from "../bug-finding/runs.js";

// Rút gọn từ một `review-result.json` thật (schema `mobile-review/result@2`): finding không có `action`/`question`, câu hỏi
// cho owner nằm ở `decision_items` cấp gốc; một mục không nhắc finding nào.
const RESULT = {
  schema: "mobile-review/result@2",
  findings: [
    { id: "F-01", rule: "UNCATEGORIZED", title: "Mockup bỏ hai cột mặc định", severity: "LOW", certainty: "Confirmed", status: "OPEN",
      mr_relation: "introduced", location: "docs/design/mockups/x/ui.js:117 (colHead)", fix: "Vẽ đủ cột", accept: "Mockup đủ cột" },
    { id: "F-02", rule: "UNCATEGORIZED", title: "Mockup thiếu trạng thái lọc", severity: "LOW", certainty: "Confirmed", status: "OPEN",
      mr_relation: "introduced", location: "docs/design/mockups/x/trang-thai.html:40", fix: "Thêm trạng thái", accept: "Có trạng thái" },
    { id: "F-04", rule: "WEB-STATE-03", title: "Nhãn máy không tự làm mới", severity: "MEDIUM", certainty: "Confirmed", status: "OPEN",
      mr_relation: "introduced", location: "packages/crew-web/src/api/machines.ts:74 (useIssueMachines)", fix: "refetchInterval",
      accept: "Nhãn đổi khi máy mất liên lạc" },
  ],
  decision_items: [
    { id: "Q-01", question: "Mockup là bản rút gọn hay phải vẽ đủ cột?", owner: "owner (Đại Ca)", kind: "PRODUCT",
      merge_blocking: false, required_evidence: "Quyết định của owner", findings: ["F-01", "F-02"] },
    { id: "Q-03", question: "Ô máy ghi 'không còn trong danh sách' khi bị lọc: sửa trong MR này?", owner: "product owner Crew",
      kind: "PRODUCT", merge_blocking: false, required_evidence: "Ghi vào docs", findings: ["F-02"] },
    { id: "Q-04", question: "Trạng thái online/offline có cần tự làm mới?", owner: "product owner Crew", kind: "PRODUCT",
      merge_blocking: false, required_evidence: "Ghi vào docs", findings: [] },
  ],
};

const stored = (raw: Record<string, unknown>): BugFindingFinding => ({
  id: raw.id as string, rule: (raw.rule as string) ?? null, title: raw.title as string, severity: raw.severity as string,
  certainty: (raw.certainty as string) ?? null, status: raw.status as string, action: null,
  mr_relation: (raw.mr_relation as string) ?? null, location: (raw.location as string) ?? null, fix: (raw.fix as string) ?? null,
  accept: (raw.accept as string) ?? null, question: null,
});

describe("decision_items của Bug Finding", () => {
  it("chỉ giữ id, question, findings của từng mục", () => {
    expect(parseDecisionItems(RESULT.decision_items)).toEqual([
      { id: "Q-01", question: "Mockup là bản rút gọn hay phải vẽ đủ cột?", findings: ["F-01", "F-02"] },
      { id: "Q-03", question: "Ô máy ghi 'không còn trong danh sách' khi bị lọc: sửa trong MR này?", findings: ["F-02"] },
      { id: "Q-04", question: "Trạng thái online/offline có cần tự làm mới?", findings: [] },
    ]);
  });

  it("finding có tên trong mục nhận câu hỏi kèm id mục; nhiều mục thì nối từng dòng; finding khác giữ nguyên", () => {
    const items = parseDecisionItems(RESULT.decision_items);
    if (typeof items === "string") throw new Error(items);
    const [f1, f2, f4] = applyDecisionItems(RESULT.findings.map(stored), items);
    expect(f1!.question).toBe("Q-01: Mockup là bản rút gọn hay phải vẽ đủ cột?");
    expect(f2!.question).toBe("Q-01: Mockup là bản rút gọn hay phải vẽ đủ cột?\nQ-03: Ô máy ghi 'không còn trong danh sách' khi bị lọc: sửa trong MR này?");
    expect(f4).toEqual(stored(RESULT.findings[2]!));
    expect(f4!.question).toBeNull();
    // Không bịa `action`: thiếu trong kết quả thì vẫn null.
    expect([f1, f2, f4].map((f) => f!.action)).toEqual([null, null, null]);
  });

  it("question sẵn có của finding đứng trước câu của mục", () => {
    const own = { ...stored(RESULT.findings[0]!), question: "Có cần giữ cột Nhãn?" };
    const [out] = applyDecisionItems([own], [{ id: "Q-01", question: "Rút gọn hay đủ cột?", findings: ["F-01"] }]);
    expect(out!.question).toBe("Có cần giữ cột Nhãn?\nQ-01: Rút gọn hay đủ cột?");
  });

  it("không có mục thì trả đúng mảng cũ", () => {
    const findings = RESULT.findings.map(stored);
    expect(applyDecisionItems(findings, [])).toBe(findings);
  });

  it("mục sai dạng bị bỏ riêng, findings không phải mảng chuỗi coi như rỗng; không phải mảng thì lỗi", () => {
    expect(parseDecisionItems([
      null, "Q-09", { id: "Q-05" }, { question: "thiếu id" }, { id: " ", question: "id rỗng" },
      { id: "Q-06", question: "  Hỏi?  ", findings: "F-01" },
      { id: "Q-07", question: "Hỏi tiếp?", findings: ["F-01", 3, "", " F-02 "] },
    ])).toEqual([
      { id: "Q-06", question: "Hỏi?", findings: [] },
      { id: "Q-07", question: "Hỏi tiếp?", findings: ["F-01", "F-02"] },
    ]);
    expect(parseDecisionItems({})).toMatch(/decisionItems phải là mảng/);
    expect(parseDecisionItems(Array.from({ length: 201 }, () => ({})))).toMatch(/decisionItems phải là mảng/);
  });
});
