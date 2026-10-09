import { describe, expect, it } from "vitest";
import { docsState } from "../docs/status.js";
const snap = (auditState: string) => ({ commit: "a".repeat(40), auditState });
const pushed = { sha: "b".repeat(40), at: "2026-10-10T01:00:00.000Z" };
describe("docsState", () => {
  it.each([
    [{ snapshot: null, latestPushed: null, pushedKnown: null }, "missing"],
    [{ snapshot: snap("verified"), latestPushed: pushed, pushedKnown: false }, "stale"],
    [{ snapshot: snap("invalid"), latestPushed: pushed, pushedKnown: false }, "stale"],
    [{ snapshot: snap("invalid"), latestPushed: pushed, pushedKnown: true }, "invalid"],
    [{ snapshot: snap("unverified"), latestPushed: null, pushedKnown: null }, "unverified"],
    [{ snapshot: snap("verified"), latestPushed: pushed, pushedKnown: null }, "current"],
    [{ snapshot: snap("verified"), latestPushed: pushed, pushedKnown: true }, "current"],
  ])("%o → %s", (input, state) => expect(docsState(input).state).toBe(state));
  it("stale reason names the pushed commit and Vietnam time", () => {
    expect(docsState({ snapshot: snap("verified"), latestPushed: pushed, pushedKnown: false }).reason)
      .toBe("Commit bbbbbbbbbbbb đã push lúc 08:00 10/10/2026 nhưng ảnh chụp docs chưa có commit này.");
  });
});
