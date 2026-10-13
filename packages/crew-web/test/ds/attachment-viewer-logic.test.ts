import { describe, expect, it } from 'vitest';
import { formatBytes, stepIndex, TEXT_PREVIEW_MAX_BYTES, viewerKindFor } from '@/ds';

describe('viewerKindFor', () => {
  it.each([
    ['image/png', 'a.png', 'image'],
    ['image/svg+xml', 'logo.svg', 'image'],
    ['application/pdf', 'spec.pdf', 'pdf'],
    ['text/markdown', 'notes.md', 'markdown'],
    ['text/markdown; charset=utf-8', 'notes.md', 'markdown'],
    ['text/html', 'mockup.html', 'html'],
    ['text/plain', 'run.log', 'text'],
    ['application/json', 'data.json', 'text'],
    ['text/csv', 'bang.csv', 'text'],
    ['video/mp4', 'demo.mp4', 'video'],
    ['video/quicktime', 'demo.mov', 'video'],
    ['application/zip', 'bundle.zip', 'other'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'bao-cao.docx', 'other'],
    ['audio/mpeg', 'ghi-am.mp3', 'other'],
  ])('%s (%s) → %s', (contentType, name, kind) => {
    expect(viewerKindFor({ contentType, name, byteSize: 1000 })).toBe(kind);
  });

  it('content-type thiếu hoặc chung chung thì đoán theo đuôi tên file', () => {
    expect(viewerKindFor({ contentType: null, name: 'mockup.HTML' })).toBe('html');
    expect(viewerKindFor({ contentType: 'application/octet-stream', name: 'main.ts' })).toBe('text');
    expect(viewerKindFor({ contentType: '', name: 'a.webp' })).toBe('image');
    expect(viewerKindFor({ contentType: 'application/octet-stream', name: 'khong-duoi' })).toBe('other');
  });

  it('markdown hay HTML lưu dạng text/plain vẫn render theo đuôi file', () => {
    expect(viewerKindFor({ contentType: 'text/plain', name: 'README.md' })).toBe('markdown');
    expect(viewerKindFor({ contentType: 'text/plain', name: 'trang.html' })).toBe('html');
  });

  it('ảnh HEIC trình duyệt không hiện được thì chỉ cho tải về', () => {
    expect(viewerKindFor({ contentType: 'image/heic', name: 'IMG_1.heic' })).toBe('other');
  });

  it('file chữ quá lớn không tải vào trang; ảnh lớn vẫn xem được; không biết cỡ thì không chặn', () => {
    const big = TEXT_PREVIEW_MAX_BYTES + 1;
    expect(viewerKindFor({ contentType: 'text/plain', name: 'big.log', byteSize: big })).toBe('other');
    expect(viewerKindFor({ contentType: 'text/markdown', name: 'big.md', byteSize: big })).toBe('other');
    expect(viewerKindFor({ contentType: 'image/png', name: 'big.png', byteSize: big })).toBe('image');
    expect(viewerKindFor({ contentType: 'text/plain', name: 'a.txt', byteSize: TEXT_PREVIEW_MAX_BYTES })).toBe('text');
    expect(viewerKindFor({ contentType: null, name: 'a.md', byteSize: null })).toBe('markdown');
  });
});

describe('stepIndex', () => {
  it('trước/sau đi một bước và dừng ở hai đầu', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(1, 3, -1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBe(2);
  });
  it('dãy một ảnh hoặc rỗng không đi đâu', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

describe('formatBytes', () => {
  it('đổi đơn vị theo cỡ và dấu thập phân theo ngôn ngữ', () => {
    expect(formatBytes(512, 'vi')).toBe('512 B');
    expect(formatBytes(2048, 'vi')).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 * 1024, 'vi')).toBe('1,5 MB');
    expect(formatBytes(1.5 * 1024 * 1024, 'en')).toBe('1.5 MB');
  });
});
