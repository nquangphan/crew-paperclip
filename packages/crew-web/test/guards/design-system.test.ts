import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

export const LAYOUT_CLASSES =
  /^(?:(?:sm|md|lg|xl):)?(?:flex|inline-flex|grid|hidden|block|contents|flex-(?:row|col|wrap|1)|grow|shrink-0|items-\w+|justify-\w+|self-\w+|gap-(?:[0-6]|8)|col-span-\d+|row-span-\d+|grid-cols-\d+|min-w-0|w-full|h-full|truncate|overflow-(?:auto|hidden))$/;

const BANNED_IMPORT = /from ['"](radix-ui|@base-ui\/react|class-variance-authority|lucide-react)['"]/;
const CLONE_HEADER = /^\/\/ (clone: ui\/src\/components\/ui\/[\w-]+\.tsx @ v2026\.1005\.0|crew: tự dựng)/;

const read = (f: string) => readFileSync(f, 'utf8');
const list = (pattern: string) => globSync(pattern, { cwd: process.cwd() }).sort();

export const screenFiles = () => list('src/{features,app}/**/*.tsx');
export const nonDsFiles = () => list('src/**/*.{ts,tsx}').filter((f) => !f.startsWith('src/ds/'));

/** File dùng style inline. */
export function scanStyle(files: string[]): string[] {
  return files.filter((f) => /\sstyle=\{/.test(read(f)));
}

/** Class ngoài LAYOUT_CLASSES và className động ngoài cn(). */
export function scanClasses(files: string[]): string[] {
  const bad: string[] = [];
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/className=["'`]([^"'`]*)["'`]/g)) {
      for (const cls of m[1].split(/\s+/).filter(Boolean)) {
        if (!LAYOUT_CLASSES.test(cls)) bad.push(`${f}: ${cls}`);
      }
    }
    if (/className=\{(?!cn\()/.test(text)) bad.push(`${f}: className động ngoài ds`);
  }
  return bad;
}

/** File import thư viện UI thô. */
export function scanImports(files: string[]): string[] {
  return files.filter((f) => BANNED_IMPORT.test(read(f)));
}

/** Component thiếu dòng ghi nguồn. */
export function scanCloneHeaders(files: string[]): string[] {
  return files.filter((f) => !CLONE_HEADER.test(read(f)));
}

const FIXTURE = 'test/guards/__fixtures__/bad-screen.tsx';

describe('design system', () => {
  it('màn hình không dùng style inline', () => {
    expect(scanStyle(screenFiles())).toEqual([]);
  });
  it('className ngoài ds chỉ dùng class bố cục', () => {
    expect(scanClasses(nonDsFiles())).toEqual([]);
  });
  it('ngoài ds không import thư viện UI thô', () => {
    expect(scanImports(nonDsFiles())).toEqual([]);
  });
  it('mỗi component clone ghi nguồn', () => {
    const files = list('src/ds/components/*.tsx');
    expect(files.length).toBeGreaterThanOrEqual(27);
    expect(scanCloneHeaders(files)).toEqual([]);
  });
  it('bộ quét bắt được fixture xấu (không xanh vì quét rỗng)', () => {
    expect(scanStyle([FIXTURE])).toEqual([FIXTURE]);
    expect(scanClasses([FIXTURE])).toContain(`${FIXTURE}: text-red-500`);
    expect(scanImports([FIXTURE])).toEqual([FIXTURE]);
    expect(scanCloneHeaders([FIXTURE])).toEqual([FIXTURE]);
  });
  it('bộ quét thật có file để quét', () => {
    expect(nonDsFiles().length).toBeGreaterThan(0);
    expect(list('src/ds/components/*.tsx').length).toBeGreaterThan(0);
  });
});
