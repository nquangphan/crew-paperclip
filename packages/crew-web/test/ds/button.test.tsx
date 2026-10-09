// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/ds';

afterEach(cleanup);

describe('Button', () => {
  it('variant destructive có class từ cva', () => {
    render(<Button variant="destructive">Xóa</Button>);
    const el = screen.getByRole('button', { name: 'Xóa' });
    expect(el.className).toContain('bg-destructive');
    expect(el.getAttribute('data-variant')).toBe('destructive');
  });
  it('click gọi handler', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Lưu</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
