// @vitest-environment jsdom
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MarkdownView } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});

afterEach(cleanup);

/** MarkdownView tải lười: chờ bản render markdown thật thay cho bản chữ thô. */
async function render(ui: ReactElement) {
  const r = rtlRender(ui);
  await waitFor(() => expect(r.container.querySelector('[data-slot="markdown-view"][data-ready]')).not.toBeNull());
  return r;
}

describe('MarkdownView', () => {
  it('không render HTML thô: img onerror bị bỏ, markdown vẫn chạy', async () => {
    const { container } = await render(<MarkdownView markdown={'<img src=x onerror="alert(1)"> **đậm**'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('đậm');
  });
  it('không render script', async () => {
    const { container } = await render(<MarkdownView markdown={'<script>alert(1)</script>chữ'} />);
    expect(container.querySelector('script')).toBeNull();
  });
  it('link ngoài mở tab mới với rel an toàn', async () => {
    const { container } = await render(<MarkdownView markdown="[x](https://example.com)" />);
    const a = container.querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noreferrer noopener');
  });
  it('link nội bộ không mở tab mới', async () => {
    const { container } = await render(<MarkdownView markdown="[x](/CRE/issues/CRE-1)" />);
    expect(container.querySelector('a')?.getAttribute('target')).toBeNull();
  });
  it('link mention agent hiện thành chip @Trợ Lý, không phải link rỗng', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { container } = await render(<MarkdownView markdown={`[@Trợ Lý](agent://${id}) làm lại icon`} />);
    const chip = container.querySelector('[data-agent-mention]');
    expect(chip?.tagName).toBe('SPAN');
    expect(chip?.textContent).toBe('@Trợ Lý');
    expect(chip?.getAttribute('data-agent-id')).toBe(id);
    expect(container.querySelector('a')).toBeNull();
  });
  it('agent:// sai dạng không thành chip; javascript: vẫn bị bỏ', async () => {
    const { container } = await render(
      <MarkdownView
        markdown={
          '[a](agent://khong-phai-uuid) [b](javascript:alert(1)) [c](agent://11111111-1111-4111-8111-111111111111/x)'
        }
      />,
    );
    expect(container.querySelector('[data-agent-mention]')).toBeNull();
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^(javascript|agent):/i);
    }
  });
  it('link javascript: bị bỏ href', async () => {
    const { container } = await render(<MarkdownView markdown="[x](javascript:alert(1))" />);
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });
  it('hỗ trợ bảng GFM', async () => {
    const { container } = await render(<MarkdownView markdown={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).not.toBeNull();
  });
  it('ảnh ngoài không tự tải (không lộ IP, referrer); thành link mở tab mới', async () => {
    const { container } = await render(<MarkdownView markdown="![sơ đồ](https://x.example/t.png)" />);
    expect(container.querySelector('img')).toBeNull();
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://x.example/t.png');
    expect(a?.getAttribute('rel')).toBe('noreferrer noopener');
    expect(a?.textContent).toBe('sơ đồ');
  });
  it('ảnh cùng origin vẫn hiện, không gửi referrer', async () => {
    const { container } = await render(<MarkdownView markdown="![a](/api/attachments/x1/content)" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/attachments/x1/content');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
  it('ảnh //host là ảnh ngoài', async () => {
    const { container } = await render(<MarkdownView markdown="![a](//x.example/t.png)" />);
    expect(container.querySelector('img')).toBeNull();
  });
  it('ảnh base64 JPEG hiện trong trang, vừa cột và có trần cao', async () => {
    const src = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const { container } = await render(<MarkdownView markdown={`![mockup](${src})`} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(src);
    expect(img?.getAttribute('alt')).toBe('mockup');
    expect(img?.className).toContain('max-w-full');
    expect(img?.className).toContain('max-h-96');
  });
  it('ảnh SVG base64 bị chặn: không có img, hiện alt và ghi chú ảnh bị chặn', async () => {
    const { container } = await render(
      <MarkdownView markdown="![logo độc](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('data:image/svg');
    const note = container.querySelector('[data-slot="markdown-image-note"]');
    expect(note?.textContent).toContain('logo độc');
    expect(note?.textContent).toContain('ảnh bị chặn');
  });
  it('data: loại khác (HTML) bị chặn, không alt thì hiện tên tạm', async () => {
    const { container } = await render(<MarkdownView markdown="![](data:text/html;base64,PGgxPg==)" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-slot="markdown-image-note"]')?.textContent).toContain('Ảnh');
  });
  it('link data: vẫn bị bỏ href (chỉ ảnh mới qua luật ảnh)', async () => {
    const { container } = await render(<MarkdownView markdown="[x](data:text/html;base64,PGgxPg==)" />);
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^data:/i);
  });
  it('ảnh file trên server lỗi tải (file đã bị dọn) thay bằng tên ảnh kèm "File không còn", không để trống', async () => {
    const { container } = await render(<MarkdownView markdown="![sơ đồ luồng](/api/attachments/x9/content)" />);
    const img = container.querySelector('img');
    if (!img) throw new Error('thiếu img');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    const note = container.querySelector('[data-slot="markdown-image-note"]');
    expect(note?.textContent).toContain('sơ đồ luồng');
    expect(note?.textContent).toContain('File không còn');
  });
  it('ảnh base64 lỗi giải mã vẫn ghi "không tải được ảnh"', async () => {
    const { container } = await render(<MarkdownView markdown="![hỏng](data:image/png;base64,AAAA)" />);
    const img = container.querySelector('img');
    if (!img) throw new Error('thiếu img');
    fireEvent.error(img);
    const note = container.querySelector('[data-slot="markdown-image-note"]');
    expect(note?.textContent).toContain('không tải được ảnh');
  });
  it('ảnh base64 trên 5 MB không hiện, có link Tải ảnh; trang không treo', async () => {
    const src = `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`;
    const started = performance.now();
    const { container } = await render(<MarkdownView markdown={`Ảnh lớn:\n\n![to](${src})`} />);
    // Phân tích nguyên chuỗi mất khoảng 0,2 giây mỗi MB; URL được tách ra trước nên render gần như tức thì.
    expect(performance.now() - started).toBeLessThan(500);
    expect(container.querySelector('img')).toBeNull();
    const link = container.querySelector('[data-slot="markdown-image-note"] a');
    expect(link?.textContent).toBe('Tải ảnh');
    expect(link?.getAttribute('download')).toBe('to');
  });
  it('ảnh base64 3 MB vẫn hiện, đúng nguyên src; khối code chứa URL dài hiện lại đúng chữ gốc', async () => {
    const src = `data:image/webp;base64,${'B'.repeat(4 * 1024 * 1024)}`;
    const md = `![lớn](${src})\n\n\`\`\`\n${src.slice(0, 70_000)}\n\`\`\``;
    const started = performance.now();
    const { container } = await render(<MarkdownView markdown={md} />);
    expect(performance.now() - started).toBeLessThan(500);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(src);
    expect(container.querySelector('code')?.textContent).toBe(`${src.slice(0, 70_000)}\n`);
  });
});
