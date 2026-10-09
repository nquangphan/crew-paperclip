// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Wizard } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

describe('Wizard', () => {
  it('hiện tiêu đề, trạng thái từng bước', () => {
    render(
      <Wizard
        steps={[
          { id: 'a', title: 'Kiểm máy', state: 'done' },
          { id: 'b', title: 'Cài skill', state: 'running', detail: 'đang chép' },
          { id: 'c', title: 'Tạo agent', state: 'pending' },
        ]}
      />,
    );
    expect(screen.getByText('Kiểm máy').closest('li')?.getAttribute('data-state')).toBe('done');
    expect(screen.getByText('Cài skill').closest('li')?.getAttribute('data-state')).toBe('running');
    expect(screen.getByText('đang chép')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chạy tiếp' })).toBeNull();
  });
  it('bước failed hiện error và nút Chạy tiếp gọi onResume', () => {
    const onResume = vi.fn();
    render(
      <Wizard
        steps={[{ id: 'a', title: 'Cài skill', state: 'failed' }]}
        error="máy không phản hồi"
        onResume={onResume}
      />,
    );
    expect(screen.getByText('máy không phản hồi')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chạy tiếp' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
  it('failed không có onResume thì không hiện nút', () => {
    render(<Wizard steps={[{ id: 'a', title: 'x', state: 'failed' }]} error="lỗi" />);
    expect(screen.queryByRole('button', { name: 'Chạy tiếp' })).toBeNull();
  });
});
