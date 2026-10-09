// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ReadinessBadge } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

describe('ReadinessBadge', () => {
  it('ready hiện nhãn trạng thái, không liệt kê lỗi', () => {
    render(<ReadinessBadge state="ready" failed={[]} />);
    expect(screen.getByText('Sẵn sàng')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
  it('not_ready có A5 hiện "Thiếu checkout trên máy"', () => {
    render(<ReadinessBadge state="not_ready" failed={[{ id: 'A5' }]} />);
    expect(screen.getByText('Chưa sẵn sàng')).toBeTruthy();
    expect(screen.getByText('Thiếu checkout trên máy')).toBeTruthy();
  });
  it('mã lạ hiện nguyên mã, không vỡ', () => {
    render(<ReadinessBadge state="not_ready" failed={[{ id: 'Z9' }]} />);
    expect(screen.getByText('Z9')).toBeTruthy();
  });
  it('đổi sang tiếng Anh', async () => {
    await setLanguage('en');
    render(<ReadinessBadge state="not_ready" failed={[{ id: 'A5' }]} />);
    expect(screen.getByText('Not ready')).toBeTruthy();
    expect(screen.getByText('Checkout missing on the machine')).toBeTruthy();
  });
  it('phủ mọi trạng thái của agent và project', () => {
    for (const state of ['ready', 'paused', 'not_ready', 'terminated', 'untracked'] as const) {
      const { unmount } = render(<ReadinessBadge state={state} failed={[]} />);
      expect(document.querySelector(`[data-state="${state}"]`)).toBeTruthy();
      unmount();
    }
  });
});
