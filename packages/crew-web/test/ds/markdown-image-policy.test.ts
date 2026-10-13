import { describe, expect, it } from 'vitest';
import {
  classifyImageSrc,
  DATA_URL_EXTRACT_MIN,
  extractLongDataUrls,
  INLINE_IMAGE_MAX_BYTES,
  restoreDataUrls,
} from '@/ds/widgets/markdown-image-policy';

const ORIGIN = 'https://crew.example';
const classify = (src: string) => classifyImageSrc(src, ORIGIN);

describe('luật ảnh markdown: được hiện', () => {
  it('file đính kèm tương đối và tuyệt đối cùng origin là ảnh trong trang', () => {
    expect(classify('/api/attachments/a1/content')).toEqual({ kind: 'local', url: '/api/attachments/a1/content' });
    expect(classify(`${ORIGIN}/api/attachments/a1/content`).kind).toBe('local');
  });

  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['jpg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp'],
    ['JPEG', 'image/jpeg'],
  ])('data:image/%s;base64 là ảnh nhúng %s', (sub, contentType) => {
    const src = `data:image/${sub};base64,QUJD`;
    expect(classify(src)).toEqual({ kind: 'inline', url: src, contentType, byteSize: 3 });
  });

  it('cỡ ảnh nhúng tính theo base64 đã trừ ký tự đệm', () => {
    expect(classify('data:image/png;base64,QUI=')).toMatchObject({ byteSize: 2 });
    expect(classify('data:image/png;base64,QQ==')).toMatchObject({ byteSize: 1 });
  });

  it('ảnh nhúng quá 5 MB không hiện, chỉ cho tải', () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(Math.ceil(((INLINE_IMAGE_MAX_BYTES + 3) * 4) / 3))}`;
    expect(classify(big).kind).toBe('inline-too-large');
    const fits = `data:image/jpeg;base64,${'A'.repeat((INLINE_IMAGE_MAX_BYTES * 4) / 4)}`;
    expect(classify(fits).kind).toBe('inline');
  });
});

describe('luật ảnh markdown: chặn hoặc chỉ thành link', () => {
  it.each([
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'data:text/html;base64,PGgxPmhpPC9oMT4=',
    'data:image/png,rawbytes',
    'data:image/bmp;base64,QUJD',
    'DATA:image/svg+xml;base64,PHN2Zz4=',
    'data:;base64,QUJD',
  ])('%s bị chặn', (src) => {
    expect(classify(src)).toEqual({ kind: 'blocked' });
  });

  it('scheme lạ bị chặn', () => {
    expect(classify('javascript:alert(1)').kind).toBe('blocked');
    expect(classify('blob:https://crew.example/1').kind).toBe('blocked');
    expect(classify('file:///etc/passwd').kind).toBe('blocked');
  });

  it('ảnh host khác (kể cả //host) chỉ thành link', () => {
    expect(classify('https://x.example/a.png')).toEqual({ kind: 'external', url: 'https://x.example/a.png' });
    expect(classify('//x.example/a.png').kind).toBe('external');
    expect(classify('http://crew.example/a.png').kind).toBe('external');
  });

  it('src rỗng (URL đã bị react-markdown bỏ) không hiện gì', () => {
    expect(classify('')).toEqual({ kind: 'none' });
    expect(classifyImageSrc(undefined, ORIGIN)).toEqual({ kind: 'none' });
  });
});

describe('tách URL data: dài trước khi phân tích markdown', () => {
  const long = `data:image/png;base64,${'A'.repeat(DATA_URL_EXTRACT_MIN)}`;

  it('URL dài thay bằng mã ngắn, trả lại đúng URL gốc', () => {
    const md = `Ảnh:\n\n![a](${long})\n\n![b](${long}B)`;
    const out = extractLongDataUrls(md);
    expect(out.urls).toEqual([long, `${long}B`]);
    expect(out.markdown).toBe('Ảnh:\n\n![a](crew-inline-data:0)\n\n![b](crew-inline-data:1)');
    expect(restoreDataUrls(out.markdown, out.urls)).toBe(md);
  });

  it('markdown ngắn hoặc URL data: ngắn giữ nguyên', () => {
    const md = '![a](data:image/png;base64,QUJD)';
    expect(extractLongDataUrls(md)).toEqual({ markdown: md, urls: [] });
    const padded = `${'x'.repeat(DATA_URL_EXTRACT_MIN)} ![a](data:image/png;base64,QUJD)`;
    expect(extractLongDataUrls(padded)).toEqual({ markdown: padded, urls: [] });
  });

  it('mã không có trong danh sách thì giữ nguyên chữ', () => {
    expect(restoreDataUrls('crew-inline-data:5', ['x'])).toBe('crew-inline-data:5');
    expect(restoreDataUrls('crew-inline-data:0', [])).toBe('crew-inline-data:0');
  });
});
