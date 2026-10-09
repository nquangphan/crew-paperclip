// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert, MutedText, RowLink } from '@/ds';
import { Star, StarFilled } from '@/ds/icons';

afterEach(cleanup);

describe('Alert / MutedText / Star / RowLink', () => {
  it('Alert info/warning/destructive có role và nội dung', () => {
    render(
      <>
        <Alert variant="info" title="Thông tin">
          chi tiết 1
        </Alert>
        <Alert variant="warning" title="Cảnh báo">
          chi tiết 2
        </Alert>
        <Alert variant="destructive" title="Lỗi">
          chi tiết 3
        </Alert>
      </>,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('Cảnh báo')).toBeTruthy();
    expect(screen.getByText('chi tiết 3')).toBeTruthy();
  });
  it('Alert info dùng role status', () => {
    render(<Alert variant="info">xin chào</Alert>);
    expect(screen.getByRole('status').textContent).toContain('xin chào');
  });
  it('MutedText render chữ phụ', () => {
    render(<MutedText>ghi chú</MutedText>);
    expect(screen.getByText('ghi chú').className).toContain('text-muted-foreground');
  });
  it('Star là icon render được', () => {
    const { container } = render(<Star />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(
      render(<StarFilled />)
        .container.querySelector('svg')
        ?.getAttribute('fill'),
    ).toBe('currentColor');
  });
  it('RowLink export từ @/ds và gọi onOpen', () => {
    const onOpen = vi.fn();
    render(
      <RowLink href="/x" onOpen={onOpen}>
        dòng
      </RowLink>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'dòng' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
