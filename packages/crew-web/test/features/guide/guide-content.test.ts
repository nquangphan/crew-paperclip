import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/app/routes-util';
import { internalLinks, markdownImages, parseGuide } from '@/features/guide/guide-parse';
import { GUIDE_SHOTS } from '@/features/guide/shots';

const read = (name: string) => readFileSync(`src/features/guide/content/${name}`, 'utf8');
const DOCS = { vi: read('huong-dan.vi.md'), en: read('guide.en.md') } as const;

// Route theo I5 của plan: các trang gốc của sidebar cộng hai wizard.
const ROUTES = new Set([...NAV_ITEMS.map((n) => n.segment), 'projects/new', 'agents/new']);

describe('parseGuide', () => {
  it('tách tiêu đề, phần mở đầu và các mục ##', () => {
    const doc = parseGuide('# T\n\nmở đầu\n\n## A\n\nmột\n\n{{shot:x}}\n\ntiếp\n\n## B\n\n{{missing}}\n');
    expect(doc.title).toBe('T');
    expect(doc.intro).toEqual([{ type: 'md', text: 'mở đầu' }]);
    expect(doc.sections.map((s) => s.title)).toEqual(['A', 'B']);
    expect(doc.sections[0].blocks).toEqual([
      { type: 'md', text: 'một' },
      { type: 'shot', id: 'x' },
      { type: 'md', text: 'tiếp' },
    ]);
    expect(doc.sections[1].blocks).toEqual([{ type: 'missing' }]);
  });
  it('bỏ qua ## nằm trong khối code', () => {
    const doc = parseGuide('# T\n\n## A\n\n```\n## B\n{{missing}}\n```\n');
    expect(doc.sections.map((s) => s.title)).toEqual(['A']);
    expect(doc.sections[0].blocks).toHaveLength(1);
    expect(doc.sections[0].blocks[0].type).toBe('md');
  });
  it('markdownImages và internalLinks trích đúng', () => {
    const md = '![a](img/a.png) [x](/projects) [y](https://e.com) [z](/agents/new?fix=1) [w](#top)';
    expect(markdownImages(md)).toEqual(['img/a.png']);
    expect(internalLinks(md)).toEqual(['/projects', '/agents/new?fix=1']);
  });
});

describe.each(['vi', 'en'] as const)('nội dung hướng dẫn %s', (lang) => {
  const doc = parseGuide(DOCS[lang]);
  it('có tiêu đề, phần mở đầu và ít nhất 10 mục', () => {
    expect(doc.title.length).toBeGreaterThan(5);
    expect(doc.intro.length).toBeGreaterThan(0);
    expect(doc.sections.length).toBeGreaterThanOrEqual(10);
  });
  it('mọi ảnh viết thẳng trong markdown có file trong img/', () => {
    for (const src of markdownImages(DOCS[lang])) {
      expect(src.startsWith('img/'), src).toBe(true);
      expect(existsSync(`src/features/guide/${src}`), src).toBe(true);
    }
  });
  it('mọi link nội bộ khớp một route đã gom', () => {
    const links = internalLinks(DOCS[lang]);
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      const path = link.replace(/^\//, '').split(/[?#]/)[0];
      expect(ROUTES.has(path), link).toBe(true);
    }
  });
  it('mọi chỗ ảnh {{shot:id}} có trong GUIDE_SHOTS', () => {
    const ids = new Set(GUIDE_SHOTS.map((s) => s.id));
    for (const block of [...doc.intro, ...doc.sections.flatMap((s) => s.blocks)]) {
      if (block.type === 'shot') expect(ids.has(block.id), block.id).toBe(true);
    }
  });
  it('có đúng một chỗ {{missing}}', () => {
    const all = [...doc.intro, ...doc.sections.flatMap((s) => s.blocks)];
    expect(all.filter((b) => b.type === 'missing')).toHaveLength(1);
  });
});

describe.each([
  ['vi', ['Ép Done', 'Xóa skill', 'Đổi nguồn', 'Gỡ project', 'Gỡ agent', 'Đã gỡ']],
  ['en', ['Force Done', 'Delete skill', 'Change source', 'Remove project', 'Remove agent', 'Removed']],
] as const)('mục mới R3X (%s)', (lang, words) => {
  it('nói về Ép Done, sửa/xóa skill, gỡ agent/project', () => {
    for (const w of words) expect(DOCS[lang], w).toContain(w);
  });
  it('không còn câu khẳng định thiếu các nút đã làm', () => {
    const banned =
      lang === 'vi'
        ? [/không thể tự đặt trạng thái thành "Hoàn thành"/, /không có nút gỡ/i, /không có nút xóa skill/i]
        : [/cannot set the status to "Done" by hand\. The reason/, /no remove button/i, /no delete skill button/i];
    for (const re of banned) expect(DOCS[lang]).not.toMatch(re);
  });
});

describe('hai ngôn ngữ cùng cấu trúc', () => {
  const flat = (lang: 'vi' | 'en') => {
    const doc = parseGuide(DOCS[lang]);
    return doc.sections.map((s) => s.blocks.filter((b) => b.type !== 'md').map((b) => JSON.stringify(b)));
  };
  it('cùng số mục và cùng thứ tự chỗ ảnh, chỗ danh sách', () => {
    expect(flat('en')).toEqual(flat('vi'));
  });
  it('cùng tập link nội bộ', () => {
    expect(internalLinks(DOCS.en).sort()).toEqual(internalLinks(DOCS.vi).sort());
  });
});

describe('GUIDE_SHOTS', () => {
  it('id không trùng, route là trang gốc đã biết, mọi shot dùng trong ít nhất một bản', () => {
    const ids = GUIDE_SHOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of GUIDE_SHOTS) {
      expect(ROUTES.has(s.route.replace(/^\//, '').split('?')[0]), s.route).toBe(true);
      expect(DOCS.vi).toContain(`{{shot:${s.id}}}`);
      expect(DOCS.en).toContain(`{{shot:${s.id}}}`);
    }
  });
});
