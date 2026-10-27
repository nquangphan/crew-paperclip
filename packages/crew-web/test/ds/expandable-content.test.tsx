// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpandableContent } from '@/ds';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function view() {
  return render(
    <ExpandableContent maxLines={10} showMoreLabel={(n) => `Hiện đủ (còn ${n} dòng)`} showLessLabel="Thu gọn">
      <p>nội dung</p>
    </ExpandableContent>,
  );
}

describe('ExpandableContent', () => {
  it('nội dung ngắn: không nút, không lớp mờ', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
    view();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[data-slot="expandable-fade"]')).toBeNull();
  });

  it('nội dung dài: thu gọn, lớp mờ, nút ghi số dòng ẩn làm tròn lên, aria-expanded đổi theo', () => {
    // line-height jsdom rỗng -> 24px; ẩn 1000 - 240 = 760px = 31,67 dòng -> 32.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    view();
    const toggle = screen.getByRole('button', { name: 'Hiện đủ (còn 32 dòng)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('svg')).not.toBeNull();
    // Nằm trong bong bóng comment của người (chữ trắng) vẫn đọc được trên nền outline.
    expect(toggle.className).toContain('text-foreground');
    expect(document.querySelector('[data-collapsed]')).not.toBeNull();
    expect(document.querySelector('[data-slot="expandable-fade"]')).not.toBeNull();
    fireEvent.click(toggle);
    const less = screen.getByRole('button', { name: 'Thu gọn' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-collapsed]')).toBeNull();
    expect(document.querySelector('[data-slot="expandable-fade"]')).toBeNull();
  });
});
