import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/app/routes-util';
import {
  allBlocks,
  filterGuide,
  type GuideDoc,
  internalLinks,
  markdownImages,
  parseGuide,
} from '@/features/guide/guide-parse';
import { GUIDE_ROLES, type GuideRole } from '@/features/guide/guide-roles';
import { GUIDE_SHOTS, shotFiles } from '@/features/guide/shots';

const read = (name: string) => readFileSync(`src/features/guide/content/${name}`, 'utf8');
const DOCS = { vi: read('huong-dan.vi.md'), en: read('guide.en.md') } as const;
const LANGS = ['vi', 'en'] as const;
const IMG = 'src/features/guide/img';

// Route của các trang gốc ở sidebar cộng hai wizard.
const ROUTES = new Set([...NAV_ITEMS.map((n) => n.segment), 'projects/new', 'agents/new']);
// Mục khái niệm và tra cứu: không phải một việc trên màn hình nên không bắt có ảnh.
const NO_SHOT_SECTIONS = new Set(['what-is-crew']);
const REFERENCE_GROUP = 'reference';
// Phần chỉ owner làm: các vai trò khác không được thấy.
const OWNER_ONLY = [
  'approve',
  'force-done',
  'review-contributions',
  'add-project',
  'add-agent',
  'remove',
  'pair-machine',
  'unpair-machine',
  'members',
];

const sectionIds = (doc: GuideDoc) => doc.groups.flatMap((g) => g.sections.map((s) => s.id));
const anchors = (markdown: string) => [...markdown.matchAll(/(?<!!)\[[^\]]*\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]);

describe('parseGuide', () => {
  it('tách tiêu đề, mở đầu, nhóm, mục, vai trò và các dòng đặc biệt', () => {
    const doc = parseGuide(
      [
        '# T',
        '',
        'mở đầu',
        '',
        '## Nhóm A {#a}',
        '',
        '### Mục 1 {#one}',
        '',
        'một',
        '',
        '{{shot:x}}',
        '',
        '{{roles:owner,viewer}}',
        'riêng',
        '{{/roles}}',
        '',
        '### Mục 2 {#two roles=owner}',
        '',
        '{{diagram:d}}',
        '{{missing}}',
      ].join('\n'),
    );
    expect(doc.title).toBe('T');
    expect(doc.intro).toEqual([{ type: 'md', text: 'mở đầu' }]);
    expect(doc.groups).toHaveLength(1);
    expect(doc.groups[0]).toMatchObject({ id: 'a', title: 'Nhóm A' });
    const [one, two] = doc.groups[0].sections;
    expect(one).toMatchObject({ id: 'one', title: 'Mục 1' });
    expect(one.roles).toBeUndefined();
    expect(one.blocks).toEqual([
      { type: 'md', text: 'một' },
      { type: 'shot', id: 'x' },
      { type: 'md', text: 'riêng', roles: ['owner', 'viewer'] },
    ]);
    expect(two.roles).toEqual(['owner']);
    expect(two.blocks).toEqual([{ type: 'diagram', id: 'd' }, { type: 'missing' }]);
  });

  it('bỏ qua tiêu đề và dòng đặc biệt nằm trong khối code', () => {
    const doc = parseGuide('# T\n\n## G {#g}\n\n### A {#a}\n\n```\n## B\n{{missing}}\n{{roles:owner}}\n```\n');
    expect(sectionIds(doc)).toEqual(['a']);
    expect(doc.groups[0].sections[0].blocks).toHaveLength(1);
    expect(doc.groups[0].sections[0].blocks[0].type).toBe('md');
  });

  it('báo lỗi cú pháp thay vì lặng lẽ hiện sai', () => {
    expect(() => parseGuide('# T\n\n## G\n')).toThrow(/thiếu \{#id\}/);
    expect(() => parseGuide('# T\n\n## G {#g}\n\n### A {#a roles=boss}\n')).toThrow(/Vai trò không hợp lệ/);
    expect(() => parseGuide('# T\n\n## G {#g}\n\n### A {#a}\n\n{{roles:owner}}\nx\n')).toThrow(/Thiếu \{\{\/roles\}\}/);
    expect(() =>
      parseGuide('# T\n\n## G {#g}\n\n### A {#a}\n\n{{roles:owner}}\n{{roles:viewer}}\n{{/roles}}\n{{/roles}}\n'),
    ).toThrow(/lồng nhau/);
    expect(() => parseGuide('# T\n\n### A {#a}\n')).toThrow(/ngoài nhóm/);
  });

  it('markdownImages và internalLinks trích đúng', () => {
    const md = '![a](img/a.png) [x](/projects) [y](https://e.com) [z](/agents/new?fix=1) [w](#top)';
    expect(markdownImages(md)).toEqual(['img/a.png']);
    expect(internalLinks(md)).toEqual(['/projects', '/agents/new?fix=1']);
  });
});

describe('filterGuide', () => {
  const doc = parseGuide(
    '# T\n\n{{roles:viewer}}\nv\n{{/roles}}\n\n## G {#g}\n\n### A {#a}\n\nchung\n\n{{roles:owner}}\nchủ\n{{/roles}}\n\n## H {#h}\n\n### B {#b roles=owner}\n\nb\n',
  );
  it('owner thấy mục riêng và đoạn riêng của owner', () => {
    const owner = filterGuide(doc, 'owner');
    expect(sectionIds(owner)).toEqual(['a', 'b']);
    expect(owner.intro).toEqual([]);
    expect(owner.groups[0].sections[0].blocks.map((b) => (b.type === 'md' ? b.text : b.type))).toEqual([
      'chung',
      'chủ',
    ]);
  });
  it('vai trò khác không thấy, nhóm không còn mục thì bỏ', () => {
    const viewer = filterGuide(doc, 'viewer');
    expect(viewer.groups.map((g) => g.id)).toEqual(['g']);
    expect(viewer.groups[0].sections[0].blocks).toEqual([{ type: 'md', text: 'chung' }]);
    expect(viewer.intro).toEqual([{ type: 'md', text: 'v', roles: ['viewer'] }]);
  });
});

describe.each(LANGS)('nội dung hướng dẫn %s', (lang) => {
  const doc = parseGuide(DOCS[lang]);

  it('có tiêu đề, phần mở đầu, nhóm theo chủ đề và đủ mục', () => {
    expect(doc.title.length).toBeGreaterThan(5);
    expect(doc.intro.length).toBeGreaterThan(0);
    expect(doc.groups.length).toBeGreaterThanOrEqual(7);
    expect(sectionIds(doc).length).toBeGreaterThanOrEqual(30);
  });

  it('id nhóm và mục không trùng (neo #id duy nhất)', () => {
    const ids = [...doc.groups.map((g) => g.id), ...sectionIds(doc)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('không viết ảnh thẳng trong markdown: mọi hình đi qua {{shot}} hoặc {{diagram}}', () => {
    expect(markdownImages(DOCS[lang])).toEqual([]);
  });

  it('mọi link nội bộ khớp một route đã gom', () => {
    const links = internalLinks(DOCS[lang]);
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      const path = link.replace(/^\//, '').split(/[?#]/)[0];
      expect(ROUTES.has(path), link).toBe(true);
    }
  });

  it('mọi hình có trong GUIDE_SHOTS', () => {
    const ids = new Set(GUIDE_SHOTS.map((s) => s.id));
    for (const block of allBlocks(doc)) {
      if (block.type === 'shot' || block.type === 'diagram') expect(ids.has(block.id), block.id).toBe(true);
    }
  });

  it('có đúng một chỗ {{missing}}', () => {
    expect(allBlocks(doc).filter((b) => b.type === 'missing')).toHaveLength(1);
  });

  describe.each(GUIDE_ROLES)('bản của vai trò %s', (role) => {
    const view = filterGuide(doc, role);
    const visible = new Set([...view.groups.map((g) => g.id), ...sectionIds(view)]);

    it('mọi mục việc có ít nhất một hình, và file hình có thật', () => {
      for (const group of view.groups) {
        if (group.id === REFERENCE_GROUP) continue;
        for (const section of group.sections) {
          const media = section.blocks.filter((b) => b.type === 'shot' || b.type === 'diagram');
          if (!NO_SHOT_SECTIONS.has(section.id))
            expect(media.length, `${lang}/${role}/${section.id}`).toBeGreaterThan(0);
          for (const block of media) {
            if (block.type !== 'shot' && block.type !== 'diagram') continue;
            const found = shotFiles(block.id, role).some((f) => existsSync(`${IMG}/${lang}/${f}`));
            expect(found, `${lang}/${role}: thiếu ảnh ${block.id} (${shotFiles(block.id, role).join(', ')})`).toBe(
              true,
            );
          }
        }
      }
    });

    it('link #neo trong bản này trỏ tới mục có trong chính bản này', () => {
      const text = [...view.intro, ...view.groups.flatMap((g) => g.sections.flatMap((s) => s.blocks))]
        .map((b) => (b.type === 'md' ? b.text : ''))
        .join('\n');
      for (const id of anchors(text)) expect(visible.has(id), `${lang}/${role} → #${id}`).toBe(true);
    });

    it('phần chỉ owner làm chỉ nằm trong bản owner', () => {
      for (const id of OWNER_ONLY) expect(visible.has(id), `${role} ${id}`).toBe(role === 'owner');
    });
  });

  it('mỗi vai trò thấy đúng phần của mình', () => {
    const ids = (role: GuideRole) => new Set(sectionIds(filterGuide(doc, role)));
    // Owner thấy mọi mục trừ phần thao tác riêng của Phòng Marketing (xem bằng ô "Xem hướng dẫn của").
    const contributorOnly = ['send-request', 'send-comment', 'my-contributions'];
    expect([...ids('owner')].sort()).toEqual(
      sectionIds(doc)
        .filter((id) => !contributorOnly.includes(id))
        .sort(),
    );
    expect([...ids('operator')]).toEqual(expect.arrayContaining(['new-request', 'inbox', 'machines', 'agents']));
    expect([...ids('viewer')]).toEqual(expect.arrayContaining(['dashboard', 'issue-list', 'projects', 'docs']));
    for (const id of ['new-request', 'inbox', 'agents', 'machines', 'send-request']) {
      expect(ids('viewer').has(id), `viewer ${id}`).toBe(false);
    }
    expect([...ids('contributor')]).toEqual(
      expect.arrayContaining(['send-request', 'send-comment', 'my-contributions', 'marketing-overview']),
    );
    for (const id of ['new-request', 'inbox', 'runtimes', 'missing-buttons']) {
      expect(ids('contributor').has(id), `contributor ${id}`).toBe(false);
    }
    expect(ids('operator').has('send-request')).toBe(false);
  });
});

describe('hai ngôn ngữ cùng cấu trúc', () => {
  const shape = (lang: 'vi' | 'en') => {
    const doc = parseGuide(DOCS[lang]);
    return {
      groups: doc.groups.map((g) => ({
        id: g.id,
        sections: g.sections.map((s) => ({
          id: s.id,
          roles: s.roles ?? null,
          media: s.blocks.filter((b) => b.type !== 'md'),
          roleBlocks: s.blocks.filter((b) => b.roles).map((b) => b.roles?.join(',')),
        })),
      })),
      intro: doc.intro.map((b) => b.roles?.join(',') ?? ''),
    };
  };
  it('cùng nhóm, mục, vai trò, hình và khối theo vai trò, cùng thứ tự', () => {
    expect(shape('en')).toEqual(shape('vi'));
  });
  it('cùng tập link nội bộ và link #neo', () => {
    expect(internalLinks(DOCS.en).sort()).toEqual(internalLinks(DOCS.vi).sort());
    expect(anchors(DOCS.en).sort()).toEqual(anchors(DOCS.vi).sort());
  });
});

describe('GUIDE_SHOTS', () => {
  it('id không trùng và mọi hình dùng trong cả hai bản', () => {
    const ids = GUIDE_SHOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of GUIDE_SHOTS) {
      const tag = `{{${s.kind}:${s.id}}}`;
      expect(DOCS.vi, tag).toContain(tag);
      expect(DOCS.en, tag).toContain(tag);
    }
  });
  it('mỗi ngôn ngữ có đủ file của mọi hình (cả bản theo vai trò)', () => {
    for (const lang of LANGS) {
      for (const s of GUIDE_SHOTS) {
        const files =
          s.kind === 'diagram' ? [`${s.id}.svg`] : s.roles ? s.roles.map((r) => `${s.id}.${r}.webp`) : [`${s.id}.webp`];
        for (const f of files) expect(existsSync(`${IMG}/${lang}/${f}`), `${lang}/${f}`).toBe(true);
      }
    }
  });
  it('không có file ảnh thừa, ảnh gọn (mỗi file dưới 150 KB, tổng dưới 6 MB)', () => {
    const expected = new Set(
      GUIDE_SHOTS.flatMap((s) =>
        s.kind === 'diagram' ? [`${s.id}.svg`] : s.roles ? s.roles.map((r) => `${s.id}.${r}.webp`) : [`${s.id}.webp`],
      ),
    );
    let total = 0;
    for (const lang of LANGS) {
      for (const f of readdirSync(`${IMG}/${lang}`)) {
        expect(expected.has(f), `${lang}/${f} không có trong GUIDE_SHOTS`).toBe(true);
        const size = statSync(`${IMG}/${lang}/${f}`).size;
        expect(size, `${lang}/${f}`).toBeLessThan(150_000);
        total += size;
      }
    }
    expect(total).toBeLessThan(6_000_000);
  });
  it('sơ đồ ghi rõ không phải ảnh chụp app', () => {
    expect(readFileSync(`${IMG}/vi/mac-pairing.svg`, 'utf8')).toContain('KHÔNG PHẢI ẢNH CHỤP APP');
    expect(readFileSync(`${IMG}/en/mac-pairing.svg`, 'utf8')).toContain('NOT AN APP SCREENSHOT');
  });
});

describe.each([
  ['vi', ['Ép Done', 'Xóa skill', 'Đổi nguồn', 'Gỡ project', 'Gỡ agent', 'Đã gỡ']],
  ['en', ['Force Done', 'Delete skill', 'Change source', 'Remove project', 'Remove agent', 'Removed']],
] as const)('các luồng gỡ và Ép Done (%s)', (lang, words) => {
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

describe.each([
  [
    'vi',
    [
      'runtime=',
      'Codex',
      'OpenCode',
      'Chỉ board',
      'tắt sẵn',
      'Reviewer Claude',
      'tối đa **2 lần**',
      'chờ Claude',
      'kimi-k3',
      'chưa nhận ảnh',
    ],
  ],
  [
    'en',
    [
      'runtime=',
      'Codex',
      'OpenCode',
      'Only the board',
      'off by default',
      'Claude Reviewer',
      'at most **2 times**',
      'waits for Claude',
      'kimi-k3',
      'does not accept images',
    ],
  ],
] as const)('mục runtime (%s)', (lang, words) => {
  it('nói về marker runtime=, công tắc, reviewer Codex, tự chuyển và kimi-k3', () => {
    for (const w of words) expect(DOCS[lang], w).toContain(w);
  });
});

describe.each([
  [
    'vi',
    [
      'Ghép máy',
      'Đổi company / Ghép lại máy',
      'Ghép lại máy này',
      'Gỡ máy',
      'Đã ghép',
      '/paperclip/',
      'Góp ý của tôi',
      'Bị từ chối',
      'Mở toàn trang',
      'Cột',
    ],
  ],
  [
    'en',
    [
      'Ghép máy',
      'Đổi company / Ghép lại máy',
      'Ghép lại máy này',
      'Unpair machine',
      'Paired',
      '/paperclip/',
      'My contributions',
      'Rejected',
      'Open full page',
      'Columns',
    ],
  ],
] as const)('sản phẩm hiện tại (%s)', (lang, words) => {
  it('nói về ghép và gỡ máy, giao diện gốc, Phòng Marketing, danh sách và cửa sổ yêu cầu', () => {
    for (const w of words) expect(DOCS[lang], w).toContain(w);
  });
  it('không còn hướng dẫn dán key hay secret khi ghép máy', () => {
    const banned = lang === 'vi' ? [/dán (key|secret) webhook/i, /chọn sẵn company/i] : [/paste the webhook/i];
    for (const re of banned) expect(DOCS[lang]).not.toMatch(re);
  });
});
