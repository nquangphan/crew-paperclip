import { describe, expect, it } from 'vitest';
import { createSlugger } from '@/ds/widgets/heading-slug';
import { defaultDocPath, pageTitle, stripLeadingTitle } from '@/features/docs/docs-paths';

const pages = (...paths: string[]) => paths.map((path) => ({ path, title: path }));

describe('defaultDocPath', () => {
  it('ưu tiên index.md/README.md nông nhất, index trước README cùng cấp', () => {
    expect(defaultDocPath(pages('docs/index.md', 'README.md', 'a.md'))).toBe('README.md');
    expect(defaultDocPath(pages('docs/readme.md', 'docs/index.md', 'docs/flows/index.md'))).toBe('docs/index.md');
    expect(defaultDocPath(pages('docs/flows/README.md', 'docs/z.md'))).toBe('docs/flows/README.md');
  });

  it('không có trang chủ thì lấy trang đầu theo thứ tự cây (thư mục trước, theo tên)', () => {
    expect(defaultDocPath(pages('zeta.md', 'docs/b.md', 'docs/a.md'))).toBe('docs/a.md');
  });

  it('không có trang nào thì null', () => {
    expect(defaultDocPath([])).toBeNull();
  });
});

describe('stripLeadingTitle', () => {
  it('bỏ heading # đầu bài khi trùng tiêu đề trang', () => {
    expect(stripLeadingTitle('# Chỉ mục\n\nNội dung', 'Chỉ mục')).toBe('\nNội dung');
    expect(stripLeadingTitle('\n#  Chỉ mục  #\nNội dung', 'Chỉ mục')).toBe('Nội dung');
  });

  it('giữ nguyên khi heading khác tiêu đề hoặc không phải h1', () => {
    expect(stripLeadingTitle('# Khác\n\nNội dung', 'Chỉ mục')).toBe('# Khác\n\nNội dung');
    expect(stripLeadingTitle('## Chỉ mục\n', 'Chỉ mục')).toBe('## Chỉ mục\n');
  });
});

describe('pageTitle', () => {
  it('không có tiêu đề thì dùng tên file', () => {
    expect(pageTitle({ path: 'docs/flows/login.md', title: '' })).toBe('login.md');
    expect(pageTitle({ path: 'a.md', title: 'A' })).toBe('A');
  });
});

describe('createSlugger', () => {
  it('slug kiểu GitHub, giữ chữ tiếng Việt, đánh số heading trùng', () => {
    const slug = createSlugger();
    expect(slug('Cài đặt nhanh!')).toBe('cài-đặt-nhanh');
    expect(slug('Cài đặt nhanh')).toBe('cài-đặt-nhanh-1');
    expect(slug('`code` & API')).toBe('code-api');
    expect(slug('???')).toBe('muc');
  });
});
