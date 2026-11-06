// @vitest-environment jsdom
// Nhãn máy ở cột Máy nằm trên link phủ dòng (để nhận hover tooltip) nhưng bấm lên vẫn mở yêu cầu như phần còn lại.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IssueListRow, MachineLabel } from '@/ds';

beforeAll(() => {
  // Tooltip Radix đo nội dung bằng ResizeObserver, jsdom không có.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

function row(onOpen: () => void) {
  return render(
    <IssueListRow
      title="Sửa lỗi đăng nhập"
      href="/TPS/issues/TPS-1"
      onOpen={onOpen}
      status="todo"
      statusLabel="Cần làm"
      metadata={
        <MachineLabel
          state="online"
          name="demo-mac-01"
          ariaLabel="Máy demo-mac-01, đang kết nối"
          tooltip="Đang kết nối"
        />
      }
    />,
  );
}

describe('MachineLabel trong dòng danh sách', () => {
  it('bấm lên nhãn máy có tooltip mở yêu cầu như bấm dòng', () => {
    const onOpen = vi.fn();
    row(onOpen);
    fireEvent.click(screen.getByRole('img', { name: 'Máy demo-mac-01, đang kết nối' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('Cmd+click lên nhãn để trình duyệt mở tab mới, không mở popup', () => {
    const onOpen = vi.fn();
    row(onOpen);
    const link = screen.getByRole('link', { name: 'Sửa lỗi đăng nhập' });
    const seen = vi.fn();
    link.addEventListener('click', (e) => seen((e as MouseEvent).metaKey));
    fireEvent.click(screen.getByRole('img', { name: 'Máy demo-mac-01, đang kết nối' }), { metaKey: true });
    expect(seen).toHaveBeenCalledWith(true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('nhãn vẫn là chỗ mở tooltip', async () => {
    row(vi.fn());
    fireEvent.focus(screen.getByRole('img', { name: 'Máy demo-mac-01, đang kết nối' }));
    expect((await screen.findByRole('tooltip')).textContent).toContain('Đang kết nối');
  });

  it('nhãn không tooltip ngoài dòng: bấm không lỗi, không chuyển click đi đâu', () => {
    render(<MachineLabel state="offline" name="demo-mac-02" />);
    fireEvent.click(screen.getByRole('img', { name: 'demo-mac-02' }));
    expect(screen.queryByRole('link')).toBeNull();
  });
});
