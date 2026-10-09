// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AttachmentPicker } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const pick = (files: File[]) => {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
};

describe('AttachmentPicker', () => {
  it('cảnh báo hiện trước khi gửi và vẫn cho gửi', () => {
    const onFiles = vi.fn();
    const warnFor = (name: string) => (name.endsWith('.zip') ? 'file nén có thể chứa mã lạ' : null);
    render(<AttachmentPicker onFiles={onFiles} warnFor={warnFor} />);
    const zip = new File(['x'], 'a.zip');
    const txt = new File(['x'], 'b.txt');
    pick([zip, txt]);
    expect(screen.getByText(/a\.zip/)).toBeTruthy();
    expect(screen.getByText(/file nén có thể chứa mã lạ/)).toBeTruthy();
    expect(onFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi vẫn tiếp tục' }));
    expect(onFiles).toHaveBeenCalledWith([zip, txt]);
  });
  it('không có cảnh báo thì gửi ngay', () => {
    const onFiles = vi.fn();
    render(<AttachmentPicker onFiles={onFiles} warnFor={() => null} />);
    const f = new File(['x'], 'b.txt');
    pick([f]);
    expect(onFiles).toHaveBeenCalledWith([f]);
  });
  it('hủy bỏ chọn khi có cảnh báo', () => {
    const onFiles = vi.fn();
    render(<AttachmentPicker onFiles={onFiles} warnFor={() => 'cảnh báo'} />);
    pick([new File(['x'], 'c.txt')]);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }));
    expect(screen.queryByText(/cảnh báo/)).toBeNull();
    expect(onFiles).not.toHaveBeenCalled();
  });
});
