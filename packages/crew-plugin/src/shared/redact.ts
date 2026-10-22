/**
 * Che giá trị secret trong text trước khi ghi vào bảng plugin (message lỗi của run hỏng). Bảng luật chép nguyên từ
 * `redactSecrets` của jev-use@0.8.0 (`src/redact.ts`, MIT License, Copyright (c) 2026 shitianfang), để plugin không phải
 * thêm dependency. Server dùng đúng hàm gốc (bản vendored ở `server/src/crew/vendor/jev-use-0.8.0.ts`); test giữ hai
 * bản cho cùng kết quả.
 */

export const REDACTED = "[redacted]";

interface Rule {
  name: string;
  /** Nhóm 1 giữ nguyên, nhóm 2 là secret. */
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    name: "password in a URL",
    pattern: /(\b[a-z][\w+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(?=@)/gi,
  },
  {
    name: "auth header",
    pattern:
      /((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)"?\s*:\s*"?(?:(?:bearer|basic|token|digest)\s+)?)([^"'\n\\]+)/gi,
  },
  {
    name: "credential flag",
    pattern:
      /((?:^|\s)--?[\w-]*(?:pass(?:wd|word)?|token|api-?key|secret|auth)[\w-]*[ =]+"?)([^\s"'\\]+)/gi,
  },
  {
    name: "user:password flag",
    pattern: /((?:^|\s)(?:-u|--user)[ =]+"?[^\s:"']*:)([^\s"'\\]+)/g,
  },
  {
    name: "secret-looking name = value",
    pattern:
      /(["']?[\w.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)["']?\s*[:=]\s*"?)([^\s"',;}\\]+)/gi,
  },
  { name: "OpenAI-style key", pattern: /(sk-(?:proj-|ant-|live-|test-)?)([A-Za-z0-9_-]{16,})/g },
  { name: "GitHub token", pattern: /(gh[pousr]_|github_pat_)([A-Za-z0-9_]{20,})/g },
  { name: "Slack token", pattern: /(xox[abdeporsu]-)([A-Za-z0-9-]{10,})/g },
  { name: "AWS access key id", pattern: /(AKIA)([0-9A-Z]{16})\b/g },
  { name: "Google API key", pattern: /(AIza)([\w-]{30,})/g },
  { name: "JSON web token", pattern: /(eyJ)([\w-]{8,}\.[\w-]{8,}\.[\w-]+)/g },
];


/** Giá trị chỉ là tham chiếu tới secret (`$TOKEN`, `${TOKEN}`, `%TOKEN%`, `$(pass show …)`): giữ nguyên. */
function isReference(value: string): boolean {
  return /^(?:\$\{?\w+\}?|%\w+%|\$\(.*\))$/.test(value);
}

export function redactSecrets(text: string): string {
  return RULES.reduce(
    (redacted, rule) =>
      redacted.replace(rule.pattern, (match, keep: string, secret: string) => (isReference(secret) ? match : keep + REDACTED)),
    text,
  );
}
