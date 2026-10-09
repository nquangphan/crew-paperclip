// Secret patterns copied from the 2P Crew repo, packages/docs-kit/src/secret-scan.ts (SECRET_RULES, gitleaks-derived).
// The documentation-placeholder allow list is dropped on purpose: an error text shown on the web is masked even
// when the token looks like an example.

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g,
  /aws.{0,20}?secret.{0,20}?['"=:\s]\s*['"]?[A-Za-z0-9/+=]{40}\b/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g,
  /\bgithub_pat_[0-9A-Za-z_]{82}\b/g,
  /\bglpat-[0-9A-Za-z_-]{20}\b/g,
  /\bxox[abposr]-[0-9A-Za-z-]{10,}/g,
  /hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9+/]{20,}/g,
  /\b(?:sk|rk)_(?:test|live|prod)_[0-9A-Za-z]{10,99}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/g,
  /\bsk-ant-(?:api03|admin01)-[A-Za-z0-9_-]{80,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bcrew_mt_[A-Za-z0-9_-]{40,}/g,
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequences are what is removed
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// Control characters except tab and newline, which keep multi-line git output readable.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
/**
 * `scheme://user:pass@` in a URL (git prints a remote with its credentials to stderr). The userinfo runs to the LAST
 * `@` before the first `/`, since a password may itself contain `@`. scp-style `git@host:path` has no `://` and stays.
 */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s'"]*@/gi;
export const REDACTED = "[ĐÃ CHE]";

/** Masks the userinfo part of every URL in the text. */
export function maskUrlUserinfo(text: string): string {
  return text.replace(URL_USERINFO, `$1${REDACTED}@`);
}
export const JOB_ERROR_MAX = 300;

/** Makes an error text from a Mac safe to store and show: no terminal codes, no credentials, at most 300 characters. */
export function sanitizeJobError(text: string): string {
  let clean = maskUrlUserinfo(text.replace(ANSI, "").replace(CONTROL, ""));
  for (const pattern of SECRET_PATTERNS) clean = clean.replace(pattern, REDACTED);
  const chars = Array.from(clean.trim());
  return chars.length > JOB_ERROR_MAX ? chars.slice(0, JOB_ERROR_MAX).join("") : chars.join("");
}
