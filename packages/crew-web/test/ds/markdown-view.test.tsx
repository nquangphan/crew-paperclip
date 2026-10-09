// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownView } from '@/ds';

afterEach(cleanup);

describe('MarkdownView', () => {
  it('không render HTML thô: img onerror bị bỏ, markdown vẫn chạy', () => {
    const { container } = render(<MarkdownView markdown={'<img src=x onerror="alert(1)"> **đậm**'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('đậm');
  });
  it('không render script', () => {
    const { container } = render(<MarkdownView markdown={'<script>alert(1)</script>chữ'} />);
    expect(container.querySelector('script')).toBeNull();
  });
  it('link ngoài mở tab mới với rel an toàn', () => {
    const { container } = render(<MarkdownView markdown="[x](https://example.com)" />);
    const a = container.querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noreferrer noopener');
  });
  it('link nội bộ không mở tab mới', () => {
    const { container } = render(<MarkdownView markdown="[x](/CRE/issues/CRE-1)" />);
    expect(container.querySelector('a')?.getAttribute('target')).toBeNull();
  });
  it('link javascript: bị bỏ href', () => {
    const { container } = render(<MarkdownView markdown="[x](javascript:alert(1))" />);
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });
  it('hỗ trợ bảng GFM', () => {
    const { container } = render(<MarkdownView markdown={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).not.toBeNull();
  });
});
