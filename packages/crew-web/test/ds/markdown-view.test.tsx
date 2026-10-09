// @vitest-environment jsdom
import { cleanup, render as rtlRender, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownView } from '@/ds';

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
});
