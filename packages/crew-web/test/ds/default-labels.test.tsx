// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ErrorState, Spinner } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

describe('nhãn mặc định qua t()', () => {
  it('Spinner và nút thử lại của ErrorState đổi theo ngôn ngữ', async () => {
    const { rerender } = render(
      <>
        <Spinner />
        <ErrorState title="x" onRetry={() => {}} />
      </>,
    );
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Đang tải');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    await setLanguage('en');
    rerender(
      <>
        <Spinner />
        <ErrorState title="x" onRetry={() => {}} />
      </>,
    );
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
  it('label truyền vào vẫn được ưu tiên', () => {
    render(<Spinner label="Đang gửi" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Đang gửi');
  });
});
