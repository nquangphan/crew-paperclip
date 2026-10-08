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
