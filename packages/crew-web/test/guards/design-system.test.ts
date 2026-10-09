import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'ts-api';
import { describe, expect, it } from 'vitest';

export const LAYOUT_CLASSES =
  /^(?:(?:sm|md|lg|xl):)?(?:flex|inline-flex|grid|hidden|block|contents|flex-(?:row|col|wrap|1)|grow|shrink-0|items-\w+|justify-\w+|self-\w+|gap-(?:[0-6]|8)|col-span-\d+|row-span-\d+|grid-cols-\d+|min-w-0|w-full|h-full|truncate|overflow-(?:auto|hidden))$/;

/** Thư viện UI thô (khớp theo tiền tố, gồm cả gói con như `@radix-ui/react-dialog`). */
const BANNED_IMPORT =
  /(?:from|import)\s*\(?\s*['"]((?:radix-ui|@radix-ui\/|@base-ui\/|class-variance-authority|lucide-react|cmdk|@xyflow\/|vaul)[^'"]*)['"]/g;
const CLONE_HEADER = /^\/\/ (clone: ui\/src\/components\/ui\/[\w-]+\.tsx @ v2026\.1005\.0|crew: tự dựng)/;

const read = (f: string) => readFileSync(f, 'utf8');
const list = (pattern: string) => globSync(pattern, { cwd: process.cwd() }).sort();

export const screenFiles = () => list('src/{features,app}/**/*.tsx');
export const nonDsFiles = () => list('src/**/*.{ts,tsx}').filter((f) => !f.startsWith('src/ds/'));

/** File dùng style inline. */
export function scanStyle(files: string[]): string[] {
  return files.filter((f) => /\sstyle=\{/.test(read(f)));
}

/** Chuỗi literal nằm trong đối số của một lời gọi `cn(...)` (kể cả nhánh `a ? 'x' : 'y'`, `ok && 'x'`). */
function cnStrings(f: string): string[] {
  const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text);
      for (const span of node.templateSpans) out.push(span.literal.text);
    }
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'cn') {
      for (const arg of node.arguments) collect(arg);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Class ngoài LAYOUT_CLASSES (cả trong `cn(...)`) và className động ngoài cn(). */
export function scanClasses(files: string[]): string[] {
  const bad: string[] = [];
  for (const f of files) {
    const text = read(f);
    const literals = [...text.matchAll(/className=["'`]([^"'`]*)["'`]/g)].map((m) => m[1]).concat(cnStrings(f));
    for (const lit of literals) {
      for (const cls of lit.split(/\s+/).filter(Boolean)) {
        if (!LAYOUT_CLASSES.test(cls)) bad.push(`${f}: ${cls}`);
      }
    }
    if (/className=\{(?!cn\()/.test(text)) bad.push(`${f}: className động ngoài ds`);
  }
  return bad;
}

/** Import thư viện UI thô, dạng `<file>: <module>`. */
export function scanImports(files: string[]): string[] {
  return files.flatMap((f) => [...read(f).matchAll(BANNED_IMPORT)].map((m) => `${f}: ${m[1]}`));
}

/** Module mà `file` import tĩnh (bỏ `import()` động và `import type`). */
function staticImports(file: string): string[] {
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  for (const st of sf.statements) {
    if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier) {
      const typeOnly = ts.isImportDeclaration(st) ? st.importClause?.isTypeOnly : st.isTypeOnly;
      if (!typeOnly && ts.isStringLiteral(st.moduleSpecifier)) out.push(st.moduleSpecifier.text);
    }
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join('src', spec.slice(2))
    : spec.startsWith('.')
      ? join(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (/\.tsx?$/.test(c) && existsSync(c)) return normalize(c);
  }
  return null;
}

/** Gói ngoài mà `entry` kéo vào qua chuỗi import tĩnh (tức nằm chung chunk khởi đầu). */
export function staticPackages(entry: string): Set<string> {
  const seen = new Set<string>();
  const pkgs = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of staticImports(file)) {
      const local = resolveLocal(file, spec);
      if (local) walk(local);
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) pkgs.add(spec);
    }
  };
  walk(entry);
  return pkgs;
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
    expect(scanClasses([FIXTURE])).toContain(`${FIXTURE}: text-blue-500`);
    expect(scanClasses([FIXTURE])).toContain(`${FIXTURE}: bg-red-50`);
    expect(scanClasses([FIXTURE])).not.toContain(`${FIXTURE}: gap-2`);
    expect(scanImports([FIXTURE])).toEqual([
      `${FIXTURE}: @radix-ui/react-dialog`,
      `${FIXTURE}: @xyflow/react`,
      `${FIXTURE}: cmdk`,
      `${FIXTURE}: lucide-react`,
    ]);
    expect(scanCloneHeaders([FIXTURE])).toEqual([FIXTURE]);
  });
  it('cổng @/ds không kéo trình render markdown vào chunk khởi đầu (markdown tải lười)', () => {
    const pkgs = [...staticPackages('src/ds/index.ts')];
    expect(pkgs).toContain('react');
    expect(pkgs.filter((p) => /^(react-markdown|remark-|rehype-|micromark)/.test(p))).toEqual([]);
  });
  it('bộ quét thật có file để quét', () => {
    expect(nonDsFiles().length).toBeGreaterThan(0);
    expect(list('src/ds/components/*.tsx').length).toBeGreaterThan(0);
  });
});
