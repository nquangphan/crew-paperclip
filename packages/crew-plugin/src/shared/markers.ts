const BUNDLE = /^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$/m;
const FIX = /^crew-fix base=([0-9a-f]{40})$/m;
const COMMIT = /^crew-commit sha=([0-9a-f]{40})(?:\s|$)/m;

export function parseCrewBundle(description: string | null): { id: string; seq: number } | null {
  const match = description?.match(BUNDLE);
  return match ? { id: match[1]!, seq: Number(match[2]) } : null;
}

export function parseCrewFixBase(description: string | null): string | null {
  return description?.match(FIX)?.[1] ?? null;
}

export function parseCrewCommit(body: string): string | null {
  return body.match(COMMIT)?.[1] ?? null;
}

export function isCrewResearch(description: string | null): boolean {
  return /^crew-kind research$/m.test(description ?? "");
}

const DOCS_CHECK = /^crew-docs-check commit=([0-9a-f]{40}) range=([0-9a-f]{7,40}\.\.[0-9a-f]{40}) exit=([0-3])$/;
export function parseCrewDocsCheck(body: string): { commit: string; range: string; exit: number } | null {
  const match = DOCS_CHECK.exec(body.split("\n", 1)[0]?.trim() ?? "");
  if (!match || !match[2]?.endsWith(match[1]!)) return null;
  return { commit: match[1]!, range: match[2]!, exit: Number(match[3]) };
}
