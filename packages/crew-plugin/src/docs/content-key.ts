import { createHash } from "node:crypto";

export interface ContentKeyInput {
  format: 1 | 2;
  commit: string;
  auditState: string;
  manifestSha256: string | null;
  pages: ReadonlyArray<{ path: string; sha256: string }>;
  dropped: ReadonlyArray<{ path: string; reason: string }>;
}

/** Identity of a snapshot's content: equal keys mean a resend of the same snapshot. */
export function computeContentKey(input: ContentKeyInput): string {
  const pages = [...input.pages]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((page) => `${page.path}\u0000${page.sha256}`);
  const dropped = input.dropped.map((item) => `${item.path}\u0000${item.reason}`).sort();
  return createHash("sha256")
    .update(JSON.stringify([input.format, input.commit, input.auditState, input.manifestSha256, pages, dropped]))
    .digest("hex");
}
