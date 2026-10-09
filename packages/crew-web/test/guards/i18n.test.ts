import { globSync, readFileSync } from 'node:fs';
import ts from 'ts-api';
import { describe, expect, it } from 'vitest';

const ALLOWED = new Set(['Crew', '2P Crew', 'Paperclip', 'Claude', 'VI', 'EN']);
const TEXT_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'confirmLabel']);
const HAS_LETTER = /\p{L}/u;
const FIXTURE = 'test/guards/__fixtures__/hardcoded.tsx';

const list = (pattern: string) => globSync(pattern, { cwd: process.cwd() }).sort();

/** Làm phẳng object lồng thành tập khóa a.b.c. */
export function flatKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

/** Mỗi thư mục locales phải có vi.json và en.json cùng tập khóa. */
export function scanKeyParity(): string[] {
  const bad: string[] = [];
  const dirs = new Set(list('src/**/locales/*.json').map((f) => f.replace(/\/[^/]+$/, '')));
  for (const dir of dirs) {
    const keys = (lang: string) => {
      try {
        return new Set(flatKeys(JSON.parse(readFileSync(`${dir}/${lang}.json`, 'utf8'))));
      } catch {
        return null;
      }
    };
    const vi = keys('vi');
    const en = keys('en');
    if (!vi || !en) {
      bad.push(`${dir}: thiếu vi.json hoặc en.json`);
      continue;
    }
    for (const k of vi) if (!en.has(k)) bad.push(`${dir}: en thiếu ${k}`);
    for (const k of en) if (!vi.has(k)) bad.push(`${dir}: vi thiếu ${k}`);
  }
  return bad;
}

/** Chữ cứng trong JSX: JsxText có chữ, hoặc thuộc tính văn bản là chuỗi literal có chữ. */
export function scanHardcodedText(files: string[]): string[] {
  const bad: string[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const text = node.getText(sf).trim();
        if (text && HAS_LETTER.test(text) && !ALLOWED.has(text)) bad.push(`${f}: text "${text}"`);
      } else if (ts.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText(sf))) {
        const init = node.initializer;
        if (init && ts.isStringLiteral(init) && HAS_LETTER.test(init.text) && !ALLOWED.has(init.text)) {
          bad.push(`${f}: ${node.name.getText(sf)}="${init.text}"`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return bad;
}

export const screenFiles = () => list('src/{features,app}/**/*.tsx').concat(list('src/ds/widgets/**/*.tsx'));

describe('i18n', () => {
  it('vi.json và en.json cùng tập khóa ở mọi thư mục locales', () => {
    expect(scanKeyParity()).toEqual([]);
  });
  it('có ít nhất một cặp locale để so', () => {
    expect(list('src/i18n/locales/*.json').length).toBe(2);
  });
  it('không có chữ cứng trong feature, app, widget', () => {
    expect(scanHardcodedText(screenFiles())).toEqual([]);
  });
  it('bộ quét bắt được fixture chữ cứng (không xanh vì quét rỗng)', () => {
    expect(scanHardcodedText([FIXTURE])).toEqual([`${FIXTURE}: text "Xin chào"`, `${FIXTURE}: placeholder="Tìm"`]);
  });
  it('bộ quét widget thật có file để quét', () => {
    expect(list('src/ds/widgets/*.tsx').length).toBeGreaterThanOrEqual(13);
  });
});
