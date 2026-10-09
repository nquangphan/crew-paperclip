// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeBlock, Section, SectionHeading } from '@/ds';

afterEach(cleanup);

describe('Section / SectionHeading', () => {
  it('Section có vùng đặt tên theo tiêu đề và hiện nội dung', () => {
    render(
      <Section title="Kết nối">
        <p>nội dung mục</p>
      </Section>,
    );
    const region = screen.getByRole('region', { name: 'Kết nối' });
    expect(region.textContent).toContain('nội dung mục');
    expect(screen.getByRole('heading', { name: 'Kết nối' })).toBeTruthy();
  });
  it('SectionHeading là tiêu đề nhóm cấp 2', () => {
    render(<SectionHeading>Nhóm một</SectionHeading>);
    expect(screen.getByRole('heading', { level: 2, name: 'Nhóm một' })).toBeTruthy();
  });
});

describe('CodeBlock', () => {
  it('chỉ đọc, cuộn được, có nhãn và giữ nguyên xuống dòng', () => {
    render(<CodeBlock label="Nhật ký" code={'dòng 1\ndòng 2'} />);
    const el = screen.getByRole('region', { name: 'Nhật ký' });
    expect(el.textContent).toBe('dòng 1\ndòng 2');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('overflow-auto');
  });
});
