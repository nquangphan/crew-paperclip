import { describe, expect, it } from "vitest";
import { latestCrewPr } from "../bug-finding/enqueue.js";

const INTEGRATOR = "30000000-0000-4000-8000-000000000003";
const OTHER = "30000000-0000-4000-8000-000000000004";
const HEAD = "a".repeat(40);
const crewPr = (pr: string, authorAgentId = INTEGRATOR, createdAt = "2026-11-05T01:00:00.000Z") =>
  ({ authorAgentId, body: `crew-pr sha=${HEAD} pr=${pr}`, createdAt });

describe("latestCrewPr: head PR/MR từ crew-pr của integrator", () => {
  it.each([
    ["https://github.com/nquangphan/my-crew/pull/87", "github", 87],
    ["https://gitlab.com/acme/shop-app/-/merge_requests/12", "gitlab", 12],
    ["https://gitlab.qasoftsolution.com/nail/business-app/-/merge_requests/5", "gitlab", 5],
    ["https://gitlab.qasoftsolution.com/nail/mobile/apps/business-app/-/merge_requests/1042", "gitlab", 1042],
    ["https://git.corp.example:8443/team/sub.group/repo_1/-/merge_requests/3", "gitlab", 3],
  ])("nhận %s → %s #%i", (pr, provider, prNumber) => {
    expect(latestCrewPr([crewPr(pr)], INTEGRATOR)).toEqual({ sha: HEAD, prUrl: pr, prNumber, provider });
  });

  it.each([
    "https://gitlab.com/acme/-/merge_requests/12", // thiếu namespace: project GitLab luôn có group/repo
    "https://gitlab.com/acme/shop-app/merge_requests/12", // thiếu /-/
    "http://gitlab.com/acme/shop-app/-/merge_requests/12",
    "https://gitlab.com/acme/shop-app/-/merge_requests/0",
    "https://gitlab.com/acme/shop-app/-/merge_requests/12/diffs",
    "https://gitlab.com/acme/shop-app/-/merge_requests/12?tab=diffs",
    "https://gitlab.com/acme/-/shop-app/-/merge_requests/12",
    "https://gitlab.com/acme/../shop-app/-/merge_requests/12",
    "https://github.com/acme/shop-app/-/merge_requests/12", // github.com không có MR
    "https://github.com/acme/shop-app/pull/87/files",
    "https://gitlab.com/acme/shop-app/-/issues/12",
    "git@gitlab.com:acme/shop-app.git",
  ])("không nhận URL lạ %s", (pr) => {
    expect(latestCrewPr([crewPr(pr)], INTEGRATOR)).toBeNull();
  });

  it("lấy crew-pr mới nhất có URL hợp lệ của integrator; bỏ comment của agent khác", () => {
    const mr = "https://gitlab.com/acme/shop-app/-/merge_requests/13";
    const comments = [
      crewPr("https://gitlab.com/acme/shop-app/-/merge_requests/12", INTEGRATOR, "2026-11-05T01:00:00.000Z"),
      crewPr(mr, INTEGRATOR, "2026-11-05T02:00:00.000Z"),
      crewPr("https://gitlab.com/acme/shop-app/-/merge_requests/99", OTHER, "2026-11-05T03:00:00.000Z"),
      crewPr("https://gitlab.com/acme/shop-app/-/issues/1", INTEGRATOR, "2026-11-05T04:00:00.000Z"),
    ];
    expect(latestCrewPr(comments, INTEGRATOR)).toEqual({ sha: HEAD, prUrl: mr, prNumber: 13, provider: "gitlab" });
  });
});
