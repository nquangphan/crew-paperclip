import { expect, it } from "vitest";
import { parseCrewDocsCheck } from "../shared/markers.js";
import { escapeLike } from "../docs/data.js";
import { validateDocsSnapshot } from "../docs/webhook.js";

it("parses only a valid first-line docs check", () => {
  const sha = "a".repeat(40);
  expect(parseCrewDocsCheck(`crew-docs-check commit=${sha} range=${"b".repeat(40)}..${sha} exit=0\nextra`))
    .toEqual({ commit: sha, range: `${"b".repeat(40)}..${sha}`, exit: 0 });
  expect(parseCrewDocsCheck(`note\ncrew-docs-check commit=${sha} range=x..${sha} exit=0`)).toBeNull();
});
it("escapes SQL LIKE wildcards", () => {
  expect(escapeLike("a%_\\b")).toBe("a\\%\\_\\\\b");
});
it("rejects docs outside docs/ and arbitrary dropped reasons", () => {
  const base = { version: 1, companyId: "10000000-0000-4000-8000-000000000001", machineId: "50000000-0000-4000-8000-000000000001", projectId: "20000000-0000-4000-8000-000000000001", repo: "repo", commit: "a".repeat(40), auditState: "verified", checkExit: 0, pages: [], links: [], dropped: [] };
  expect(validateDocsSnapshot(base).projectId).toBe(base.projectId);
  expect(() => validateDocsSnapshot({ ...base, pages: [{ path: "secrets.md", title: "x", parentPath: null, text: "x", sha256: "b".repeat(64) }] })).toThrow();
  expect(() => validateDocsSnapshot({ ...base, dropped: [{ path: "docs/a.md", reason: "other" }] })).toThrow();
});
