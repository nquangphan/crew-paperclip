import type { PrProvider } from "./types.js";

/**
 * Số PR/MR: 1 tới 10 chữ số, không số 0 đầu; luôn là số nguyên an toàn khi đổi sang `Number` (số dài hơn bị làm tròn
 * mà vẫn bằng nhau sau khi đổi, nên không được nhận).
 */
const PR_NUMBER = String.raw`([1-9][0-9]{0,9})`;
/** URL pull request GitHub, giống `GITHUB_PR_URL` của server (`server/src/crew/issue-policy.ts`). */
export const GITHUB_PR_URL = new RegExp(String.raw`^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/${PR_NUMBER}$`);
/**
 * URL merge request GitLab (gitlab.com hoặc tự host, có thể kèm cổng): `https://<host>/<group>[/<subgroup>…]/<repo>/-/merge_requests/<iid>`.
 * Mỗi đoạn đường dẫn theo luật path của GitLab (chữ, số, `_`, `-`, `.`; không bắt đầu bằng `-` hay `.`), nên `/-/` chỉ là dấu
 * tách của GitLab. github.com (mọi kiểu hoa thường) không có MR.
 */
export const GITLAB_MR_URL = new RegExp(
  String.raw`^https:\/\/(?![Gg][Ii][Tt][Hh][Uu][Bb]\.[Cc][Oo][Mm][:/])[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*){2,}\/-\/merge_requests\/${PR_NUMBER}$`,
);

/** Provider và số PR/MR (`iid` với GitLab) của URL `crew-pr`; URL lạ trả `null`. Web dùng chung qua `shared/pr-url`. */
export function parsePrUrl(url: string): { provider: PrProvider; number: number } | null {
  const github = GITHUB_PR_URL.exec(url);
  const gitlab = github ? null : GITLAB_MR_URL.exec(url);
  const provider: PrProvider | null = github ? "github" : gitlab ? "gitlab" : null;
  const number = Number((github ?? gitlab)?.[1]);
  return provider && Number.isSafeInteger(number) ? { provider, number } : null;
}
